#!/usr/bin/env node
// claude-dashboard.js — Hybrid Control Center: Claude CLI sessions + Hermes stream
// UI hiện đại kiểu Linear/Vercel dark: Tailwind + daisyUI + Lucide (CDN), KHÔNG hiệu ứng nháy.
// Render ổn định: diff DOM theo key, chỉ update node thay đổi — không full-repaint.
// Usage: node claude-dashboard.js   (http://localhost:7799)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');

const PORT = +(process.env.PORT || 7799);
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const HERMES_DB = path.join(os.homedir(), '.hermes', 'state.db');
const HERMES_LOG = path.join(os.homedir(), '.hermes', 'logs', 'agent.log');
// Hermes CLI: chat 2 chiều — server gọi trực tiếp binary, đợi stdout trả về client
const HERMES_BIN = process.env.HERMES_BIN || path.join(os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes');
const HERMES_MODEL = process.env.HERMES_MODEL || 'tencent/hy3:free';

// sid -> { proc, project, startedAt, task }
const procs = new Map();
// sid -> timestamp lần cuối user mở chat view (để tính unread badge)
const lastSeen = new Map();
// Model áp dụng cho task mới (--model khi spawn), set qua lệnh /model. null = default
let currentModel = null;
/* Chế độ quyền khi spawn Claude.
   Dashboard chạy `claude -p` với stdio ignore -> KHÔNG có kênh nào để hỏi quyền:
   Claude im lặng bỏ qua việc cần quyền rồi trả lời "bạn chưa cấp quyền", nhìn như
   đã làm mà thật ra không làm gì. acceptEdits = tự cho phép sửa file (lệnh nguy hiểm
   vẫn bị chặn). Ghi ra file để giữ nguyên lựa chọn sau khi restart dashboard. */
const PERM_FILE = path.join(os.homedir(), '.claude', 'dashboard-perm.json');
// 'plan' = Claude trình bày kế hoạch rồi DỪNG chờ duyệt (không đụng file). Đây là cách
// duyệt-trước-khi-làm khả thi duy nhất: CLI không có kênh uỷ quyền để dashboard bấm
// "cho phép" từng tool (đã thử stream-json: không phát sự kiện xin quyền).
const PERM_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
let permMode = 'acceptEdits'; // mặc định: hết cảnh "làm như không làm"
try {
  const saved = JSON.parse(fs.readFileSync(PERM_FILE, 'utf8'));
  if (PERM_MODES.indexOf(saved.mode) >= 0) permMode = saved.mode;
} catch {}
function savePermMode() {
  try { fs.writeFileSync(PERM_FILE, JSON.stringify({ mode: permMode })); } catch {}
}
// Cờ --permission-mode cho mọi lần spawn ('default' = để CLI tự quyết, không truyền cờ)
function permArgs() {
  return permMode === 'default' ? [] : ['--permission-mode', permMode];
}
// Loop/cron jobs: id -> { id, kind: 'loop'|'cron', spec, prompt, runs, lastSid, timer?, lastKey? }
const jobs = new Map();
// One-shot claude runs (enhance prompt / summary): id -> { status, output }
const oneshots = new Map();
// jsonl parse cache: file -> { mtimeMs, size, data }
const cache = new Map();

/* ---------------- JSONL parsing (Claude CLI sessions) ---------------- */
// Helper biến tool_use/tool_result thành dữ liệu có cấu trúc -> src/server/tools.js
const {
  extractText, clampText, base, toolDisplayName, summarizeToolInput, extractTodos,
  buildInputDetail, toolResultPreview, findToolImage, flattenParts, mdForMessage,
  TOOL_SUMMARY_CAP, TOOL_INPUT_CAP, TOOL_RESULT_CAP, THINK_CAP, TOOL_ST_LABEL,
} = require('./tools');


function parseSessionFile(file) {
  let st;
  try { st = fs.statSync(file); } catch { cache.delete(file); return null; }
  const c = cache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.data;

  const msgs = [];
  // tool_use_id -> part object; ghép result vào call. Ghép trên TOÀN file trước khi
  // slice window 30 -> call ở đầu window vẫn nhận được result nằm sau.
  const toolIndex = new Map();
  const usage = { inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  let aiTitle = '';   // Claude CLI tự sinh tiêu đề (dòng type=ai-title), lấy bản MỚI NHẤT
  let firstUser = ''; // dự phòng khi session chưa có ai-title: câu đầu của user
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'ai-title') { if (obj.aiTitle) aiTitle = obj.aiTitle; continue; }
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    // token đã dùng: CLI ghi sẵn usage mỗi lượt assistant -> cộng dồn, khỏi gọi /cost
    const u = obj.message && obj.message.usage;
    if (u) {
      usage.inTok += u.input_tokens || 0;
      usage.outTok += u.output_tokens || 0;
      usage.cacheRead += u.cache_read_input_tokens || 0;
      usage.cacheWrite += u.cache_creation_input_tokens || 0;
      usage.turns++;
    }
    const m = obj.message || obj;
    const content = m.content;
    const parts = [];

    if (Array.isArray(content)) {
      for (const b of content) {
        if (typeof b === 'string') { if (b.trim()) parts.push({ t: 'text', text: b }); continue; }
        if (!b) continue;
        if (b.type === 'text') { if ((b.text || '').trim()) parts.push({ t: 'text', text: b.text }); }
        else if (b.type === 'tool_use') {
          const part = {
            t: 'tool',
            id: b.id || '',
            name: b.name || 'tool',
            disp: toolDisplayName(b.name),
            summary: summarizeToolInput(b.name, b.input),
            input: buildInputDetail(b.name, b.input),
            status: 'pending',
            result: '',
            images: [],
          };
          // TodoWrite: gửi kèm danh sách có cấu trúc để client vẽ checklist thật,
          // thay vì đổ JSON thô ra khối code như mọi tool khác
          if (b.name === 'TodoWrite') part.todos = extractTodos(b.input);
          parts.push(part);
          if (b.id) toolIndex.set(b.id, part);
        } else if (b.type === 'tool_result') {
          // Gắn vào card của call tương ứng; message user thuần tool_result KHÔNG phát ra bubble
          const target = toolIndex.get(b.tool_use_id);
          if (target) {
            const pv = toolResultPreview(b.content);
            target.status = b.is_error ? 'error' : 'ok';
            target.result = pv.text;
            target.images = pv.images;
          }
          // orphan (call đã trôi khỏi file / jsonl hỏng) -> bỏ im lặng
        } else if (b.type === 'thinking') {
          // Claude CLI có hiện phần suy nghĩ; dashboard trước đây vứt sạch.
          // Giữ lại nhưng CLAMP: thinking dài hàng chục KB, nhồi hết vào payload poll 2s là phí.
          const tk = String(b.thinking || '').trim();
          if (tk) parts.push({ t: 'think', text: clampText(tk, THINK_CAP) });
        }
        // block lạ khác: bỏ
      }
    } else {
      const text = extractText(content);
      if (text.trim()) parts.push({ t: 'text', text });
    }

    if (!parts.length) continue;
    const text = flattenParts(parts);
    if (!text.trim()) continue;
    if (!firstUser && obj.type === 'user') {
      // bỏ lệnh slash / output hệ thống, lấy câu người thật gõ
      const t = text.trim();
      if (t[0] !== '/' && t.indexOf('<') !== 0) firstUser = t;
    }
    msgs.push({ role: obj.type, text, ts: obj.timestamp || null, parts });
  }
  // tsMs: timestamp (ms) từng message — precompute 1 lần để đếm unread không tốn Date.parse mỗi tick
  // title: ai-title của Claude CLI; chưa có thì lấy câu đầu của user (cắt gọn)
  const title = aiTitle || (firstUser ? firstUser.replace(/\s+/g, ' ').slice(0, 70) : '');
  // Chế độ plan: Claude ghi kế hoạch ra ~/.claude/plans/*.md rồi DỪNG, không đụng file đích.
  // Lượt cuối là assistant + có nhắc tới file kế hoạch => đang chờ người duyệt.
  const lastMsg = msgs[msgs.length - 1];
  const planFile = lastMsg && lastMsg.role === 'assistant'
    ? (lastMsg.text.match(/[^\s`'"]*\.claude\/plans\/[^\s`'")]+\.md/) || [null])[0]
    : null;
  const data = {
    msgs, mtimeMs: st.mtimeMs, title, planFile, usage,
    tsMs: msgs.map(m => Date.parse(m.ts) || 0),
  };
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, data });
  return data;
}

// Đọc lịch sử chat 1 session (30 message cuối) — dùng chung cache mtime của parseSessionFile,
// tránh đọc + parse lại cả file JSONL mỗi lần client poll (2s/lần khi mở chat).
function getHistory(sid) {
  const file = findSessionFile(sid);
  if (!file) return null;
  const parsed = parseSessionFile(file);
  if (!parsed) return null;
  return parsed.msgs.slice(-30).map(m => ({ role: m.role, content: m.text, ts: m.ts, parts: m.parts }));
}

/* ---- tên tự đặt: ghi riêng của dashboard, ĐÈ ai-title của Claude CLI ----
   Không sửa file .jsonl của Claude CLI (nó là dữ liệu gốc, CLI có thể ghi đè bất cứ lúc nào). */
const TITLES_FILE = path.join(os.homedir(), '.claude', 'dashboard-titles.json');
let customTitles = null;
function loadTitles() {
  if (customTitles) return customTitles;
  try { customTitles = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8')); }
  catch { customTitles = {}; }
  return customTitles;
}
function setTitle(sid, name) {
  const t = loadTitles();
  if (name) t[sid] = name; else delete t[sid]; // xoá tên tự đặt -> quay về ai-title
  try { fs.writeFileSync(TITLES_FILE, JSON.stringify(t, null, 2)); } catch { return false; }
  return true;
}
// Tiêu đề hiển thị: tên tự đặt > ai-title (Claude CLI) > câu đầu của user > rỗng
function titleOf(sid, parsedTitle) {
  return loadTitles()[sid] || parsedTitle || '';
}

/* ---- model riêng từng phiên ----
   /model trước đây đổi model TOÀN CỤC, nên đang chạy Opus cho việc khó mà mở phiên
   khác là dính theo. Lưu riêng theo sid, ưu tiên hơn model toàn cục. */
const MODELS_FILE = path.join(os.homedir(), '.claude', 'dashboard-models.json');
let sessionModels = null;
function loadModels() {
  if (sessionModels) return sessionModels;
  try { sessionModels = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8')); } catch { sessionModels = {}; }
  return sessionModels;
}
function setSessionModel(sid, model) {
  const t = loadModels();
  if (model) t[sid] = model; else delete t[sid]; // xoá = quay về model toàn cục
  try { fs.writeFileSync(MODELS_FILE, JSON.stringify(t, null, 2)); } catch { return false; }
  return true;
}
function modelFor(sid) { return loadModels()[sid] || currentModel || null; }

// Nhãn cho thông báo đẩy: ưu tiên tiêu đề, không có mới rơi về ID
// (thông báo "Claude 7e31e9e3 đã trả lời xong" đọc xong vẫn không biết là phiên nào)
function sessionLabel(sid) {
  let t = loadTitles()[sid];
  if (!t) {
    const file = findSessionFile(sid);
    const parsed = file ? parseSessionFile(file) : null;
    t = parsed && parsed.title;
  }
  return t ? (t.length > 60 ? t.slice(0, 60) + '…' : t) : 'Claude ' + sid.slice(0, 8);
}

/* ---- thư mục làm việc của phiên ----
   Claude CLI tìm phiên theo CWD: chạy `--resume <sid>` từ thư mục khác sẽ báo
   "No conversation found with session ID" và tin nhắn RƠI VÀO HƯ KHÔNG.
   Dashboard trước đây luôn spawn từ home -> mọi phiên không thuộc home đều không
   nhắn được. Mỗi dòng .jsonl có sẵn trường cwd -> đọc ra để spawn đúng chỗ. */
const cwdCache = new Map(); // sid -> cwd (bất biến trong 1 phiên)
function sessionCwd(sid) {
  if (cwdCache.has(sid)) return cwdCache.get(sid);
  const file = findSessionFile(sid);
  let cwd = null;
  if (file) {
    try {
      // cwd nằm ngay dòng user đầu tiên — đọc 64KB đầu là đủ, khỏi nạp file 30MB
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(65536);
      const n = fs.readSync(fd, buf, 0, 65536, 0);
      fs.closeSync(fd);
      const m = buf.toString('utf8', 0, n).match(/"cwd":"((?:[^"\\]|\\.)*)"/);
      if (m) {
        const p = JSON.parse('"' + m[1] + '"');
        if (fs.existsSync(p)) cwd = p; // thư mục đã bị xoá -> để null, spawn ở home
      }
    } catch {}
  }
  cwdCache.set(sid, cwd);
  return cwd;
}

function findSessionFile(sid) {
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(PROJECTS_DIR, d, sid + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function statusOf(sid, mtimeMs) {
  if (procs.has(sid)) return 'RUNNING';
  if (mtimeMs && Date.now() - mtimeMs < 15000) return 'ACTIVE';
  return 'IDLE';
}

function listSessions() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return out; }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d);
    let files;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    } catch { continue; }
    const project = d.replace(/^-/, '').split('-').slice(-2).join('/') || d;
    for (const f of files) {
      const full = path.join(dir, f);
      const sid = f.replace(/\.jsonl$/, '');
      const parsed = parseSessionFile(full);
      if (!parsed) continue;
      // lần đầu server thấy session -> coi như đã xem hết (không báo unread cũ)
      if (!lastSeen.has(sid)) lastSeen.set(sid, parsed.mtimeMs);
      const seen = lastSeen.get(sid);
      const unread = parsed.tsMs.reduce((n, t) => n + (t > seen ? 1 : 0), 0);
      out.push({
        sid,
        project,
        title: titleOf(sid, parsed.title),
        msgs: parsed.msgs.length,
        unread,
        mtimeMs: parsed.mtimeMs,
        status: statusOf(sid, parsed.mtimeMs),
      });
    }
  }
  // sessions we spawned that have no jsonl yet
  for (const [sid, p] of procs) {
    if (!out.find(s => s.sid === sid)) {
      out.push({ sid, project: p.project || '(new)', msgs: 0, unread: 0, mtimeMs: p.startedAt, status: 'RUNNING' });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, 100);
}

/* ---------------- spawning claude ---------------- */

// sid -> thông báo lỗi lần chạy gần nhất (client hiện lên thay vì im lặng)
const spawnErrors = new Map();

function spawnClaude(args, sid, meta) {
  // CWD phải đúng thư mục của phiên, nếu không `--resume` báo "No conversation found"
  // và tin nhắn rơi vào hư không (API vẫn trả ok -> nhìn như gửi được mà chẳng có gì xảy ra)
  const cwd = (meta && meta.cwd) || sessionCwd(sid) || os.homedir();
  const proc = spawn('claude', args, {
    cwd,
    // KHÔNG detached: tiến trình tách nhóm thì Node không nhận được sự kiện exit/stderr,
    // nên mọi lỗi của CLI (vd resume trượt) bị nuốt sạch — đúng cái làm chat "gửi mà
    // không có gì xảy ra". Server sống lâu nên không cần detach để tiến trình chạy tiếp.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  spawnErrors.delete(sid);
  let errBuf = '', outBuf = '';
  if (proc.stderr) {
    proc.stderr.on('data', d => { errBuf = (errBuf + d.toString()).slice(-2000); });
    proc.stderr.on('error', () => {});
  }
  if (proc.stdout) {
    proc.stdout.on('data', d => { outBuf = (outBuf + d.toString()).slice(-2000); });
    proc.stdout.on('error', () => {});
  }
  proc.on('error', e => {
    procs.delete(sid);
    spawnErrors.set(sid, { at: Date.now(), msg: 'Không chạy được claude: ' + e.message });
  });
  proc.on('exit', (code, signal) => {
    procs.delete(sid);
    if (signal) return; // bị kill chủ động (nút Kill) -> không báo gì
    const err = errBuf.trim();
    // soi cả 2 luồng cho chắc (CLI có thể đổi chỗ in giữa các phiên bản)
    const failedResume = /No conversation found with session ID/i.test(errBuf + outBuf);
    if (code !== 0 || err || failedResume) {
      const msg = failedResume
        ? 'Claude CLI không tìm thấy phiên này (thư mục dự án gốc có thể đã bị xoá/đổi tên) — tin nhắn chưa được gửi.'
        : (err || 'claude thoát với mã ' + code);
      spawnErrors.set(sid, { at: Date.now(), msg: msg.split('\n').slice(0, 3).join(' ').slice(0, 300) });
      notifyPush(sessionLabel(sid) + ': ' + (failedResume ? 'không gửi được tin' : 'chạy lỗi'), sid);
      return; // thất bại thì đừng báo "đã trả lời xong"
    }
    notifyPush(sessionLabel(sid) + ' đã trả lời xong', sid);
  });
  procs.set(sid, { proc, startedAt: Date.now(), ...meta });
  return proc;
}

/* ---------------- oneshot / jobs ---------------- */

// Chạy claude 1-shot lấy stdout — dùng cho enhance/summary. Timeout 120s.
function runOneshot(prompt) {
  const id = crypto.randomUUID();
  const rec = { status: 'running', output: '' };
  oneshots.set(id, rec);
  try {
    const proc = spawn('claude', ['-p', prompt], { cwd: os.homedir(), env: process.env });
    let errBuf = '';
    proc.stdout.on('data', d => { rec.output += d.toString(); });
    proc.stderr.on('data', d => { errBuf += d.toString(); });
    proc.on('error', e => { rec.status = 'error'; rec.output += '[spawn error] ' + e.message; });
    const killer = setTimeout(() => {
      if (rec.status === 'running') {
        try { proc.kill('SIGTERM'); } catch {}
        rec.status = 'error';
        rec.output += '\n[timeout 120s]';
      }
    }, 120000);
    proc.on('close', code => {
      clearTimeout(killer);
      if (rec.status === 'running') rec.status = code === 0 ? 'done' : 'error';
      if (rec.status === 'error' && errBuf) rec.output += '\n' + errBuf.slice(-2000);
    });
  } catch (e) { rec.status = 'error'; rec.output = e.message; }
  // client poll xong trong <=120s (timeout) — dọn record sau 10 phút, tránh Map lớn dần mãi
  setTimeout(() => oneshots.delete(id), 600000).unref();
  return id;
}

// Parse interval kiểu '30s' / '5m' / '1h' -> ms, sai cú pháp trả null
function parseInterval(s) {
  const m = /^(\d+)([smh])$/.exec((s || '').trim());
  if (!m) return null;
  const n = +m[1];
  if (!n) return null;
  return m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60000 : n * 3600000;
}

// Chạy 1 lượt của loop/cron job: mỗi lượt là 1 session claude mới
function runJob(job) {
  const sid = crypto.randomUUID();
  const args = ['-p', job.prompt, '--session-id', sid].concat(permArgs());
  if (currentModel) args.push('--model', currentModel);
  spawnClaude(args, sid, { task: job.prompt, project: '(job:' + job.id + ')' });
  job.runs++;
  job.lastSid = sid;
}

// ---- cron tối giản: 5 trường "phút giờ ngày tháng thứ", hỗ trợ * , */n , a-b , a,b ----
function cronFieldMatch(field, val) {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    const step = /^\*\/(\d+)$/.exec(part);
    if (step) { if (+step[1] > 0 && val % +step[1] === 0) return true; continue; }
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) { if (val >= +range[1] && val <= +range[2]) return true; continue; }
    if (String(+part) === part && +part === val) return true;
  }
  return false;
}
function cronMatch(spec, d) {
  const f = spec.trim().split(/\s+/);
  if (f.length !== 5) return false;
  return cronFieldMatch(f[0], d.getMinutes()) && cronFieldMatch(f[1], d.getHours())
    && cronFieldMatch(f[2], d.getDate()) && cronFieldMatch(f[3], d.getMonth() + 1)
    && cronFieldMatch(f[4], d.getDay());
}
// Ticker 30s check cron jobs — mỗi phút khớp chỉ chạy đúng 1 lần (lastKey)
setInterval(() => {
  const d = new Date();
  const key = d.toISOString().slice(0, 16);
  for (const job of jobs.values()) {
    if (job.kind !== 'cron' || job.lastKey === key) continue;
    if (cronMatch(job.spec, d)) { job.lastKey = key; runJob(job); }
  }
}, 30000);

// Danh sách jobs gọn cho client
function listJobs() {
  return [...jobs.values()].map(j => ({
    id: j.id, kind: j.kind, spec: j.spec,
    prompt: j.prompt.slice(0, 80), runs: j.runs, lastSid: j.lastSid,
  }));
}

/* ---------------- Hermes (state.db SQLite qua sqlite3 CLI) ---------------- */

// Cache 1.5s — client poll 2.5s (realtime), vẫn tránh spawn sqlite3 dồn dập khi nhiều client
let hermesCache = { at: 0, data: null };
let hermesSending = 0; // số hermes CLI process đang chờ reply — client hiện typing indicator thật

function sqliteJson(sql) {
  return new Promise(resolve => {
    execFile('sqlite3', ['-readonly', '-json', HERMES_DB, sql],
      { maxBuffer: 16 * 1024 * 1024, timeout: 8000 },
      (err, out) => {
        if (err) return resolve(null);
        try { resolve(JSON.parse(out || '[]')); } catch { resolve(null); }
      });
  });
}

// Fallback khi không đọc được SQLite: parse agent.log ([USER]/[ASSISTANT])
function hermesFromLog() {
  let raw;
  try { raw = fs.readFileSync(HERMES_LOG, 'utf8'); } catch { return []; }
  const messages = [];
  for (const line of raw.split('\n').slice(-2000)) {
    let role = null;
    if (line.includes('[USER]')) role = 'user';
    else if (line.includes('[ASSISTANT]')) role = 'assistant';
    if (!role) continue;
    const content = line.replace(/^.*\[(USER|ASSISTANT)\]\s*/, '').trim();
    if (content) messages.push({ role, content, ts: 0 });
  }
  if (!messages.length) return [];
  return [{ id: 'agent.log', title: 'agent.log (fallback)', source: 'log', count: messages.length, lastTs: 0, messages: messages.slice(-50) }];
}

// GET /api/hermes -> { conversations: [{id,title,source,count,lastTs,messages:[{role,content,ts}]}] }
async function getHermesData() {
  if (hermesCache.data && Date.now() - hermesCache.at < 1500) return hermesCache.data;
  let conversations = null;

  if (fs.existsSync(HERMES_DB)) {
    const sess = await sqliteJson(
      "SELECT id, source, display_name, title, message_count, last_activity_at " +
      "FROM sessions WHERE message_count > 0 ORDER BY last_activity_at DESC LIMIT 15;");
    if (sess && sess.length) {
      // 1 query duy nhất lấy 30 message cuối của mỗi session (window function)
      const ids = sess.map(s => "'" + String(s.id).replace(/'/g, "''") + "'").join(',');
      const msgs = await sqliteJson(
        "SELECT session_id, role, substr(COALESCE(content,''),1,4000) AS content, timestamp FROM (" +
        "  SELECT session_id, role, content, timestamp," +
        "         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp DESC) rn" +
        "  FROM messages WHERE active=1 AND role IN ('user','assistant','tool')" +
        "  AND session_id IN (" + ids + ")" +
        ") WHERE rn <= 30 ORDER BY session_id, timestamp;");
      if (msgs) {
        const bySid = {};
        for (const m of msgs) {
          (bySid[m.session_id] = bySid[m.session_id] || []).push({
            role: m.role,
            content: m.content || '',
            ts: Math.round((m.timestamp || 0) * 1000), // epoch giây -> ms
          });
        }
        conversations = sess.map(s => ({
          id: s.id,
          title: s.title || s.display_name || s.id,
          source: s.source || '?',
          count: s.message_count || 0,
          lastTs: Math.round((s.last_activity_at || 0) * 1000),
          messages: bySid[s.id] || [],
        }));
      }
    } else if (sess) {
      conversations = [];
    }
  }
  if (conversations === null) conversations = hermesFromLog();

  const data = { conversations };
  hermesCache = { at: Date.now(), data };
  return data;
}

/* ---------------- AGY-PROXY: điều khiển CLI qua child_process ----------------
 * Dashboard KHÔNG implement logic proxy — chỉ spawn npm trong folder agy-proxy,
 * capture stdout/stderr vào ring buffer để client poll hiển thị realtime. */

const AGY_DIR = process.env.AGY_DIR || path.join(os.homedir(), 'Desktop', 'project', 'agy-proxy');
const AGY_ENV = path.join(AGY_DIR, '.env');

// data dir theo đúng logic paths.ts của agy-proxy: <ROOT>/data nếu tồn tại, không thì ~/.agyproxy
function agyDataDir() {
  const local = path.join(AGY_DIR, 'data');
  return fs.existsSync(local) ? local : path.join(os.homedir(), '.agyproxy', 'data');
}

// CHỈ các key KHÔNG nhạy cảm mới được đọc/ghi từ dashboard (không bao giờ trả
// DASHBOARD_PASSWORD / GATEWAY_API_KEY / OMNIROUTE_PASSWORD... về client).
const AGY_EDIT_KEYS = {
  PORT: { desc: 'Cổng gateway — đổi xong phải Restart', check: v => /^\d+$/.test(v) && +v >= 1 && +v <= 65535 },
  HOST: { desc: '127.0.0.1 (chỉ máy này) | 0.0.0.0 (LAN) — cần Restart', check: v => /^[\w.:-]+$/.test(v) },
  GATEWAY_ROTATION: {
    desc: 'Chiến lược xoay account: round-robin | full-first | failover | highest-first | smart',
    check: v => ['round-robin', 'full-first', 'failover', 'highest-first', 'smart'].includes(v),
  },
  GATEWAY_COOLDOWN_SEC: { desc: 'Cooldown (giây) khi account dính 429/hết quota', check: v => /^\d+$/.test(v) && +v >= 1 && +v <= 86400 },
  HEADLESS: { desc: 'true/false — browser ẩn hay hiện khi login Google', check: v => v === 'true' || v === 'false' },
  TOKEN_HEALTH_HOURS: { desc: 'Chu kỳ tự kiểm token health (giờ, 0 = tắt)', check: v => /^\d+$/.test(v) && +v <= 720 },
};

function readAgyEnv() {
  const out = {};
  let raw;
  try { raw = fs.readFileSync(AGY_ENV, 'utf8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Ghi 1 key vào .env: thay đúng dòng KEY=..., giữ nguyên comment và các dòng khác
function writeAgyEnv(key, value) {
  let raw = fs.readFileSync(AGY_ENV, 'utf8');
  const re = new RegExp('^' + key + '=.*$', 'm');
  raw = re.test(raw)
    ? raw.replace(re, () => key + '=' + value)
    : raw + (raw.endsWith('\n') ? '' : '\n') + key + '=' + value + '\n';
  fs.writeFileSync(AGY_ENV, raw);
}

// Port thực tế: settings DB của agy-proxy (đổi từ UI riêng, đè env) -> .env PORT -> 7788
async function agyPort() {
  const db = path.join(agyDataDir(), 'state.db');
  if (fs.existsSync(db)) {
    const rows = await new Promise(resolve => {
      execFile('sqlite3', ['-readonly', '-json', db, "SELECT value FROM settings WHERE key='port';"],
        { timeout: 4000 }, (err, out) => {
          if (err) return resolve(null);
          try { resolve(JSON.parse(out || '[]')); } catch { resolve(null); }
        });
    });
    if (rows && rows[0] && /^\d+$/.test(String(rows[0].value))) return +rows[0].value;
  }
  const env = readAgyEnv();
  return /^\d+$/.test(env.PORT || '') ? +env.PORT : 7788;
}

// ---- log ring buffer (dev + build/test/typecheck gộp chung 1 panel) ----
const agyLogBuf = [];
let agyLogStart = 0; // absolute index của agyLogBuf[0] — client poll bằng ?since=<abs index>
function agyLogPush(tag, chunk) {
  const lines = String(chunk).split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const l of lines) agyLogBuf.push('[' + tag + '] ' + l);
  const over = agyLogBuf.length - 800;
  if (over > 0) { agyLogBuf.splice(0, over); agyLogStart += over; }
}

let agyDev = null;  // { proc, startedAt } — npm run dev do dashboard spawn
let agyTask = null; // { name, proc, startedAt } — build/test/typecheck đang chạy (1 lúc 1 cái)
const agyLast = {}; // name -> { ok, code, at, ms } kết quả lần chạy cuối
let agyStatusCache = { at: 0, data: null }; // cache 3s — client poll 3s, probe HTTP không dồn dập

function agyPipe(proc, tag) {
  proc.stdout.on('data', d => agyLogPush(tag, d));
  proc.stderr.on('data', d => agyLogPush(tag, d));
}

function agyStartDev() {
  if (agyDev) return { error: 'dev server đã chạy (pid ' + agyDev.proc.pid + ')' };
  const proc = spawn('npm', ['run', 'dev'], { cwd: AGY_DIR, detached: true, env: process.env });
  const rec = { proc, startedAt: Date.now() };
  agyDev = rec;
  agyLogPush('dev', '$ npm run dev (pid ' + proc.pid + ')');
  agyPipe(proc, 'dev');
  // chỉ null-out khi agyDev vẫn là record này — exit muộn của proc cũ (sau Stop→Start
  // nhanh / Restart) không được xóa record của proc MỚI
  proc.on('error', e => { agyLogPush('dev', '[spawn error] ' + e.message); if (agyDev === rec) agyDev = null; });
  proc.on('exit', code => { agyLogPush('dev', '[exit code=' + code + ']'); if (agyDev === rec) agyDev = null; agyStatusCache.at = 0; });
  agyStatusCache.at = 0;
  return { ok: true, pid: proc.pid };
}

function agyStopDev() {
  if (!agyDev) return { error: 'dev server không do dashboard start — nếu agy-proxy chạy ngoài, dừng thủ công' };
  const p = agyDev.proc;
  // detached:true -> kill cả process group (tsx watch spawn con)
  try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch {} }
  agyLogPush('dev', '[stop] SIGTERM pid ' + p.pid);
  agyDev = null;
  agyStatusCache.at = 0;
  return { ok: true };
}

const AGY_TASKS = {
  build: { args: ['run', 'build'], cwd: 'web' },      // cd web && npm run build
  test: { args: ['test'], cwd: '' },                  // npm test
  typecheck: { args: ['run', 'typecheck'], cwd: '' }, // tsc --noEmit
};

function agyRun(name) {
  const t = AGY_TASKS[name];
  if (!t) return { error: 'cmd không hợp lệ (build | test | typecheck)' };
  if (agyTask) return { error: 'đang chạy ' + agyTask.name + ' — đợi xong đã' };
  const started = Date.now();
  let proc;
  try {
    proc = spawn('npm', t.args, { cwd: path.join(AGY_DIR, t.cwd), env: process.env });
  } catch (e) { return { error: e.message }; }
  const rec = { name, proc, startedAt: started };
  agyTask = rec;
  agyLogPush(name, '$ npm ' + t.args.join(' ') + (t.cwd ? ' (trong ' + t.cwd + '/)' : ''));
  agyPipe(proc, name);
  const killer = setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} agyLogPush(name, '[timeout 10m]'); }, 600000);
  // spawn fail phát CẢ 'error' lẫn 'close' -> settle đúng 1 lần, không ghi đè kết quả
  // và không null-out agyTask của lần chạy sau
  let settled = false;
  const settle = (ok, code, log) => {
    if (settled) return;
    settled = true;
    clearTimeout(killer);
    agyLogPush(name, log);
    agyLast[name] = { ok, code, at: Date.now(), ms: Date.now() - started };
    if (agyTask === rec) agyTask = null;
    agyStatusCache.at = 0;
  };
  proc.on('error', e => settle(false, -1, '[spawn error] ' + e.message));
  proc.on('close', code => settle(code === 0, code,
    '[done code=' + code + ' trong ' + Math.round((Date.now() - started) / 1000) + 's]'));
  return { ok: true };
}

// GET JSON ngắn gọn có timeout — probe status + lấy models từ gateway
function httpGetJson(urlStr, headers, timeoutMs) {
  return new Promise(resolve => {
    const req = http.get(urlStr, { headers, timeout: timeoutMs }, r => {
      let buf = '';
      r.on('data', c => { buf += c; if (buf.length > 1e6) req.destroy(); });
      r.on('end', () => {
        try { resolve({ code: r.statusCode, json: JSON.parse(buf) }); }
        catch { resolve({ code: r.statusCode, json: null }); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/* ---- sức khoẻ tài khoản: đọc accounts.csv (1.9MB) -> cache theo mtime,
   client poll 3s nên KHÔNG được parse lại mỗi lần ---- */
let agyAccCache = { mtimeMs: 0, size: 0, data: null };
function readAgyAccounts() {
  const f = path.join(agyDataDir(), 'accounts.csv');
  let st;
  try { st = fs.statSync(f); } catch { return { total: 0, status: {}, kiro: {}, recent24h: 0 }; }
  if (agyAccCache.data && agyAccCache.mtimeMs === st.mtimeMs && agyAccCache.size === st.size) return agyAccCache.data;
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch { return { total: 0, status: {}, kiro: {}, recent24h: 0 }; }
  const lines = raw.split('\n').filter(l => l.trim());
  const hdr = (lines[0] || '').split(',');
  const iAgy = hdr.indexOf('status_agy');
  const iKiro = hdr.indexOf('status_kiro');
  const iLast = hdr.indexOf('last_run');
  const status = {}, kiro = {};
  let recent24h = 0;
  const now = Date.now();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (iAgy >= 0) { const v = c[iAgy] || 'unknown'; status[v] = (status[v] || 0) + 1; }
    if (iKiro >= 0) { const v = c[iKiro] || 'unknown'; kiro[v] = (kiro[v] || 0) + 1; }
    if (iLast >= 0) { const t = Date.parse(c[iLast]); if (t && now - t < 86400000) recent24h++; }
  }
  const data = { total: lines.length - 1, status, kiro, recent24h };
  agyAccCache = { mtimeMs: st.mtimeMs, size: st.size, data };
  return data;
}

// Gom model theo nhà cung cấp: "agy/gemini-3-pro-high" -> nhóm "gemini"
function groupModels(models) {
  const g = {};
  for (const m of models) {
    const body = String(m).indexOf('/') >= 0 ? String(m).split('/').slice(1).join('/') : String(m);
    const key = (body.split('-')[0] || 'khác').toLowerCase();
    (g[key] = g[key] || []).push(m);
  }
  // nhóm chỉ có 1 model -> dồn vào "khác", tránh 20 nhóm vụn mỗi nhóm 1 dòng
  const keys = Object.keys(g).sort((a, b) => g[b].length - g[a].length);
  const out = [], rest = [];
  for (const k of keys) { if (g[k].length > 1) out.push({ name: k, items: g[k] }); else rest.push(g[k][0]); }
  if (rest.length) out.push({ name: 'khác', items: rest });
  return out;
}

/* ---- lưu lượng thật: bảng gateway_usage trong state.db của agy-proxy ----
   Mỗi request 1 dòng (ts, model, token, ok, ms, status) -> thống kê được tỉ lệ lỗi,
   model dùng nhiều, biểu đồ theo giờ. Dùng sqlite3 CLI readonly như phần Hermes
   (dự án zero-dependency, không thêm module). */
let agyUsageCache = { at: 0, data: null };

function agySqlite(sql) {
  const db = path.join(agyDataDir(), 'state.db');
  return new Promise(resolve => {
    execFile('sqlite3', ['-readonly', '-json', db, sql],
      { maxBuffer: 8 * 1024 * 1024, timeout: 5000 },
      (err, out) => {
        if (err) return resolve(null);
        try { resolve(JSON.parse(out || '[]')); } catch { resolve(null); }
      });
  });
}

async function getAgyUsage() {
  // cache 15s: số liệu 24h không đổi theo từng giây, client poll 3s
  if (agyUsageCache.data && Date.now() - agyUsageCache.at < 15000) return agyUsageCache.data;
  const DAY = "ts > (strftime('%s','now')*1000 - 86400000)";
  const [sum, models, codes, hours] = await Promise.all([
    agySqlite('SELECT COUNT(*) reqs, SUM(ok=0) errs, SUM(prompt_tokens+completion_tokens) tokens,'
      + ' CAST(AVG(ms) AS INT) avgMs FROM gateway_usage WHERE ' + DAY + ';'),
    agySqlite('SELECT model, COUNT(*) n, SUM(ok=0) e FROM gateway_usage WHERE ' + DAY
      + ' GROUP BY model ORDER BY n DESC LIMIT 5;'),
    agySqlite('SELECT status, COUNT(*) n FROM gateway_usage WHERE ok=0 AND ' + DAY
      + ' GROUP BY status ORDER BY n DESC LIMIT 5;'),
    // 12 giờ gần nhất cho biểu đồ cột mini
    agySqlite("SELECT strftime('%H',ts/1000,'unixepoch','localtime') h, COUNT(*) n, SUM(ok=0) e"
      + ' FROM gateway_usage WHERE ts > (strftime(\'%s\',\'now\')*1000 - 43200000) GROUP BY h ORDER BY h;'),
  ]);
  const s = (sum && sum[0]) || {};
  const data = sum ? {
    ok: true,
    reqs: s.reqs || 0,
    errs: s.errs || 0,
    tokens: s.tokens || 0,
    avgMs: s.avgMs || 0,
    models: models || [],
    codes: codes || [],
    hours: hours || [],
  } : { ok: false }; // không đọc được DB (thiếu sqlite3 CLI / file khoá) -> client ẩn khối này
  agyUsageCache = { at: Date.now(), data };
  return data;
}

async function getAgyStatus() {
  if (agyStatusCache.data && Date.now() - agyStatusCache.at < 3000) return agyStatusCache.data;
  const port = await agyPort();
  const env = readAgyEnv();
  const headers = env.GATEWAY_API_KEY ? { Authorization: 'Bearer ' + env.GATEWAY_API_KEY } : {};
  const r = await httpGetJson('http://127.0.0.1:' + port + '/proxy/v1/models', headers, 1500);
  const running = !!r; // có phản hồi HTTP (kể cả 401) = process đang listen
  const models = (r && r.json && Array.isArray(r.json.data)) ? r.json.data.map(x => x.id) : [];
  let accounts = 0;
  try {
    const csv = fs.readFileSync(path.join(agyDataDir(), 'accounts.csv'), 'utf8');
    accounts = Math.max(0, csv.split('\n').filter(l => l.trim()).length - 1); // trừ header
  } catch {}
  const acc = readAgyAccounts();
  const usage = await getAgyUsage();
  const data = {
    running, port, accounts, models, usage,
    modelGroups: groupModels(models),
    acc,                       // sức khoẻ tài khoản: ok/new/failed/needs_human + chạy 24h
    external: running && !agyDev, // proxy đang chạy NGOÀI dashboard -> Stop/Restart không tác dụng
    dev: agyDev ? { pid: agyDev.proc.pid, startedAt: agyDev.startedAt } : null,
    task: agyTask ? { name: agyTask.name, startedAt: agyTask.startedAt } : null,
    last: agyLast,
  };
  agyStatusCache = { at: Date.now(), data };
  return data;
}

/* ---------------- http helpers ---------------- */

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req, maxBytes) {
  const cap = maxBytes || 1e6;
  return new Promise((resolve, reject) => {
    // Bắt buộc Content-Type JSON: fetch cross-origin với JSON header phải qua CORS preflight
    // (server này không trả CORS header) -> chặn CSRF kiểu gửi text/plain từ trang web lạ.
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      return reject(new Error('content-type must be application/json'));
    }
    let buf = '';
    let overflow = false;
    req.on('data', c => {
      buf += c;
      if (buf.length > cap) { overflow = true; reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (overflow) return;
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// Chặn DNS rebinding: chỉ nhận request có Host là localhost / IP LAN riêng / *.local.
// Attacker rebind domain -> IP nội bộ sẽ gửi Host: evil.com và bị chặn ở đây.
function hostAllowed(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)
    // Tailscale: CGNAT 100.64.0.0/10 + IPv6 fd7a::/16 + MagicDNS *.ts.net
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)
    || /^fd7a:/i.test(host)
    || host.endsWith('.ts.net')
    || host.endsWith('.local');
}

/* ---------------- Web Push: VAPID + RFC 8291 aes128gcm (zero deps) ---------------- */
// Push THẬT qua push service của browser (FCM/APNs/Mozilla) — notification hiện trên
// điện thoại kể cả khi đã đóng tab. Yêu cầu phía client: secure context (https/localhost).

// Neo vào GỐC DỰ ÁN, không phải __dirname: khi tách file vào src/server/ thì __dirname
// đổi -> sinh khoá VAPID mới -> mọi đăng ký thông báo trên máy người dùng chết im lặng.
const ROOT_DIR = path.join(__dirname, '..', '..');
const PUSH_STATE_FILE = process.env.PUSH_STATE_FILE || path.join(ROOT_DIR, '.push-state.json');
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:claude@onluyen.edu.vn';
const b64u = buf => Buffer.from(buf).toString('base64url');

// Keypair ưu tiên env VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (base64url); không có thì
// generate 1 lần rồi persist — đổi key là MỌI subscription cũ chết nên phải giữ ổn định
// qua restart. Subscriptions cũng persist cùng file (gitignored).
let pushState = { publicKey: '', privateKey: '', subs: [] };
try { pushState = { ...pushState, ...JSON.parse(fs.readFileSync(PUSH_STATE_FILE, 'utf8')) }; } catch {}
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  pushState.publicKey = process.env.VAPID_PUBLIC_KEY;
  pushState.privateKey = process.env.VAPID_PRIVATE_KEY;
} else if (!pushState.publicKey || !pushState.privateKey) {
  const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ format: 'jwk' });
  // public = điểm uncompressed 65B (0x04 || X || Y), private = scalar D 32B
  pushState.publicKey = b64u(Buffer.concat([
    Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url'),
  ]));
  pushState.privateKey = jwk.d;
  savePushState();
}

function savePushState() {
  try { fs.writeFileSync(PUSH_STATE_FILE, JSON.stringify(pushState, null, 2)); } catch {}
}

function removeSub(endpoint) {
  const n = pushState.subs.length;
  pushState.subs = pushState.subs.filter(s => s.endpoint !== endpoint);
  if (pushState.subs.length !== n) savePushState();
}

// Authorization header VAPID (RFC 8292): JWT ES256 ký bằng private key, aud = origin push service
function vapidAuth(endpoint) {
  const pub = Buffer.from(pushState.publicKey, 'base64url');
  const key = crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: pushState.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
  });
  const seg = o => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = seg({ typ: 'JWT', alg: 'ES256' }) + '.'
    + seg({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT });
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + unsigned + '.' + b64u(sig) + ', k=' + pushState.publicKey;
}

// Mã hoá payload theo RFC 8291 (ECDH P-256 + HKDF + AES-128-GCM, content coding aes128gcm)
function encryptPush(sub, payload) {
  const uaPub = Buffer.from(sub.keys.p256dh, 'base64url'); // public key browser (65B)
  const authSecret = Buffer.from(sub.keys.auth, 'base64url'); // auth secret 16B
  const ecdh = crypto.createECDH('prime256v1');
  const asPub = ecdh.generateKeys(); // ephemeral keypair phía server
  const shared = ecdh.computeSecret(uaPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // record cuối: plaintext + delimiter 0x02, không pad thêm
  const cipher = Buffer.concat([c.update(Buffer.concat([payload, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  // header aes128gcm: salt(16) + rs(4, 4096) + idlen(1) + keyid(as_public 65B)
  return Buffer.concat([salt, Buffer.from([0, 0, 16, 0, 65]), asPub, cipher]);
}

function sendPush(sub, dataObj) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(sub.endpoint); } catch { return resolve({ status: 0, error: 'bad endpoint' }); }
    // push service thật luôn https; http chỉ cho loopback (test local)
    const mod = u.protocol === 'https:' ? https
      : (u.hostname === '127.0.0.1' || u.hostname === 'localhost') ? http : null;
    if (!mod) return resolve({ status: 0, error: 'endpoint phải là https' });
    let body;
    try { body = encryptPush(sub, Buffer.from(JSON.stringify(dataObj))); } catch (e) { return resolve({ status: 0, error: e.message }); }
    const req2 = mod.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length': body.length,
        TTL: '3600',
        Urgency: 'high',
        Authorization: vapidAuth(sub.endpoint),
      },
      timeout: 10000,
    }, r => {
      r.resume();
      // 404/410 = subscription đã chết (user gỡ app / revoke quyền) -> tự dọn
      if (r.statusCode === 404 || r.statusCode === 410) removeSub(sub.endpoint);
      resolve({ status: r.statusCode });
    });
    req2.on('timeout', () => req2.destroy(new Error('timeout')));
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end(body);
  });
}

async function pushAll(dataObj) {
  const subs = pushState.subs.slice();
  const results = await Promise.all(subs.map(s => sendPush(s, dataObj)));
  return {
    total: subs.length,
    sent: results.filter(r => r.status >= 200 && r.status < 300).length,
    results: results.map((r, i) => ({ endpoint: subs[i].endpoint.slice(0, 60), ...r })),
  };
}

// Bắn push khi Claude/Hermes trả lời xong. SW phía client quyết định hiển thị:
// có tab visible thì bỏ qua (toast/beep local đã lo), tab ẩn/đóng mới hiện notification.
function notifyPush(msg, sid) {
  if (!pushState.subs.length) return;
  pushAll({ title: 'Claude Control Center', body: msg, tag: 'ccc-done', sid: sid || null, url: '/' }).catch(() => {});
}

/* ---------------- ảnh gửi từ điện thoại ----------------
   Lưu ra đĩa rồi đưa Claude đường dẫn (CLI đọc ảnh qua tool Read). Tự dọn ảnh cũ
   để thư mục không phình vô hạn. */
const UPLOAD_DIR = path.join(os.homedir(), '.claude', 'dashboard-uploads');
const UPLOAD_KEEP_MS = 7 * 24 * 3600 * 1000; // giữ 7 ngày
const UPLOAD_KEEP_N = 200;                    // hoặc tối đa 200 ảnh gần nhất
function pruneUploads() {
  let files;
  try {
    files = fs.readdirSync(UPLOAD_DIR)
      .map(f => { const p2 = path.join(UPLOAD_DIR, f); try { return { p: p2, t: fs.statSync(p2).mtimeMs }; } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => b.t - a.t);
  } catch { return; }
  const now = Date.now();
  files.forEach((f, i) => {
    if (i >= UPLOAD_KEEP_N || now - f.t > UPLOAD_KEEP_MS) { try { fs.unlinkSync(f.p); } catch {} }
  });
}

/* ---------------- token truy cập ----------------
   hostAllowed() KHÔNG phải cơ chế bảo mật: nó đọc header Host do client tự khai,
   `curl -H "Host: fake.ts.net"` là vượt qua. Mà /api/task giao việc cho Claude ở chế độ
   acceptEdits = chạy lệnh tuỳ ý trên máy. Nên mọi endpoint GHI dữ liệu phải có token. */
const TOKEN_FILE = path.join(os.homedir(), '.claude', 'dashboard-token.json');
let dashToken = process.env.DASH_TOKEN || '';
if (!dashToken) {
  try { dashToken = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token || ''; } catch {}
}
if (!dashToken) {
  dashToken = crypto.randomBytes(18).toString('base64url');
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token: dashToken }, null, 2), { mode: 0o600 }); } catch {}
}

// Request từ chính máy này (loopback) khỏi cần token — curl/script local vẫn tiện dùng
function isLoopback(req) {
  const a = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function tokenOk(req, url) {
  const h = req.headers['x-dash-token'];
  if (h && String(h) === dashToken) return true;
  const q = url.searchParams.get('t');
  return !!(q && q === dashToken);
}

/* ---------------- phục vụ giao diện tĩnh ----------------
   Hai giao diện song song trong lúc di trú:
     web-next/out  — bản mới (Next.js + shadcn, kiểu Atlas)
     web/legacy    — bản cũ, giữ nguyên làm đường lui
   NEW_UI=0 để quay về bản cũ tức thì nếu bản mới có vấn đề. */
const LEGACY_DIR = path.join(__dirname, '..', '..', 'web', 'legacy');
const NEXT_DIR = path.join(__dirname, '..', '..', 'web-next', 'out');
const USE_NEW_UI = process.env.NEW_UI !== '0' && fs.existsSync(path.join(NEXT_DIR, 'index.html'));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
               '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
               '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
               '.woff2': 'font/woff2', '.png': 'image/png' };
function sendFile(res, f, cache) {
  let buf;
  try { buf = fs.readFileSync(f); } catch { return json(res, 404, { error: 'not found' }); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
                       'Cache-Control': cache || 'no-cache' });
  return res.end(buf);
}
function serveWeb(res, name) {
  return sendFile(res, path.join(LEGACY_DIR, name)); // no-cache: sửa file là thấy ngay
}
// Tài nguyên Next: /_next/... đặt tên theo hash nội dung nên cache vĩnh viễn được.
// Chặn ../ bằng cách kiểm tra đường dẫn thật vẫn nằm trong NEXT_DIR.
function serveNext(res, urlPath) {
  const f = path.join(NEXT_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!path.resolve(f).startsWith(path.resolve(NEXT_DIR))) return json(res, 404, { error: 'not found' });
  const immutable = urlPath.startsWith('/_next/static/');
  return sendFile(res, f, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  if (!hostAllowed(req)) return json(res, 403, { error: 'forbidden host' });
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // Vỏ app + PWA cho qua (không có dữ liệu nhạy cảm, cần cho màn nhập token & offline).
  // Mọi thứ còn lại — kể cả GET /api/* vì chúng lộ nội dung hội thoại — đều cần token.
  // Vỏ app gồm cả JS/CSS của giao diện — không có dữ liệu nhạy cảm, mà thiếu chúng thì
  // màn nhập token không hiện được (trang trắng) và offline cũng hỏng.
  const isShell = p === '/' || p === '/index.html' || p === '/manifest.json' || p === '/sw.js'
    || p === '/icon.svg' || p === '/favicon.ico' || p === '/app.css'
    || p.startsWith('/_next/') || /^\/js\/[a-z-]+\.js$/.test(p);
  if (!isShell && !isLoopback(req) && !tokenOk(req, url)) {
    return json(res, 401, { error: 'cần token truy cập' });
  }

  // Giao diện mới (Next.js, kiểu Atlas) — NEW_UI=0 để quay về bản cũ tức thì
  if (USE_NEW_UI && (p === '/' || p === '/index.html')) return serveNext(res, '/');
  if (USE_NEW_UI && p.startsWith('/_next/')) return serveNext(res, p);
  if (USE_NEW_UI && p === '/favicon.ico') return serveNext(res, p);

  // Giao diện cũ: file tĩnh trong web/legacy. Trước đây HTML/CSS/JS nhúng trong template
  // literal -> viết \\n hay dấu backtick là âm thầm làm vỡ cả trang mà node -c không thấy.
  if (p === '/' || p === '/index.html') return serveWeb(res, 'index.html');
  if (p === '/app.css') return serveWeb(res, 'app.css');
  // client JS chia theo tính năng: /js/core.js, /js/chat.js, /js/agy.js…
  // chỉ nhận tên file phẳng [a-z-] để không thể dùng ../ thoát khỏi web/legacy
  const jsFile = p.match(/^\/js\/([a-z-]+\.js)$/);
  if (jsFile) return serveWeb(res, path.join('js', jsFile[1]));

  // ---- PWA: manifest + service worker + icon ----
  if (p === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    return res.end(MANIFEST);
  }
  if (p === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(SW_JS);
  }
  if (p === '/icon.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=86400' });
    return res.end(ICON_SVG);
  }

  if (p === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = () => {
      // payload object: sessions + jobs đang chạy + model hiện tại
      try { res.write(`data: ${JSON.stringify({ sessions: listSessions(), jobs: listJobs(), model: currentModel, perm: permMode })}\n\n`); } catch {}
    };
    send();
    const iv = setInterval(send, 2000);
    req.on('close', () => clearInterval(iv));
    return;
  }

  if (p === '/api/task' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const task = (body.task || '').trim();
    if (!task) return json(res, 400, { error: 'task required' });
    const sid = crypto.randomUUID();
    const args = ['-p', task, '--session-id', sid].concat(permArgs());
    if (currentModel) args.push('--model', currentModel); // model đã set qua /model
    spawnClaude(args, sid, { task, project: '(new)' });
    return json(res, 200, { ok: true, sid });
  }

  let m;
  if ((m = p.match(/^\/api\/chat\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const msg = (body.message || '').trim();
    if (!msg) return json(res, 400, { error: 'message required' });
    if (procs.has(sid)) return json(res, 409, { error: 'session is busy' });
    const cargs = ['-p', msg, '--resume', sid].concat(permArgs());
    const mdl = modelFor(sid);              // model riêng phiên > model toàn cục
    if (mdl) cargs.push('--model', mdl);
    spawnClaude(cargs, sid, { task: msg });
    return json(res, 200, { ok: true, sid });
  }

  if ((m = p.match(/^\/api\/kill\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    const entry = procs.get(sid);
    if (!entry) return json(res, 404, { error: 'not running' });
    // không còn detached -> kill thẳng tiến trình; giữ kill theo nhóm làm dự phòng
    try { entry.proc.kill('SIGTERM'); } catch { try { process.kill(-entry.proc.pid, 'SIGTERM'); } catch {} }
    procs.delete(sid);
    return json(res, 200, { ok: true });
  }

  if ((m = p.match(/^\/api\/history\/([\w-]+)$/))) {
    const sid = m[1];
    const typing = procs.has(sid);
    const file = findSessionFile(sid);
    // user đang xem chat -> đánh dấu đã đọc (chỉ set cho session THẬT, sid rác không phình Map)
    if (file || typing) lastSeen.set(sid, Date.now());
    if (!file) return json(res, 200, { sid, messages: [], total: 0, start: 0, typing, status: statusOf(sid, 0) });
    let mt = 0;
    try { mt = fs.statSync(file).mtimeMs; } catch {}
    const messages = getHistory(sid) || [];
    // total: TỔNG message tuyệt đối (messages chỉ là window 30 cuối) — client cần để
    // quy đổi offset /clear; thiếu total thì /clear trên session >30 msg mất message mới vĩnh viễn
    const parsed = parseSessionFile(file);
    const total = parsed ? parsed.msgs.length : messages.length;
    // start: chỉ số tuyệt đối của messages[0]. Client so start để biết window ĐÃ TRƯỢT
    // (msg mới đẩy msg cũ ra, length không đổi) — thiếu nó thì client đứng hình không nhận msg mới.
    const start = Math.max(0, total - messages.length);
    // tool_use chưa có result + session đang chạy = đang thực thi -> chip "running".
    // Không typing thì để pending (run bị kill/ngắt), client hiện chip mờ.
    if (typing && messages.length) {
      const last = messages[messages.length - 1];
      if (last.parts) {
        last.parts = last.parts.map(p => (p.t === 'tool' && p.status === 'pending' ? Object.assign({}, p, { status: 'running' }) : p));
      }
    }
    // lỗi lần chạy gần nhất (vd resume trượt) — client hiện banner thay vì im lặng
    const se = spawnErrors.get(sid);
    return json(res, 200, {
      sid, messages, total, start, typing,
      title: titleOf(sid, parsed ? parsed.title : ''),
      status: statusOf(sid, mt),
      error: se && Date.now() - se.at < 120000 ? se.msg : null,
      // đang chờ duyệt kế hoạch: có file plan ở lượt cuối và Claude đã dừng
      awaiting: !!(parsed && parsed.planFile && !typing),
      usage: parsed ? parsed.usage : null, // token đã dùng (thay cho /cost)
      model: loadModels()[sid] || null,    // model riêng phiên (null = theo model toàn cục)
    });
  }

  // ---- model riêng cho 1 phiên (để trống = dùng lại model toàn cục) ----
  if ((m = p.match(/^\/api\/model\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const mv = String(body.model || '').trim();
    if (!setSessionModel(sid, mv)) return json(res, 500, { error: 'không ghi được file model' });
    return json(res, 200, { ok: true, model: mv || null, effective: modelFor(sid) });
  }

  // ---- nhận ảnh từ điện thoại: lưu ra file rồi trả đường dẫn để chèn vào prompt.
  // Claude CLI đọc ảnh qua tool Read, nên chỉ cần đưa nó đường dẫn trên đĩa. ----
  if (p === '/api/upload' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 12e6); }   // 12MB base64 ≈ ảnh gốc ~9MB
    catch (e) { return json(res, 400, { error: /large/.test(e.message) ? 'ảnh quá lớn (tối đa ~8MB)' : 'body lỗi' }); }
    const m2 = String(body.data || '').match(/^data:(image\/[a-z.+-]+);base64,(.+)$/i);
    if (!m2) return json(res, 400, { error: 'chỉ nhận ảnh' });
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
                   'image/gif': 'gif', 'image/heic': 'heic' })[m2[1].toLowerCase()] || 'png';
    let buf;
    try { buf = Buffer.from(m2[2], 'base64'); } catch { return json(res, 400, { error: 'dữ liệu ảnh hỏng' }); }
    if (!buf.length) return json(res, 400, { error: 'ảnh rỗng' });
    try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
    const name = 'img-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.' + ext;
    const dest = path.join(UPLOAD_DIR, name);
    try { fs.writeFileSync(dest, buf); } catch (e) { return json(res, 500, { error: 'không lưu được ảnh' }); }
    pruneUploads();
    return json(res, 200, { ok: true, path: dest, name, bytes: buf.length });
  }

  // ---- duyệt kế hoạch: chạy tiếp lượt đang chờ, lần này CHO PHÉP sửa file ----
  if ((m = p.match(/^\/api\/approve\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    if (procs.has(sid)) return json(res, 409, { error: 'session đang chạy' });
    let body = {};
    try { body = await readBody(req); } catch {}
    const note = String(body.note || '').trim();
    const msg = note
      ? 'Duyệt kế hoạch, làm luôn. Lưu ý thêm: ' + note
      : 'Duyệt kế hoạch. Thực hiện đúng như đã trình bày.';
    // ép acceptEdits cho lượt này, bất kể công tắc đang ở chế độ nào — người dùng vừa duyệt rồi
    const aargs = ['-p', msg, '--resume', sid, '--permission-mode', 'acceptEdits'];
    const amdl = modelFor(sid);
    if (amdl) aargs.push('--model', amdl);
    spawnClaude(aargs, sid, { task: msg });
    return json(res, 200, { ok: true, sid });
  }

  // ---- đổi tên phiên chat (ghi riêng dashboard, không đụng .jsonl của Claude CLI) ----
  if ((m = p.match(/^\/api\/title\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const name = String(body.title == null ? '' : body.title).trim().slice(0, 120);
    if (!setTitle(sid, name)) return json(res, 500, { error: 'không ghi được file tên' });
    // trả lại tiêu đề hiệu lực: xoá tên tự đặt thì rơi về ai-title
    const file = findSessionFile(sid);
    const parsed = file ? parseSessionFile(file) : null;
    return json(res, 200, { ok: true, title: titleOf(sid, parsed ? parsed.title : '') });
  }

  // ---- ảnh trong tool_result (screenshot...): trả binary, cache lâu vì nội dung bất biến ----
  if ((m = p.match(/^\/api\/toolimg\/([\w-]+)\/([\w-]+)\/(\d+)$/))) {
    const file = findSessionFile(m[1]);
    if (!file) return json(res, 404, { error: 'session not found' });
    const img = findToolImage(file, m[2], +m[3]);
    if (!img) return json(res, 404, { error: 'image not found' });
    res.writeHead(200, {
      'Content-Type': img.mt,
      'Content-Length': img.buf.length,
      'Cache-Control': 'public, max-age=31536000, immutable', // tool_result đã ghi thì không đổi
    });
    return res.end(img.buf);
  }

  if ((m = p.match(/^\/api\/status\/([\w-]+)$/))) {
    const sid = m[1];
    const file = findSessionFile(sid);
    let mt = 0;
    if (file) { try { mt = fs.statSync(file).mtimeMs; } catch {} }
    return json(res, 200, { sid, status: statusOf(sid, mt), running: procs.has(sid), typing: procs.has(sid) });
  }

  // ---- export: tải FULL session (không giới hạn window 30) ra .md / .json ----
  if ((m = p.match(/^\/api\/export\/([\w-]+)$/))) {
    const sid = m[1];
    const file = findSessionFile(sid);
    const parsed = file ? parseSessionFile(file) : null;
    if (!parsed) return json(res, 404, { error: 'session not found' });
    const fmt = url.searchParams.get('fmt') === 'json' ? 'json' : 'md';
    const msgs = parsed.msgs.map(x => ({ role: x.role, content: x.text, ts: x.ts, parts: x.parts }));
    let body, type;
    if (fmt === 'json') {
      body = JSON.stringify({ sid, exportedAt: new Date().toISOString(), count: msgs.length, messages: msgs }, null, 2);
      type = 'application/json';
    } else {
      body = '# Claude session ' + sid + '\n\n'
        + msgs.map(x => '**' + (x.role === 'user' ? 'User' : 'Assistant') + '**'
          + (x.ts ? ' · ' + x.ts : '') + ':\n\n' + mdForMessage(x) + '\n\n---\n').join('\n');
      type = 'text/markdown; charset=utf-8';
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Disposition': 'attachment; filename="claude-' + sid.slice(0, 8) + '.' + fmt + '"',
    });
    return res.end(body);
  }

  // ---- /model: set model cho task mới ----
  if (p === '/api/model' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    currentModel = (body.model || '').trim() || null;
    return json(res, 200, { ok: true, model: currentModel });
  }

  // ---- chế độ quyền: quyết định Claude có tự sửa file được không ----
  if (p === '/api/perm' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const mode = String(body.mode || '');
    if (PERM_MODES.indexOf(mode) < 0) return json(res, 400, { error: 'mode không hợp lệ' });
    permMode = mode;
    savePermMode();
    return json(res, 200, { ok: true, mode: permMode });
  }

  // ---- /loop: tạo loop job chạy prompt mỗi interval ----
  if (p === '/api/loop' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const ms = parseInterval(body.interval);
    const prompt = (body.prompt || '').trim();
    if (!ms || !prompt) return json(res, 400, { error: 'cần interval (vd 30s/5m/1h) và prompt' });
    if (ms < 30000) return json(res, 400, { error: 'interval tối thiểu 30s (mỗi lượt spawn 1 claude process)' });
    const id = crypto.randomUUID().slice(0, 8);
    const job = { id, kind: 'loop', spec: body.interval, prompt, runs: 0, lastSid: null };
    job.timer = setInterval(() => runJob(job), ms);
    jobs.set(id, job);
    runJob(job); // chạy ngay lượt đầu
    return json(res, 200, { ok: true, id });
  }

  // ---- /schedule: tạo cron job ----
  if (p === '/api/schedule' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const spec = (body.cron || '').trim();
    const prompt = (body.prompt || '').trim();
    if (spec.split(/\s+/).length !== 5 || !prompt) {
      return json(res, 400, { error: 'cần cron 5 trường (vd "*/15 * * * *") và prompt' });
    }
    const id = crypto.randomUUID().slice(0, 8);
    jobs.set(id, { id, kind: 'cron', spec, prompt, runs: 0, lastSid: null, lastKey: '' });
    return json(res, 200, { ok: true, id });
  }

  // ---- danh sách / dừng jobs ----
  if (p === '/api/jobs' && req.method === 'GET') return json(res, 200, { jobs: listJobs() });
  if ((m = p.match(/^\/api\/jobs\/stop\/([\w-]+)$/)) && req.method === 'POST') {
    const job = jobs.get(m[1]);
    if (!job) return json(res, 404, { error: 'job không tồn tại' });
    if (job.timer) clearInterval(job.timer);
    jobs.delete(m[1]);
    return json(res, 200, { ok: true });
  }

  // ---- enhance: viết lại prompt thô thành prompt tối ưu (oneshot) ----
  if (p === '/api/enhance' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const text = (body.text || '').trim();
    if (!text) return json(res, 400, { error: 'text required' });
    const meta = 'Bạn là chuyên gia prompt engineering. Viết lại yêu cầu sau thành MỘT prompt tối ưu '
      + '(bổ sung role, context, output format, constraints, ví dụ nếu hữu ích). '
      + 'CHỈ trả về nội dung prompt đã viết lại, không giải thích thêm.\n\nYêu cầu gốc:\n' + text;
    return json(res, 200, { ok: true, id: runOneshot(meta) });
  }

  // ---- /summary: tóm tắt session từ history (oneshot) ----
  if ((m = p.match(/^\/api\/summary\/([\w-]+)$/)) && req.method === 'POST') {
    const messages = getHistory(m[1]);
    if (!messages || !messages.length) return json(res, 400, { error: 'session không có history' });
    const convo = messages.map(x => x.role.toUpperCase() + ': ' + x.content.slice(0, 2000)).join('\n\n');
    const prompt = 'Tóm tắt ngắn gọn cuộc hội thoại sau bằng tiếng Việt, dạng gạch đầu dòng '
      + '(nội dung chính, quyết định, việc còn dang dở):\n\n' + convo;
    return json(res, 200, { ok: true, id: runOneshot(prompt) });
  }

  // ---- poll kết quả oneshot ----
  if ((m = p.match(/^\/api\/oneshot\/([\w-]+)$/))) {
    const rec = oneshots.get(m[1]);
    if (!rec) return json(res, 404, { error: 'not found' });
    return json(res, 200, { status: rec.status, output: rec.output });
  }

  // ---- Hermes: stream hội thoại của orchestrator (read-only) ----
  if (p === '/api/hermes' && req.method === 'GET') {
    // sending nằm NGOÀI cache: typing indicator phải realtime, không trễ theo cache 1.5s
    return json(res, 200, { ...(await getHermesData()), sending: hermesSending > 0 });
  }
  // Chat 2 chiều: gọi THẬT Hermes CLI (-z "<text>" -m <model>), đợi stdout -> reply
  if (p === '/api/hermes/send' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
    const text = (body.text || '').trim();
    if (!text) return json(res, 400, { ok: false, error: 'text required' });
    hermesSending++;
    execFile(HERMES_BIN, ['-z', text, '-m', HERMES_MODEL],
      { maxBuffer: 10 * 1024 * 1024, timeout: 180000, env: process.env },
      (err, stdout, stderr) => {
        hermesSending = Math.max(0, hermesSending - 1);
        hermesCache.at = 0; // reply có thể đã ghi vào state.db -> poll kế tiếp đọc data mới ngay
        if (err) {
          const msg = ((stderr || '').trim() || err.message || 'hermes error').slice(-2000);
          return json(res, 500, { ok: false, error: msg });
        }
        notifyPush('Hermes đã trả lời');
        json(res, 200, { ok: true, reply: (stdout || '').trim() || '(hermes không trả output)' });
      });
    return; // response trả trong callback execFile
  }

  // ---- AGY-PROXY: status / log / config / control (gọi CLI, không tự implement proxy) ----
  if (p === '/api/agy/status' && req.method === 'GET') {
    return json(res, 200, await getAgyStatus());
  }
  if (p === '/api/agy/log' && req.method === 'GET') {
    const since = Math.max(0, +(url.searchParams.get('since') || 0) || 0);
    const from = Math.max(0, since - agyLogStart);
    return json(res, 200, { next: agyLogStart + agyLogBuf.length, lines: agyLogBuf.slice(from) });
  }
  if (p === '/api/agy/config' && req.method === 'GET') {
    const env = readAgyEnv();
    const fields = Object.entries(AGY_EDIT_KEYS).map(([key, s]) => ({ key, value: env[key] != null ? env[key] : '', desc: s.desc }));
    return json(res, 200, { file: AGY_ENV, fields });
  }
  if (p === '/api/agy/config' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const key = String(body.key || '');
    const value = String(body.value == null ? '' : body.value).trim();
    const spec = AGY_EDIT_KEYS[key];
    if (!spec) return json(res, 400, { error: 'key không cho phép edit: ' + key });
    if (/[\r\n]/.test(value) || !spec.check(value)) return json(res, 400, { error: 'giá trị không hợp lệ cho ' + key });
    try { writeAgyEnv(key, value); } catch (e) { return json(res, 500, { error: e.message }); }
    return json(res, 200, { ok: true, restart: key === 'PORT' || key === 'HOST' });
  }
  // start/stop/restart/run: vẫn đọc body JSON (bắt buộc Content-Type JSON -> chống CSRF như các POST khác)
  if (/^\/api\/agy\/(start|stop|restart|run)$/.test(p) && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    let r;
    if (p === '/api/agy/start') r = agyStartDev();
    else if (p === '/api/agy/stop') r = agyStopDev();
    else if (p === '/api/agy/restart') {
      if (agyDev) {
        agyStopDev();
        setTimeout(() => agyStartDev(), 1500); // đợi process group cũ thoát rồi mới start lại
        r = { ok: true, restarting: true };
      } else r = agyStartDev();
    } else r = agyRun(String(body.cmd || ''));
    return json(res, r.error ? 409 : 200, r);
  }

  // ---- Web Push: vapid key + subscribe/unsubscribe + gửi test ----
  if (p === '/api/push/vapid') return json(res, 200, { key: pushState.publicKey });
  if (p === '/api/push/subscribe' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const sub = body && body.endpoint ? body : (body.subscription || {});
    if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return json(res, 400, { error: 'subscription không hợp lệ (cần endpoint + keys.p256dh + keys.auth)' });
    }
    removeSub(sub.endpoint); // upsert theo endpoint
    pushState.subs.push({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      ua: String(req.headers['user-agent'] || '').slice(0, 120),
      at: Date.now(),
    });
    savePushState();
    return json(res, 200, { ok: true, subs: pushState.subs.length });
  }
  if (p === '/api/push/unsubscribe' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    removeSub(String(body.endpoint || ''));
    return json(res, 200, { ok: true, subs: pushState.subs.length });
  }
  if (p === '/api/push/send' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const r = await pushAll({
      title: (body.title || 'Claude Control Center').slice(0, 100),
      body: (body.body || 'Test notification').slice(0, 500),
      tag: body.tag || 'ccc-test',
      url: '/',
    });
    return json(res, 200, { ok: true, ...r });
  }

  json(res, 404, { error: 'not found' });
});

/* ---------------- PWA assets ---------------- */

// Icon mới: Lucide "terminal" màu accent trên nền tối bo góc
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="116" fill="#0f1117"/>
<rect x="14" y="14" width="484" height="484" rx="104" fill="none" stroke="#262a36" stroke-width="8"/>
<g fill="none" stroke="#3b82f6" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">
<polyline points="128,340 226,248 128,156"/>
<line x1="262" y1="366" x2="390" y2="366"/>
</g>
</svg>`;

// Manifest để "Add to Home Screen" chạy standalone như app native
const MANIFEST = JSON.stringify({
  name: 'Claude Control',
  short_name: 'Control',
  display: 'standalone',
  // iOS standalone: env(safe-area-inset-bottom) chỉ đúng khi viewport-fit=cover ở cả manifest lẫn meta viewport
  viewport: { 'viewport-fit': 'cover' },
  background_color: '#0f1117',
  theme_color: '#0f1117',
  start_url: '/',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
});

// Service worker: network-only (đủ điều kiện PWA) + Web Push nhận notification thật
const SW_JS = `var SHELL = 'ccc-shell-v1';
var SHELL_URLS = ['/', '/manifest.json', '/icon.svg'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  // nạp sẵn vỏ app để mất mạng vẫn mở được (trước đây trắng màn hình)
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(SHELL_URLS); }).catch(function () {}));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== SHELL; })
        .map(function (k) { return caches.delete(k); }));
    }),
  ]));
});
// Chỉ cache VỎ app. TUYỆT ĐỐI không cache /api/* — dashboard mà hiện dữ liệu cũ
// tưởng là mới thì còn tệ hơn báo lỗi mất mạng.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/stream') return;
  if (SHELL_URLS.indexOf(url.pathname) < 0) return;
  // mạng trước (luôn có bản mới nhất), hỏng thì lấy cache
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || new Response('offline', { status: 503 });
      });
    })
  );
});

// Push từ server: chỉ hiện system notification khi KHÔNG có tab nào visible —
// tab đang mở thì toast/beep local đã lo, tránh notification trùng.
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var visible = list.some(function (c) { return c.visibilityState === 'visible'; });
    if (visible) return;
    return self.registration.showNotification(data.title || 'Claude Control Center', {
      body: data.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.tag || 'ccc-push',
      data: { url: data.url || '/', sid: data.sid || null },
    });
  }));
});

// Tap notification: focus tab đang có, không có thì mở tab mới
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || '/');
  }));
});
`;

/* ---------------- frontend ---------------- */
// LƯU Ý: template literal — client JS bên trong KHÔNG dùng backtick / ${ ;
// backslash phải escape đôi (\\n, \\s, \\u0000).


server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} đang bận (dashboard khác đang chạy?). Đổi port: PORT=7800 node claude-dashboard.js`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`claude-dashboard listening on http://localhost:${PORT}`);
  console.log(`  mã truy cập: ${dashToken}`);
  console.log(`  mở nhanh trên máy khác: http://<ip>:${PORT}/?t=${dashToken}`);
});
