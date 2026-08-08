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
const PERM_MODES = ['default', 'acceptEdits', 'bypassPermissions'];
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

function extractText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => {
      if (typeof b === 'string') return b;
      if (b.type === 'text') return b.text || '';
      if (b.type === 'tool_use') return `[tool: ${b.name}]`;
      if (b.type === 'tool_result') {
        const inner = extractText(b.content);
        return inner ? `[tool result] ${inner.slice(0, 400)}` : '[tool result]';
      }
      if (b.type === 'thinking') return '';
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

/* ---------------- tool_use / tool_result -> dữ liệu có cấu trúc ----------------
   Trước đây tool bị đè phẳng thành "[tool: Bash]" — mất sạch input, mất is_error,
   mất liên kết call<->result. Giờ giữ nguyên thành `parts` để client render tool card. */

// Cap độ dài — chặn payload phình trên poll 2s qua Tailscale (session dài x nhiều tool)
const TOOL_SUMMARY_CAP = 120;
const TOOL_INPUT_CAP = 1000;
const TOOL_RESULT_CAP = 1200;

function clampText(s, cap) {
  s = String(s == null ? '' : s);
  return s.length > cap ? s.slice(0, cap) + '\n… (+' + (s.length - cap) + ' chars)' : s;
}

function base(p) { return String(p || '').split('/').filter(Boolean).pop() || String(p || ''); }

// Tên hiển thị: mcp__server__tool -> "server · tool" (tên MCP thô quá dài cho 1 dòng mobile)
function toolDisplayName(name) {
  const n = String(name || 'tool');
  if (n.startsWith('mcp__')) {
    const seg = n.split('__').slice(1).map(s => s.replace(/_/g, ' '));
    return seg.length > 1 ? seg[0] + ' · ' + seg.slice(1).join(' · ') : seg[0] || n;
  }
  return n;
}

// Giá trị string đầu tiên trong input — fallback tóm tắt cho tool lạ / MCP
function firstStringVal(input) {
  for (const k of Object.keys(input)) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

// Tóm tắt 1 dòng hiện trên head của card (luôn ≤ TOOL_SUMMARY_CAP, không xuống dòng)
function summarizeToolInput(name, input) {
  if (input == null || typeof input !== 'object') return '';
  const n = String(name || '');
  let s = '';
  switch (n) {
    case 'Bash':
    case 'BashOutput':
      s = input.description || String(input.command || '').split('\n')[0];
      break;
    case 'Read': {
      s = base(input.file_path);
      if (input.offset != null) s += ':' + input.offset + (input.limit != null ? '-' + (+input.offset + +input.limit) : '');
      break;
    }
    case 'Edit':
      s = base(input.file_path);
      break;
    case 'MultiEdit':
      s = base(input.file_path) + (Array.isArray(input.edits) ? ' · ' + input.edits.length + ' edits' : '');
      break;
    case 'Write':
    case 'NotebookEdit':
      s = base(input.file_path || input.notebook_path) + (typeof input.content === 'string' ? ' · ' + input.content.length + ' chars' : '');
      break;
    case 'Grep':
      s = String(input.pattern || '') + (input.path ? ' in ' + base(input.path) : '');
      break;
    case 'Glob':
      s = String(input.pattern || '');
      break;
    case 'Task':
    case 'Agent':
      s = input.description || String(input.prompt || '').slice(0, 100);
      break;
    case 'TodoWrite': {
      const t = Array.isArray(input.todos) ? input.todos : [];
      s = t.length + ' todos · ' + t.filter(x => x && x.status === 'completed').length + ' done';
      break;
    }
    case 'WebFetch':
      s = String(input.url || '').replace(/^https?:\/\//, '');
      break;
    case 'WebSearch':
      s = String(input.query || '');
      break;
    case 'Skill':
      s = String(input.skill || input.command || '');
      break;
    default:
      s = firstStringVal(input) || JSON.stringify(input).slice(0, 100);
  }
  // URL rất hay là input của MCP/tool lạ — bỏ protocol cho vừa 1 dòng mobile
  return String(s || '').replace(/^https?:\/\//, '').replace(/\s+/g, ' ').trim().slice(0, TOOL_SUMMARY_CAP);
}

// Chi tiết input hiện khi mở card
function buildInputDetail(name, input) {
  if (input == null || typeof input !== 'object') return '';
  let s;
  switch (String(name || '')) {
    case 'Bash':
      s = input.command || '';
      break;
    case 'Edit':
      s = '--- old\n' + (input.old_string || '') + '\n+++ new\n' + (input.new_string || '');
      break;
    case 'Write':
      s = input.content || '';
      break;
    default:
      try { s = JSON.stringify(input, null, 2); } catch { s = String(input); }
  }
  return clampText(s, TOOL_INPUT_CAP);
}

// tool_result.content: string HOẶC mảng block {type:'text'|'image'} -> nối text, GIỮ ảnh.
// Ảnh base64 ~100KB/tấm: KHÔNG nhồi vào payload poll 2s -> chỉ trả metadata + media_type,
// client tải riêng qua /api/toolimg khi thật sự cần hiển thị.
function toolResultPreview(content) {
  let text = '', images = [];
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const buf = [];
    for (const b of content) {
      if (typeof b === 'string') buf.push(b);
      else if (!b) continue;
      else if (b.type === 'text') buf.push(b.text || '');
      else if (b.type === 'image') {
        const src = b.source || {};
        images.push({ i: images.length, mt: src.media_type || 'image/png', bytes: (src.data || '').length });
      }
    }
    text = buf.filter(Boolean).join('\n');
  }
  return { text: clampText(text, TOOL_RESULT_CAP), images };
}

// Lấy base64 ảnh thứ idx của 1 tool_result — đọc lại file, KHÔNG cache trong parse
// (giữ payload history nhẹ; ảnh chỉ tải khi user mở card ra xem)
function findToolImage(file, toolId, idx) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.indexOf(toolId) < 0) continue; // lọc nhanh trước khi parse
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const c = (obj.message || obj).content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || b.type !== 'tool_result' || b.tool_use_id !== toolId) continue;
      if (!Array.isArray(b.content)) continue;
      let n = 0;
      for (const x of b.content) {
        if (!x || x.type !== 'image') continue;
        if (n === idx) {
          const src = x.source || {};
          if (!src.data) return null;
          return { mt: src.media_type || 'image/png', buf: Buffer.from(src.data, 'base64') };
        }
        n++;
      }
    }
  }
  return null;
}

// Chuỗi phẳng dựng lại từ parts — giữ y hệt format cũ để stats/unread/export cũ không đổi
function flattenParts(parts) {
  return parts.map(p => (p.t === 'text' ? p.text : '[tool: ' + p.name + ']')).filter(Boolean).join('\n');
}

const TOOL_ST_LABEL = { ok: 'OK', error: 'ERROR', running: 'RUNNING', pending: 'PENDING' };

// Markdown 1 message cho export .md — tool thành blockquote header + fence input/result.
// Dùng chung shape với exportChat phía client để 2 kiểu export ra giống nhau.
function mdForMessage(msg) {
  if (!msg.parts || !msg.parts.length) return msg.content || '';
  return msg.parts.map(p => {
    if (p.t === 'text') return p.text;
    let s = '> 🔧 **' + p.disp + '**' + (p.summary ? ' — `' + p.summary + '`' : '')
      + ' — ' + (TOOL_ST_LABEL[p.status] || p.status);
    if (p.input) s += '\n\n```input\n' + p.input + '\n```';
    if (p.result) s += '\n\n```result\n' + p.result + '\n```';
    if (p.images && p.images.length) s += '\n\n_[' + p.images.length + ' ảnh]_';
    return s;
  }).filter(Boolean).join('\n\n');
}

function parseSessionFile(file) {
  let st;
  try { st = fs.statSync(file); } catch { cache.delete(file); return null; }
  const c = cache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.data;

  const msgs = [];
  // tool_use_id -> part object; ghép result vào call. Ghép trên TOÀN file trước khi
  // slice window 30 -> call ở đầu window vẫn nhận được result nằm sau.
  const toolIndex = new Map();
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
        }
        // thinking + block lạ: bỏ (giữ hành vi cũ)
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
  const data = { msgs, mtimeMs: st.mtimeMs, title, tsMs: msgs.map(m => Date.parse(m.ts) || 0) };
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

function readBody(req) {
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
      if (buf.length > 1e6) { overflow = true; reject(new Error('body too large')); req.destroy(); }
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

const PUSH_STATE_FILE = process.env.PUSH_STATE_FILE || path.join(__dirname, '.push-state.json');
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

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  if (!hostAllowed(req)) return json(res, 403, { error: 'forbidden host' });
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(HTML);
  }

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
    spawnClaude(['-p', msg, '--resume', sid].concat(permArgs()), sid, { task: msg });
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
    });
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
const SW_JS = `self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* network-only */ });

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

const HTML = `<!doctype html>
<html data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#0f1117">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Claude">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<title>Claude Control Center</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.10/dist/full.min.css" rel="stylesheet" type="text/css">
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/lucide@latest"></script>
<!-- markdown renderer + sanitizer (chống XSS) -->
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script>
<!-- Chart.js cho tab Stats (donut + bar) -->
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
  :root { color-scheme: dark; }
  * { -webkit-tap-highlight-color: transparent; }
  body { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-thumb { background: #2d3140; border-radius: 999px; }
  ::-webkit-scrollbar-thumb:hover { background: #3a3f50; }
  ::-webkit-scrollbar-track { background: transparent; }

  /* fade-in MỘT LẦN cho phần tử mới xuất hiện — không có animation lặp */
  .fadein { animation: fadein .2s ease-out; }
  @keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  /* các keyframes khác — tất cả chạy 1 LẦN (trừ typing/shimmer chỉ hiện khi đang chờ) */
  @keyframes pill-pop { 0% { box-shadow: 0 0 0 0 rgba(16,185,129,.4); } 70% { box-shadow: 0 0 0 7px rgba(16,185,129,0); } 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0); } }
  @keyframes badgepop { 0% { transform: scale(.4); } 60% { transform: scale(1.18); } 100% { transform: scale(1); } }
  @keyframes pillin { from { transform: scaleX(.5); opacity: 0; } to { transform: scaleX(1); opacity: 1; } }
  @keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  @keyframes tbounce { 0%, 60%, 100% { transform: none; opacity: .35; } 30% { transform: translateY(-3px); opacity: 1; } }

  /* header: title gradient + logo glow + pill RUNNING (pulse 1 lần khi xuất hiện) */
  .apptitle {
    background: linear-gradient(90deg, #60a5fa, #a78bfa);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .logoglow svg { filter: drop-shadow(0 0 6px rgba(59, 130, 246, .55)); }
  .runpill {
    display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
    font-size: 11px; font-weight: 600; letter-spacing: .3px; padding: 3px 10px; border-radius: 999px;
    background: rgba(16, 185, 129, .12); color: #34d399; border: 1px solid rgba(16, 185, 129, .25);
    animation: pill-pop 1.1s ease 1; /* nhấp nháy 1 lần lúc hiện, sau đó static */
  }
  .runpill .chip-dot { background: #10b981; }

  /* skeleton shimmer: CHỈ hiện lúc chờ data đầu tiên, bị remove ngay khi SSE về */
  .skel {
    border-radius: 8px;
    background: linear-gradient(90deg, #1a1d27 25%, #242938 37%, #1a1d27 63%);
    background-size: 200% 100%; animation: shimmer 1.2s linear infinite;
  }

  /* tab sidebar */
  .tabbtn {
    position: relative; z-index: 0; display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 10px 6px; border-radius: 10px; color: #666b7d; min-height: 48px; flex: 1;
    transition: color .15s, background .15s; cursor: pointer; border: none; background: none;
    font: inherit; font-size: 10px; font-weight: 600; letter-spacing: .3px;
  }
  @media (min-width: 768px) { .tabbtn { flex: none; margin: 0 10px; } }
  .tabbtn:hover { color: #a5a9b8; background: #1a1d27; }
  /* pill nền active nằm ở ::before -> slide/scale-in 200ms MỘT LẦN khi chuyển tab */
  .tabbtn.active::before {
    content: ''; position: absolute; inset: 3px; z-index: -1; border-radius: 10px;
    background: rgba(59, 130, 246, .12);
    box-shadow: 0 0 14px rgba(59, 130, 246, .12);
    animation: pillin .2s ease;
  }
  .tabbtn.active { color: #3b82f6; }
  .tabbtn.active svg { filter: drop-shadow(0 0 5px rgba(59, 130, 246, .45)); }
  .tabbtn.hm.active { color: #8b5cf6; }
  .tabbtn.hm.active::before { background: rgba(139, 92, 246, .12); box-shadow: 0 0 14px rgba(139, 92, 246, .12); }
  .tabbtn.hm.active svg { filter: drop-shadow(0 0 5px rgba(139, 92, 246, .45)); }
  .tabbadge {
    position: absolute; top: 2px; right: 6px; background: #ef4444; color: #fff;
    border-radius: 999px; font-size: 10px; line-height: 15px; padding: 0 5px; font-weight: 600;
    animation: badgepop .3s ease; /* pop 1 lần mỗi khi badge xuất hiện (display none -> block restart) */
  }

  /* session / conversation row */
  .srow {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin: 2px 10px;
    border-radius: 12px; cursor: pointer; border: 1px solid transparent;
    transition: background .15s, border-color .15s, box-shadow .15s;
  }
  .srow:hover { background: #161921; box-shadow: inset 3px 0 0 #3b82f6; } /* glow bar trái, inset -> không shift layout */
  .srow.selected { border-color: rgba(59, 130, 246, .45); background: #161921; }

  /* status chip */
  .chip { font-size: 10px; font-weight: 600; letter-spacing: .4px; padding: 2px 9px; border-radius: 999px; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
  .chip-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .st-RUNNING { background: rgba(16, 185, 129, .14); color: #34d399; }
  /* dot RUNNING: pulse 2 nhịp khi mới render rồi ĐỨNG YÊN — tuân thủ rule không animation lặp */
  .st-RUNNING .chip-dot { background: #10b981; box-shadow: 0 0 0 2px rgba(16,185,129,.25); animation: dot-pulse 2s ease-in-out 2; }
  @keyframes dot-pulse { 0%,100% { box-shadow: 0 0 0 2px rgba(16,185,129,.25); } 50% { box-shadow: 0 0 0 4px rgba(16,185,129,.1); } }
  .st-ACTIVE { background: rgba(59, 130, 246, .16); color: #60a5fa; }
  .st-ACTIVE .chip-dot { background: #3b82f6; }
  .st-IDLE { background: #1e222d; color: #4b5163; }
  .st-IDLE .chip-dot { background: #3a3f50; }
  /* status dot dùng trong session row (không phải chip, chỉ dot) */
  .sdot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .sdot-RUNNING { background: #10b981; animation: dot-pulse 2s ease-in-out 2; }
  .sdot-ACTIVE { background: #3b82f6; }
  .sdot-IDLE { background: #2d3140; }

  /* unread badge nhỏ trên card — pop 1 lần khi xuất hiện */
  .ubadge { background: #ef4444; color: #fff; border-radius: 999px; font-size: 10px; line-height: 16px; padding: 0 6px; font-weight: 600; animation: badgepop .3s ease; }

  /* project name trong row: đậm hơn + fade gradient thay vì cắt cứng */
  .s-proj {
    font-weight: 600;
    -webkit-mask-image: linear-gradient(90deg, #000 82%, transparent);
    mask-image: linear-gradient(90deg, #000 82%, transparent);
  }

  /* compare: nút toggle + row đã chọn + split view (bubble nhỏ hơn cho 2 cột hẹp) */
  #comparebtn.cmp-on { border-color: rgba(59, 130, 246, .7); color: #3b82f6; background: rgba(59, 130, 246, .12); }
  .srow.cmp-sel { border-color: rgba(59, 130, 246, .55); background: #1a1d27; }
  #compare .bub { max-width: 94%; font-size: 12.5px; }
  #compare .codeblock { font-size: 11px; }

  /* chat bubbles — Telegram/iMessage clean */
  .bub {
    max-width: 76%; padding: 9px 13px; border-radius: 16px; line-height: 1.55;
    font-size: 14px; white-space: pre-wrap; word-break: break-word;
  }
  .bub-user {
    align-self: flex-end; background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: #fff; border-bottom-right-radius: 6px;
  }
  .bub-assistant {
    align-self: flex-start; background: #1a1d27; border: 1px solid #262a36;
    border-left: 2px solid rgba(59, 130, 246, .45);
    color: #e4e4e7; border-bottom-left-radius: 6px;
  }
  .bub-tool {
    align-self: flex-start; background: rgba(139, 92, 246, .08); border: 1px solid rgba(139, 92, 246, .25);
    color: #b7a5ef; font-size: 12px; max-width: 82%;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  /* ---- TOOL CARD: 1 message assistant = text bubble + N card tool xếp dọc ---- */
  .msgwrap { display: flex; flex-direction: column; gap: 6px; align-self: flex-start; max-width: 76%; width: 100%; }
  .msgwrap .bub { max-width: 100%; }
  .tcard {
    border: 1px solid #262a36; background: #141722; border-radius: 12px; overflow: hidden;
    transition: border-color .2s ease;
  }
  /* lỗi phải NHÌN LÀ THẤY: viền đỏ rõ + nền ám đỏ + vạch trái, không chỉ mỗi dấu ✗ nhỏ */
  .tcard.t-err {
    border-color: rgba(248, 113, 113, .55); background: rgba(248, 113, 113, .06);
    box-shadow: inset 3px 0 0 #f87171;
  }
  .tcard.t-run { border-color: rgba(251, 191, 36, .45); box-shadow: inset 3px 0 0 #fbbf24; }
  /* head là <button>: tap được trên mobile, focus được bằng bàn phím, cao ≥44px (Apple HIG) */
  .tcard-head {
    display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px;
    padding: 8px 12px; background: none; border: 0; color: #e4e4e7; font-size: 13px;
    font-family: inherit; text-align: left; cursor: pointer; transition: background .2s ease;
  }
  .tcard-head:focus-visible { outline: 2px solid rgba(59, 130, 246, .6); outline-offset: -2px; }
  /* hover chỉ là bonus desktop — mobile không có hover, mọi thứ vẫn tap được */
  @media (min-width: 768px) { .tcard-head:hover { background: #1a1e2b; } }
  .tcard-ic { flex-shrink: 0; display: flex; color: #8b5cf6; }
  /* tên MCP có thể rất dài (claude ai Figma · get design context) -> cho phép co + ellipsis,
     nhưng ưu tiên giữ tên hơn summary (flex-shrink nhỏ hơn) và không bao giờ nuốt chevron */
  .tcard-name {
    flex: 0 1 auto; min-width: 0; max-width: 52%; font-weight: 600;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tcard-sum {
    flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: #8b8fa3; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .tcard-st { flex-shrink: 0; display: flex; align-items: center; color: #4b5163; }
  .tcard-st-ok { color: #34d399; }
  .tcard-st-err { color: #f87171; }
  /* pulse 2 nhịp rồi ĐỨNG YÊN (giống .st-RUNNING) — RULES: không animation lặp vô hạn */
  .tcard-st-run { color: #fbbf24; animation: dot-pulse 2s ease-in-out 2; border-radius: 50%; }
  .tcard-st-pend { color: #4b5163; }
  .tcard-chev { flex-shrink: 0; display: flex; color: #666b7d; transition: transform .2s ease; }
  .tcard.open .tcard-chev { transform: rotate(180deg); }
  /* body mở/đóng bằng grid-template-rows 0fr->1fr: transition 1 lần 200ms, không phải keyframe lặp */
  .tcard-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .2s ease; }
  .tcard.open .tcard-body { grid-template-rows: 1fr; }
  .tcard-body > .tinner { overflow: hidden; min-height: 0; }
  .tsec { padding: 0 12px 10px; }
  .tsec .codewrap { margin: 0; }
  /* kết quả 40+ dòng từng đẩy card cao 600px+ -> cuộn trong khối, card giữ chiều cao xem được */
  .tsec .codeblock { max-height: 260px; overflow-y: auto; }
  @media (max-width: 767px) { .tsec .codeblock { max-height: 200px; } }
  .tlbl { font-size: 10px; font-weight: 600; letter-spacing: .5px; color: #666b7d; margin: 0 0 4px 2px; }
  .tsec-err .tlbl { color: #f87171; }
  .tsec-err .codeblock { border-color: rgba(248, 113, 113, .3); }
  .timg { font-size: 11px; color: #8b5cf6; margin-top: 6px; }
  /* mobile: bubble/card rộng 85% theo RULES */
  @media (max-width: 767px) { .msgwrap { max-width: 85%; } }
  /* compare view 2 cột hẹp: thu nhỏ card */
  #compare .msgwrap { max-width: 94%; }
  #compare .tcard-head { font-size: 12px; min-height: 40px; }
  #compare .tcard-sum { font-size: 11px; }
  /* hàng [chế độ][công tắc quyền] trên màn hẹp: cho nhóm chế độ co + cuộn ngang,
     công tắc quyền luôn nguyên vẹn (phải đọc được Claude đang có quyền gì) */
  .segscroll { min-width: 0; overflow-x: auto; scrollbar-width: none; }
  .segscroll::-webkit-scrollbar { display: none; }

  /* banner lỗi trong chat: phải THẤY được, không im lặng như trước */
  .chaterrbox {
    display: flex; align-items: flex-start; gap: 8px;
    font-size: 12.5px; line-height: 1.5; border-radius: 10px; padding: 9px 11px;
    background: rgba(248, 113, 113, .08); border: 1px solid rgba(248, 113, 113, .3); color: #f87171;
  }

  /* ---- công tắc quyền: Claude có được tự sửa file không ---- */
  .permbtn {
    display: flex; align-items: center; gap: 7px; height: 44px; padding: 0 12px;
    border-radius: 12px; border: 1px solid #262a36; background: #1a1d27; color: #8b8fa3;
    font: inherit; font-size: 12.5px; font-weight: 500; cursor: pointer; flex-shrink: 0;
    transition: color .2s ease, border-color .2s ease;
  }
  .permdot { width: 8px; height: 8px; border-radius: 50%; background: #4b5163; flex-shrink: 0; }
  .permbtn.p-accept { color: #34d399; border-color: rgba(52, 211, 153, .35); }
  .permbtn.p-accept .permdot { background: #10b981; }
  .permbtn.p-bypass { color: #f87171; border-color: rgba(248, 113, 113, .4); }
  .permbtn.p-bypass .permdot { background: #ef4444; }
  @media (min-width: 768px) { .permbtn:hover { border-color: rgba(59, 130, 246, .5); } }
  /* màn rất hẹp mới ẩn chữ; 390px (iPhone) vẫn phải đọc được để biết Claude đang có quyền gì */
  @media (max-width: 360px) { .permbtn span:last-child { display: none; } .permbtn { padding: 0 13px; } }

  /* tiêu đề phiên trong header chat: bấm để đổi tên */
  .chattitle {
    background: none; border: 0; cursor: pointer; padding: 2px 6px; margin-left: -6px;
    border-radius: 8px; max-width: 60%; transition: background .2s ease, color .2s ease;
  }
  .chattitle:hover { background: #1a1d27; color: #e4e4e7; }
  .chattitle:focus-visible { outline: 2px solid rgba(59, 130, 246, .6); }

  /* ---- thời gian + trạng thái dưới bubble (kiểu Telegram/iMessage) ---- */
  /* message user: cả wrapper dạt phải, bubble co theo nội dung (không kéo full 76%) */
  .msgwrap.mw-user { align-self: flex-end; align-items: flex-end; width: auto; }
  .msgwrap.mw-user .bub { width: auto; }
  .bmeta {
    display: flex; align-items: center; gap: 6px; padding: 0 4px;
    font-size: 10.5px; color: #5c6175; line-height: 1;
  }
  .bmeta-r { align-self: flex-end; }
  .bmeta-tools { color: #6f7488; }
  .bmeta-tools::before { content: '·'; margin-right: 6px; }
  .bmeta-err { color: #f87171; }
  .bmeta-run { color: #fbbf24; }
  /* vạch ngăn ngày */
  .daydiv { display: flex; align-items: center; gap: 10px; margin: 10px 2px 4px; }
  .daydiv::before, .daydiv::after { content: ''; flex: 1; height: 1px; background: #262a36; }
  .daydiv span {
    font-size: 10.5px; color: #6f7488; letter-spacing: .3px; white-space: nowrap;
    background: #141722; border: 1px solid #262a36; border-radius: 999px; padding: 3px 10px;
  }

  /* ---- nhãn ngôn ngữ cạnh INPUT/KẾT QUẢ ---- */
  .tlang {
    margin-left: 6px; padding: 1px 6px; border-radius: 4px; font-weight: 500; letter-spacing: 0;
    background: rgba(59, 130, 246, .12); color: #60a5fa; font-size: 9.5px; text-transform: none;
  }

  /* ---- diff Edit: xanh thêm / đỏ bớt, thay vì khối chữ xám phẳng ---- */
  .diffblock { padding: 0; white-space: normal; }
  .dline { padding: 1px 12px; white-space: pre; }
  .dhead {
    padding: 3px 12px; font-size: 10px; font-weight: 600; letter-spacing: .5px;
    position: sticky; top: 0; backdrop-filter: blur(2px);
  }
  .dhead.d-del { color: #f87171; background: rgba(248, 113, 113, .1); }
  .dhead.d-add { color: #34d399; background: rgba(52, 211, 153, .1); }
  .dline.d-del { background: rgba(248, 113, 113, .07); box-shadow: inset 2px 0 0 rgba(248,113,113,.5); }
  .dline.d-add { background: rgba(52, 211, 153, .07); box-shadow: inset 2px 0 0 rgba(52,211,153,.5); }

  /* ---- văn bản thường: cho xuống dòng mềm thay vì cuộn ngang như code ---- */
  .proseblock { white-space: normal; font-family: inherit; font-size: 13px; line-height: 1.55; color: #c2c7d4; }
  .proseblock .md p { margin: 3px 0; }

  /* ---- ẢNH trong tool_result: hiện ảnh thật, tap để phóng to ---- */
  .timgs { display: flex; flex-wrap: wrap; gap: 8px; }
  .timgbtn {
    padding: 0; border: 1px solid #262a36; border-radius: 10px; overflow: hidden;
    background: #0b0d13; cursor: pointer; line-height: 0; max-width: 100%;
    transition: border-color .2s ease;
  }
  .timgbtn:focus-visible { outline: 2px solid rgba(59, 130, 246, .6); outline-offset: 2px; }
  @media (min-width: 768px) { .timgbtn:hover { border-color: rgba(59, 130, 246, .6); } }
  .timgbtn img { display: block; max-width: 100%; max-height: 260px; width: auto; height: auto; object-fit: contain; }
  .timgbtn.timg-fail { padding: 10px 12px; font-size: 12px; color: #f87171; line-height: 1.4; }
  /* xem ảnh full màn hình */
  .imgov {
    position: fixed; inset: 0; z-index: 90; background: rgba(0, 0, 0, .88);
    display: flex; align-items: center; justify-content: center; padding: 16px;
    padding-top: calc(16px + env(safe-area-inset-top)); padding-bottom: calc(16px + env(safe-area-inset-bottom));
    cursor: zoom-out;
  }
  .imgov img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 10px; }

  /* tôn trọng cài đặt giảm chuyển động của hệ điều hành (iOS: Settings > Accessibility > Motion) */
  @media (prefers-reduced-motion: reduce) {
    .tcard, .tcard-head, .tcard-chev, .tcard-body { transition: none; }
    .tcard-st-run { animation: none; }
    .tcard.fadein, .msgwrap.fadein { animation: none; }
  }

  /* code block trong bubble */
  .codewrap { position: relative; margin: 8px 0; }
  .codelang { font-size: 11px; color: #666b7d; margin: 0 0 3px 4px; }
  .codeblock {
    background: #0b0d13; border: 1px solid rgba(59, 130, 246, .22); border-radius: 10px;
    padding: 10px 12px; overflow-x: auto; white-space: pre;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: #c9d1d9;
    box-shadow: inset 0 0 18px rgba(59, 130, 246, .05); /* neon subtle */
  }
  .codelang { color: #60a5fa; }
  .bub-user .codeblock { background: rgba(0, 0, 0, .28); border-color: rgba(255, 255, 255, .22); color: #fff; }
  .copybtn {
    position: absolute; top: 4px; right: 4px; display: flex; align-items: center; gap: 4px;
    background: #12141c; border: 1px solid #262a36; color: #8b8fa3; border-radius: 7px;
    font-size: 11px; padding: 3px 8px; cursor: pointer; transition: color .15s;
  }
  .copybtn:hover { color: #e4e4e7; }

  /* ---- markdown đã render trong bubble ---- */
  .md { white-space: normal; } /* bubble là pre-wrap, markdown HTML cần normal để không double-space */
  .md > :first-child { margin-top: 0; }
  .md > :last-child { margin-bottom: 0; }
  .md p { margin: 4px 0; }
  .md h1, .md h2, .md h3, .md h4 { font-weight: 600; margin: 10px 0 4px; line-height: 1.3; }
  .md h1 { font-size: 1.25em; }
  .md h2 { font-size: 1.15em; }
  .md h3 { font-size: 1.05em; }
  .md h4 { font-size: 1em; }
  .md ul, .md ol { margin: 4px 0; padding-left: 20px; }
  .md ul { list-style: disc; }
  .md ol { list-style: decimal; }
  .md li { margin: 2px 0; }
  .md code {
    background: rgba(110, 118, 129, .25); border-radius: 5px; padding: 1px 5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em;
  }
  .md pre { background: #0b0d13; border: 1px solid rgba(59, 130, 246, .22); border-radius: 10px; padding: 10px 12px; overflow-x: auto; margin: 6px 0; box-shadow: inset 0 0 18px rgba(59, 130, 246, .05); }
  .md pre code { background: none; padding: 0; font-size: 12.5px; }
  .md blockquote { border-left: 3px solid #3b82f6; padding-left: 10px; margin: 6px 0; color: #a5a9b8; }
  .md a { color: #60a5fa; text-decoration: underline; }
  .md hr { border: none; border-top: 1px solid #262a36; margin: 8px 0; }
  .md strong { font-weight: 600; }
  .md table { border-collapse: collapse; margin: 6px 0; }
  .md th, .md td { border: 1px solid #262a36; padding: 4px 8px; font-size: .95em; }
  /* bubble user nền accent -> chỉnh màu markdown cho tương phản */
  .bub-user .md code { background: rgba(255, 255, 255, .22); }
  .bub-user .md a { color: #dbeafe; }
  .bub-user .md blockquote { border-color: rgba(255, 255, 255, .5); color: #dbeafe; }

  /* typing dots — bounce nhẹ, CHỈ hiện khi đang chờ trả lời (rule cho phép) */
  .tdots {
    display: inline-flex; gap: 5px; align-items: center; padding: 10px 14px;
    background: #1a1d27; border: 1px solid #262a36; border-radius: 16px; border-bottom-left-radius: 6px;
    align-self: flex-start;
  }
  .tdots span { width: 7px; height: 7px; border-radius: 50%; background: #8b8fa3; animation: tbounce 1.2s ease-in-out infinite; }
  .tdots span:nth-child(2) { animation-delay: .15s; }
  .tdots span:nth-child(3) { animation-delay: .3s; }

  /* command palette */
  .palitem { display: flex; align-items: baseline; gap: 10px; padding: 8px 12px; border-radius: 8px; cursor: pointer; }
  .palitem.active, .palitem:hover { background: #1e222d; }
  .palcmd { font-family: ui-monospace, Menlo, monospace; font-size: 13px; color: #e4e4e7; }
  .paldesc { font-size: 12px; color: #666b7d; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .paltag { font-size: 10px; padding: 1px 8px; border-radius: 999px; font-weight: 600; }
  .paltag-claude { background: rgba(59, 130, 246, .15); color: #60a5fa; }
  .paltag-hermes { background: rgba(139, 92, 246, .15); color: #a78bfa; }

  /* jobs bar */
  .jobrow {
    display: flex; align-items: center; gap: 10px; margin: 4px 10px; padding: 8px 12px;
    border-radius: 10px; background: rgba(245, 158, 11, .07); border: 1px solid rgba(245, 158, 11, .2);
    color: #d9a441; font-size: 12.5px;
  }

  /* overlay + toast */
  #overlay {
    display: none; position: fixed; inset: 0; z-index: 60;
    background: rgba(0, 0, 0, .6); align-items: center; justify-content: center;
    backdrop-filter: blur(3px);
  }
  #toast {
    position: fixed; left: 50%; bottom: calc(92px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 70;
    background: #1a1d27; border: 1px solid #262a36; color: #e4e4e7;
    padding: 9px 16px; border-radius: 12px; font-size: 13px; max-width: 88%;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .4);
    opacity: 0; pointer-events: none; transition: opacity .2s;
  }
  #toast.show { opacity: 1; }

  /* segmented mode control */
  .seg { display: flex; background: #1a1d27; border: 1px solid #262a36; border-radius: 10px; padding: 2px; gap: 2px; }
  .segbtn {
    border: none; background: none; color: #8b8fa3; font: inherit; font-size: 11.5px; font-weight: 500;
    padding: 4px 10px; border-radius: 8px; cursor: pointer; transition: background .15s, color .15s;
  }
  .segbtn.active { background: #3b82f6; color: #fff; }

  /* input wrapper: glow nhẹ khi focus (blue mặc định, tím cho Hermes) */
  .inputwrap { transition: border-color .15s, box-shadow .15s; }
  .inputwrap:focus-within {
    border-color: rgba(59, 130, 246, .6) !important;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, .12), 0 0 16px rgba(59, 130, 246, .14);
  }
  .inputwrap-hm:focus-within {
    border-color: rgba(139, 92, 246, .6) !important;
    box-shadow: 0 0 0 3px rgba(139, 92, 246, .12), 0 0 16px rgba(139, 92, 246, .14);
  }

  /* send button: gradient blue -> purple, scale nhẹ khi hover/press */
  .sendgrad {
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    transition: transform .15s ease, filter .15s ease, box-shadow .15s ease;
  }
  .sendgrad:hover { transform: scale(1.05); filter: brightness(1.08); box-shadow: 0 4px 14px rgba(99, 102, 241, .35); }
  .sendgrad:active { transform: scale(.96); }
  .sendgrad.hm { background: linear-gradient(135deg, #8b5cf6, #6366f1); }

  /* ---- command palette DRAWER: slide-up từ dưới, translateY 200ms MỘT LẦN ---- */
  #drawerwrap { position: fixed; inset: 0; z-index: 80; pointer-events: none; }
  #drawerwrap.open { pointer-events: auto; }
  #drawerback { position: absolute; inset: 0; background: rgba(0,0,0,.55); backdrop-filter: blur(2px);
                opacity: 0; transition: opacity .2s ease; }
  #drawerwrap.open #drawerback { opacity: 1; }
  #drawer {
    position: absolute; left: 0; right: 0; bottom: 0; max-height: 78vh; max-height: 78dvh;
    background: #12141c; border-top: 1px solid #262a36; border-radius: 18px 18px 0 0;
    display: flex; flex-direction: column; box-shadow: 0 -12px 40px rgba(0,0,0,.5);
    transform: translateY(105%); transition: transform .2s ease; /* chỉ chạy 1 lần khi mở/đóng */
    padding-bottom: env(safe-area-inset-bottom);
  }
  #drawerwrap.open #drawer { transform: translateY(0); }
  @media (min-width: 768px) { #drawer { left: 50%; right: auto; width: 680px; transform: translate(-50%, 105%); }
    #drawerwrap.open #drawer { transform: translate(-50%, 0); } }
  .drawerhandle { width: 40px; height: 4px; border-radius: 2px; background: #262a36; margin: 8px auto 0; }
  .palgrouptitle { font-size: 11px; font-weight: 700; letter-spacing: .8px; color: #666b7d;
                   padding: 10px 4px 6px; display: flex; align-items: center; gap: 6px; }
  .palgrid { display: grid; grid-template-columns: 1fr; gap: 6px; }
  @media (min-width: 560px) { .palgrid { grid-template-columns: 1fr 1fr; } }
  /* CARD lệnh: icon + tên + mô tả, hover glow */
  .palcard {
    display: flex; align-items: center; gap: 11px; padding: 10px 12px; min-height: 52px;
    background: #171a23; border: 1px solid #262a36; border-radius: 12px; cursor: pointer;
    transition: border-color .15s, box-shadow .15s, background .15s;
  }
  .palcard:hover, .palcard.active {
    background: #1a1d27; border-color: rgba(59, 130, 246, .55);
    box-shadow: 0 0 0 1px rgba(59, 130, 246, .25), 0 0 18px rgba(59, 130, 246, .18); /* glow */
  }
  .palcard.hm:hover, .palcard.hm.active {
    border-color: rgba(139, 92, 246, .55);
    box-shadow: 0 0 0 1px rgba(139, 92, 246, .25), 0 0 18px rgba(139, 92, 246, .18);
  }
  .palcard .pic { width: 32px; height: 32px; border-radius: 9px; display: flex; align-items: center;
                  justify-content: center; flex-shrink: 0; background: rgba(59,130,246,.13); color: #60a5fa; }
  .palcard.hm .pic { background: rgba(139,92,246,.13); color: #a78bfa; }
  .palcard .pname { font-family: ui-monospace, Menlo, monospace; font-size: 13px; font-weight: 600; color: #e4e4e7; }
  .palcard .pdesc { font-size: 11.5px; color: #666b7d; line-height: 1.35; overflow: hidden;
                    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

  /* ---- tab Stats ---- */
  .statcard { background: #171a23; border: 1px solid #262a36; border-radius: 14px; padding: 14px 16px; }
  .statnum { font-size: 24px; font-weight: 700; letter-spacing: -.5px; }
  .statlbl { font-size: 11px; font-weight: 600; letter-spacing: .6px; color: #666b7d; margin-top: 2px; }
  .chartbox { background: #171a23; border: 1px solid #262a36; border-radius: 14px; padding: 14px 16px; min-width: 0; }

  /* ---- tab AGY-PROXY ---- */
  .agybtn {
    display: flex; align-items: center; gap: 7px; min-height: 44px; padding: 0 16px;
    background: #1a1d27; border: 1px solid #262a36; border-radius: 12px;
    color: #e4e4e7; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .agybtn:hover:not(:disabled) { border-color: rgba(59, 130, 246, .55); background: #1e222d; }
  .agybtn:disabled { opacity: .35; cursor: not-allowed; }
  .agybtn-red { color: #ef4444; }
  .agybtn-red:hover:not(:disabled) { border-color: rgba(239, 68, 68, .55); }
  .agychip { font-size: 11px; font-weight: 600; letter-spacing: .4px; padding: 5px 11px; border-radius: 999px; background: #1e222d; color: #666b7d; }
  .agychip.ok { background: rgba(16, 185, 129, .14); color: #34d399; }
  .agychip.fail { background: rgba(239, 68, 68, .14); color: #f87171; }
  .agychip.run { background: rgba(245, 158, 11, .14); color: #f59e0b; }
  /* ---- THẺ TRẠNG THÁI: thay 4 ô số rời rạc bằng 1 chỗ nói rõ proxy đang thế nào ---- */
  .agyhero {
    border: 1px solid #262a36; border-radius: 14px; padding: 14px;
    background: linear-gradient(135deg, #161921, #12141c);
    transition: border-color .2s ease;
  }
  .agyhero.on { border-color: rgba(16, 185, 129, .35); }
  .agyhero.off { border-color: rgba(248, 113, 113, .35); }
  .agyhero-dot { width: 10px; height: 10px; border-radius: 50%; background: #4b5163; flex-shrink: 0; }
  .agyhero.on .agyhero-dot { background: #10b981; animation: dot-pulse 2s ease-in-out 2; }
  .agyhero.off .agyhero-dot { background: #f87171; }
  .agyhero-state { font-size: 17px; font-weight: 700; color: #e4e4e7; letter-spacing: -.2px; }
  .agyhero-meta { font-size: 12.5px; color: #8b8fa3; }
  .agyhero-tag {
    font-size: 10.5px; font-weight: 600; letter-spacing: .3px; padding: 3px 8px; border-radius: 999px;
    background: rgba(245, 158, 11, .12); color: #d9a441; border: 1px solid rgba(245, 158, 11, .3);
  }
  .agyhero-note {
    margin-top: 10px; font-size: 12px; color: #d9a441; line-height: 1.5;
    background: rgba(245, 158, 11, .08); border: 1px solid rgba(245, 158, 11, .22);
    border-radius: 10px; padding: 8px 10px;
  }

  /* ---- lưu lượng 24h: 3 số chính + biểu đồ giờ + model + mã lỗi ---- */
  .ustats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .ustat-n { font-size: 21px; font-weight: 700; color: #e4e4e7; letter-spacing: -.4px; line-height: 1.15; }
  .ustat-n.warn { color: #f87171; }
  .ustat-l { font-size: 10.5px; color: #666b7d; letter-spacing: .3px; margin-top: 1px; }
  .uabox {
    margin-top: 10px; font-size: 12px; line-height: 1.5; border-radius: 10px; padding: 8px 10px;
    background: rgba(248, 113, 113, .08); border: 1px solid rgba(248, 113, 113, .25); color: #f87171;
  }
  /* biểu đồ cột theo giờ: phần lỗi chồng lên phần thành công */
  .uhours { display: flex; align-items: flex-end; gap: 3px; height: 46px; margin-top: 12px; }
  .ubar { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
  .ubar-e { background: #ef4444; border-radius: 2px 2px 0 0; }
  .ubar-o { background: #3b82f6; }
  .ubar-empty { background: #1a1d27; height: 2px; border-radius: 2px; }
  .uhours-lbl { display: flex; gap: 3px; margin-top: 3px; }
  .uhours-lbl span { flex: 1; min-width: 0; text-align: center; font-size: 9px; color: #4b5163; }
  /* dòng model: thanh nền thể hiện tỉ trọng */
  .urow { position: relative; border-radius: 8px; overflow: hidden; background: #0b0d13; }
  .urow-fill { position: absolute; inset: 0 auto 0 0; background: rgba(59, 130, 246, .14); }
  .urow-txt {
    position: relative; display: flex; align-items: center; gap: 8px; padding: 6px 10px;
    font-size: 12px; color: #c2c7d4;
  }
  .urow-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .urow-n { color: #8b8fa3; font-size: 11.5px; flex-shrink: 0; }
  .urow-e { color: #f87171; font-size: 11px; flex-shrink: 0; }
  .ucode {
    font-size: 11px; padding: 3px 9px; border-radius: 999px; border: 1px solid #262a36;
    background: #141722; color: #8b8fa3;
  }
  .ucode b { color: #f87171; font-weight: 600; }

  /* ---- thanh phân bổ tài khoản: nhìn tỉ lệ ok/mới/lỗi thay vì đọc con số ---- */
  .accbar { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: #0b0d13; gap: 2px; }
  .accbar span { display: block; min-width: 2px; transition: width .3s ease; }
  .acc-ok { background: #10b981; }
  .acc-new { background: #3b82f6; }
  .acc-needs_human { background: #f59e0b; }
  .acc-failed { background: #ef4444; }
  .acc-unknown { background: #4b5163; }
  .acclg { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #8b8fa3; }
  .acclg i { width: 8px; height: 8px; border-radius: 50%; display: block; flex-shrink: 0; }

  /* ---- models gom nhóm: bấm mở nhóm, thay khối 43 model dính liền ---- */
  .modelsearch {
    background: #1a1d27; border: 1px solid #262a36; border-radius: 9px; padding: 7px 11px;
    font-size: 16px; color: #e4e4e7; outline: none; width: 150px; transition: border-color .2s ease;
  }
  .modelsearch:focus { border-color: rgba(59, 130, 246, .6); }
  @media (min-width: 768px) { .modelsearch { font-size: 12.5px; padding: 6px 10px; } }
  .mgrp { border: 1px solid #262a36; border-radius: 10px; background: #141722; overflow: hidden; }
  .mgrp-head {
    display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 12px;
    background: none; border: 0; color: #e4e4e7; font: inherit; font-size: 13px; text-align: left; cursor: pointer;
  }
  @media (min-width: 768px) { .mgrp-head:hover { background: #1a1e2b; } }
  .mgrp-name { font-weight: 600; text-transform: capitalize; }
  .mgrp-count { font-size: 11.5px; color: #666b7d; }
  .mgrp-chev { margin-left: auto; color: #666b7d; display: flex; transition: transform .2s ease; }
  .mgrp.open .mgrp-chev { transform: rotate(180deg); }
  .mgrp-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .2s ease; }
  .mgrp.open .mgrp-body { grid-template-rows: 1fr; }
  .mgrp-body > div { overflow: hidden; min-height: 0; }
  .mitem {
    padding: 5px 12px 5px 32px; font-size: 12px; color: #8b8fa3;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all;
  }
  .mitem mark { background: rgba(59, 130, 246, .25); color: #dbeafe; border-radius: 3px; }

  .agylog {
    background: #0b0d13; border: 1px solid #262a36; border-radius: 10px; padding: 10px 12px;
    height: 280px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    line-height: 1.5; color: #c9d1d9; -webkit-overflow-scrolling: touch;
  }
  /* log tô màu: lỗi đỏ / cảnh báo vàng / thành công xanh — quét mắt ra ngay */
  .lg-err { color: #f87171; }
  .lg-warn { color: #d9a441; }
  .lg-ok { color: #34d399; }
  .lg-dim { color: #666b7d; }
  .agycfgrow input {
    flex: 1; min-width: 0; background: #1a1d27; border: 1px solid #262a36; border-radius: 10px;
    padding: 10px 12px; font-size: 16px; color: #e4e4e7; outline: none; transition: border-color .15s;
  }
  .agycfgrow input:focus { border-color: rgba(59, 130, 246, .6); }
  .agycfgsave {
    min-height: 44px; min-width: 64px; padding: 0 14px; border-radius: 10px; border: 1px solid #262a36;
    background: #1a1d27; color: #8b8fa3; font: inherit; font-size: 13px; font-weight: 500;
    cursor: pointer; transition: color .15s, border-color .15s;
  }
  .agycfgsave:hover { color: #e4e4e7; border-color: rgba(59, 130, 246, .55); }
  .agycfgsave.dirty { color: #3b82f6; border-color: rgba(59, 130, 246, .55); }

  /* ---- mobile: tab bar FIXED nổi trên home indicator ----
     Trước đây #sidenav là flex item (order-2) nằm trong flow: khi content tràn /
     iOS standalone tính viewport lệch, cả bar bị đẩy xuống dưới home indicator.
     fixed + bottom:0 + env() đảm bảo bar luôn bám đáy viewport THẬT và tự chừa safe-area. */
  @media (max-width: 767px) {
    #sidenav {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
      padding-bottom: env(safe-area-inset-bottom);
    }
    /* sidenav ra khỏi flow -> content phải tự chừa chỗ cho bar (56px) + safe-area */
    #content { padding-bottom: calc(64px + env(safe-area-inset-bottom)); }
  }

  /* padding đáy các bar trong content: desktop/tablet (sidebar trái) bar nằm sát đáy
     viewport nên cần env(); mobile tab bar fixed đã che vùng safe-area -> chỉ padding thường,
     tránh double-padding. !important vì Tailwind CDN inject py-3 sau style block này. */
  .safepad { padding-bottom: calc(env(safe-area-inset-bottom) + 12px) !important; }
  .safepad-lg { padding-bottom: calc(env(safe-area-inset-bottom) + 16px) !important; }
  @media (max-width: 767px) {
    .safepad { padding-bottom: 12px !important; }
    .safepad-lg { padding-bottom: 16px !important; }
  }

  /* ---- soft keyboard (iOS/Android): JS đo visualViewport rồi bơm --kb ----
     Bàn phím bật: layout viewport iOS GIỮ NGUYÊN kích thước (chỉ visualViewport co)
     -> đáy #content (input bar) nằm sau bàn phím. --kb = phần layout bị bàn phím che;
     kb-open thay reserve tab-bar bằng --kb để input bar luôn nổi TRÊN bàn phím
     (tab bar fixed chấp nhận bị che — input quan trọng hơn). */
  :root { --kb: 0px; }
  #content { transition: padding-bottom .15s ease; }
  body.kb-open #content { padding-bottom: var(--kb); }

  /* ---- sidebar desktop collapsible ---- */
  @media (min-width: 768px) {
    #sidenav { transition: width .2s ease; }
    #sidenav.collapsed { width: 52px; }
    #sidenav.collapsed .tabbtn span:not(.tabbadge) { display: none; }
    #sidenav.collapsed .tabbtn { margin: 0 6px; padding: 10px 4px; }
  }
  #collapsebtn { display: none; }
  @media (min-width: 768px) { #collapsebtn { display: flex; } }

  /* lỗi lần gửi gần nhất (claude không resume được...) — trước đây thất bại im lặng */
  .chaterr {
    display: flex; align-items: flex-start; gap: 8px; margin: 0 16px 8px;
    padding: 9px 11px; border-radius: 11px; font-size: 12.5px; line-height: 1.5;
    color: #f87171; background: rgba(248, 113, 113, .10); border: 1px solid rgba(248, 113, 113, .28);
  }
  .chaterrx {
    background: none; border: 0; color: #f87171; opacity: .7; cursor: pointer;
    font-size: 13px; line-height: 1; padding: 2px 4px; flex-shrink: 0;
  }
  .chaterrx:hover { opacity: 1; }

  /* ================================================================
     GLASS — vật liệu kính kiểu Apple
     4 lớp tạo nên cảm giác "kính" thật (blur không thôi chỉ là mờ):
       1. nền màu phía sau để kính có thứ mà khúc xạ
       2. backdrop-filter: blur + saturate (bão hoà giữ màu không bị xám)
       3. viền hairline sáng
       4. specular highlight — vệt sáng 1px mép trên, chỗ ánh sáng bắt vào cạnh kính
     HIỆU NĂNG: KHÔNG đặt backdrop-filter lên phần tử cuộn nhiều (session row, tool card,
     bubble) — 94 lớp blur khi cuộn là quá nặng cho iPhone. Chúng chỉ dùng nền trong suốt
     trên nền gradient; blur dành cho bề mặt TĨNH (header, tab bar, thẻ lớn, thanh nhập).
     ================================================================ */
  :root {
    --g-blur: 20px;
    --g-sat: 1.6;
    --g-chrome: rgba(16, 18, 26, .72);   /* thanh trên/dưới: dày, đục hơn */
    --g-card: rgba(28, 32, 44, .55);     /* thẻ lớn tĩnh */
    --g-soft: rgba(255, 255, 255, .045); /* bề mặt nhẹ trên nền tối */
    --g-line: rgba(255, 255, 255, .10);  /* viền hairline */
    --g-spec: rgba(255, 255, 255, .07);  /* vệt sáng mép trên */
    --g-shadow: 0 8px 24px rgba(0, 0, 0, .30);
  }

  /* 1. nền màu: cố định, không cuộn theo -> kính luôn có thứ để bắt sáng */
  body {
    background:
      radial-gradient(900px 620px at 14% -8%, rgba(59, 130, 246, .16), transparent 60%),
      radial-gradient(760px 560px at 88% 4%, rgba(139, 92, 246, .14), transparent 62%),
      radial-gradient(680px 620px at 52% 106%, rgba(16, 185, 129, .08), transparent 60%),
      #0a0c12;
    background-attachment: fixed;
  }

  /* 2+3+4. chrome: thanh trên, tab bar, sidebar */
  header, #tabbar, #sidenav {
    background: var(--g-chrome) !important;
    -webkit-backdrop-filter: blur(var(--g-blur)) saturate(var(--g-sat));
    backdrop-filter: blur(var(--g-blur)) saturate(var(--g-sat));
  }
  header { border-bottom: 1px solid var(--g-line) !important; box-shadow: 0 1px 0 var(--g-spec) inset; }
  #tabbar { border-top: 1px solid var(--g-line) !important; box-shadow: 0 1px 0 var(--g-spec) inset; }

  /* thẻ lớn TĨNH -> được dùng blur thật */
  .chartbox, .agyhero, .statcard, #overlaybox, #drawer {
    background: var(--g-card) !important;
    -webkit-backdrop-filter: blur(16px) saturate(1.5);
    backdrop-filter: blur(16px) saturate(1.5);
    border: 1px solid var(--g-line) !important;
    box-shadow: 0 1px 0 var(--g-spec) inset, var(--g-shadow) !important;
  }

  /* thanh nhập liệu: nền mờ + blur (chỉ 1-2 cái, rẻ) */
  .inputwrap, .permbtn, .agybtn, .seg, .modelsearch {
    background: var(--g-soft) !important;
    -webkit-backdrop-filter: blur(12px) saturate(1.4);
    backdrop-filter: blur(12px) saturate(1.4);
    border: 1px solid var(--g-line) !important;
  }

  /* CUỘN NHIỀU -> chỉ nền trong suốt, KHÔNG blur (giữ 60fps trên iPhone) */
  .srow, .tcard, .mgrp, .urow, .agylog, .codewrap .codeblock {
    background: rgba(28, 32, 44, .50) !important;
    border: 1px solid var(--g-line) !important;
  }
  .srow { box-shadow: 0 1px 0 var(--g-spec) inset; }
  .bub-assistant { background: rgba(28, 32, 44, .55) !important; border: 1px solid var(--g-line) !important; }
  .bub-tool { background: rgba(28, 32, 44, .38) !important; }
  /* bubble user giữ accent xanh — dấu hiệu nhận biết ai nói, đừng làm mờ đi */

  /* trạng thái đặc biệt phải NỔI hơn nền kính, không bị hoà tan */
  .tcard.t-err { background: rgba(60, 26, 30, .62) !important; border-color: rgba(248,113,113,.55) !important; }
  .tcard.t-run { background: rgba(58, 46, 20, .55) !important; }
  .agyhero.on { border-color: rgba(16, 185, 129, .40) !important; }
  .agyhero.off { border-color: rgba(248, 113, 113, .40) !important; }
  .srow.selected, .srow.cmp-sel { background: rgba(59, 130, 246, .16) !important; border-color: rgba(59,130,246,.45) !important; }

  /* nền tối phía sau overlay/drawer: mờ mạnh cho tách lớp rõ */
  #overlay, #drawerback {
    -webkit-backdrop-filter: blur(8px) saturate(1.2);
    backdrop-filter: blur(8px) saturate(1.2);
  }

  /* KHÔNG hỗ trợ backdrop-filter (Firefox cũ...) -> nền đặc, vẫn đọc tốt */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    header, #tabbar, #sidenav { background: #12141c !important; }
    .chartbox, .agyhero, .statcard, #overlaybox, #drawer,
    .srow, .tcard, .mgrp, .urow, .bub-assistant { background: #1a1d27 !important; }
    .inputwrap, .permbtn, .agybtn, .seg, .modelsearch { background: #1a1d27 !important; }
  }
</style>
</head>
<!-- height dvh (không phải h-screen/100vh): iOS Safari tính 100vh gồm cả vùng sau toolbar/home
     indicator -> bottom tab bar + input bar bị đẩy xuống dưới nút home. dvh = viewport thật. -->
<body class="bg-[#0f1117] text-[#e4e4e7] flex flex-col overflow-hidden text-[14px]"
      style="height:100vh;height:100dvh">

<!-- ================= header ================= -->
<header class="flex items-center gap-3 px-4 py-2.5 border-b border-[#262a36] shrink-0"
        style="padding-top:calc(env(safe-area-inset-top) + 10px);background:linear-gradient(90deg,#0f1117,#1a1d27,#0f1117)">
  <div class="logoglow w-8 h-8 rounded-[10px] bg-[#3b82f6]/15 flex items-center justify-center text-[#3b82f6] shrink-0">
    <i data-lucide="terminal" class="w-4 h-4"></i>
  </div>
  <h1 class="apptitle font-semibold text-[15px] tracking-tight whitespace-nowrap">Claude Control Center</h1>
  <span id="busyind" class="loading loading-dots loading-xs text-[#3b82f6] hidden"></span>
  <div class="ml-auto flex items-center gap-3">
    <span id="runpill" class="runpill hidden"><span class="chip-dot"></span><span id="runpill-n">0</span>&nbsp;running</span>
    <span id="modeltag" class="hidden sm:inline text-xs text-[#8b8fa3] bg-[#1a1d27] border border-[#262a36] rounded-full px-3 py-1">default</span>
    <span id="clock" class="hidden sm:inline text-xs text-[#666b7d] tabular-nums"></span>
    <button class="w-8 h-8 rounded-lg hover:bg-[#1a1d27] flex items-center justify-center text-[#8b8fa3] transition-colors"
            onclick="showShortcuts()" title="Keyboard shortcuts (?)">
      <i data-lucide="circle-help" class="w-4 h-4"></i>
    </button>
  </div>
</header>

<!-- ================= app: sidebar + content ================= -->
<div id="app" class="flex-1 flex flex-col md:flex-row min-h-0">

  <!-- sidebar: desktop trái (collapsible), mobile thành bottom tab bar 🖥️/💬/📊 -->
  <nav id="sidenav" class="order-2 md:order-1 flex md:flex-col items-stretch justify-around md:justify-start gap-1
              border-t md:border-t-0 md:border-r border-[#262a36] bg-[#12141c] md:w-[76px] py-1 md:py-3 shrink-0"
       style="padding-bottom:env(safe-area-inset-bottom)">
    <button id="tabbtn-cli" class="tabbtn active" onclick="switchTab('cli')">
      <i data-lucide="terminal" class="w-5 h-5"></i><span>CLAUDE</span>
      <span id="badge-cli" class="tabbadge hidden"></span>
    </button>
    <button id="tabbtn-hermes" class="tabbtn hm" onclick="switchTab('hermes')">
      <i data-lucide="bot" class="w-5 h-5"></i><span>HERMES</span>
      <span id="badge-hermes" class="tabbadge hidden"></span>
    </button>
    <button id="tabbtn-agy" class="tabbtn" onclick="switchTab('agy')">
      <i data-lucide="settings" class="w-5 h-5"></i><span>AGY-PROXY</span>
    </button>
    <button id="tabbtn-stats" class="tabbtn" onclick="switchTab('stats')">
      <i data-lucide="chart-pie" class="w-5 h-5"></i><span>STATS</span>
    </button>
    <!-- collapse sidebar: chỉ desktop -->
    <button id="collapsebtn" class="tabbtn md:mt-auto" onclick="toggleSidebar()" title="Thu gọn sidebar">
      <i data-lucide="panel-left-close" class="w-5 h-5"></i>
    </button>
  </nav>

  <div id="content" class="order-1 md:order-2 flex-1 flex flex-col min-h-0 min-w-0">

    <!-- ============ TAB 1: CLAUDE CLI ============ -->
    <div id="tab-cli" class="flex-1 flex flex-col min-h-0">

      <!-- list view -->
      <div id="list" class="flex-1 flex flex-col min-h-0">
        <!-- toolbar: search + project filter -->
        <div class="flex items-center gap-2 px-4 py-2.5 border-b border-[#262a36]">
          <!-- min-w-0 cả wrapper lẫn input: input mặc định có min-width ~200px, không co được
               trong flex -> đẩy nút compare ra ngoài viewport mobile 390px -->
          <div class="inputwrap flex-1 min-w-0 flex items-center gap-2 bg-[#1a1d27] border border-[#262a36] rounded-[10px] px-3
                      focus-within:border-[#3b82f6]/60 transition-colors">
            <i data-lucide="search" class="w-3.5 h-3.5 text-[#666b7d] shrink-0"></i>
            <input id="searchbox" class="flex-1 min-w-0 w-full bg-transparent outline-none py-1.5 text-[13px] placeholder-[#666b7d]"
                   placeholder="Tìm session hoặc project…">
          </div>
          <select id="projfilter" class="select select-sm bg-[#1a1d27] border-[#262a36] text-[13px] text-[#e4e4e7] rounded-[10px] max-w-[130px] sm:max-w-[180px] shrink-0 focus:outline-none">
            <option value="">Tất cả project</option>
          </select>
          <button id="comparebtn" class="w-11 h-11 rounded-[10px] bg-[#1a1d27] border border-[#262a36] hover:border-[#3b82f6]/60
                                          flex items-center justify-center text-[#8b8fa3] transition-colors shrink-0"
                  onclick="toggleCompareMode()" title="So sánh 2 sessions (bấm rồi chọn 2 session)">
            <i data-lucide="git-compare" class="w-4 h-4"></i>
          </button>
        </div>
        <div id="jobsbar" class="hidden border-b border-[#262a36] py-1"></div>
        <div id="main" class="flex-1 overflow-y-auto py-2">
          <!-- skeleton shimmer: chỉ hiện khi chờ SSE tick đầu tiên, renderList() remove -->
          <div id="skelrows" class="flex flex-col gap-1 py-1">
            <div class="flex items-center gap-3 px-4 py-2.5 mx-2"><span class="skel w-2 h-2 rounded-full shrink-0"></span><span class="skel w-9 h-9 rounded-[11px] shrink-0"></span><span class="flex-1 flex flex-col gap-2"><span class="skel h-3 w-2/5"></span><span class="skel h-2.5 w-3/5"></span></span></div>
            <div class="flex items-center gap-3 px-4 py-2.5 mx-2"><span class="skel w-2 h-2 rounded-full shrink-0"></span><span class="skel w-9 h-9 rounded-[11px] shrink-0"></span><span class="flex-1 flex flex-col gap-2"><span class="skel h-3 w-1/3"></span><span class="skel h-2.5 w-1/2"></span></span></div>
            <div class="flex items-center gap-3 px-4 py-2.5 mx-2"><span class="skel w-2 h-2 rounded-full shrink-0"></span><span class="skel w-9 h-9 rounded-[11px] shrink-0"></span><span class="flex-1 flex flex-col gap-2"><span class="skel h-3 w-1/2"></span><span class="skel h-2.5 w-2/3"></span></span></div>
          </div>
          <div id="sessrows"></div>
          <div id="emptystate" class="hidden text-center text-[#666b7d] py-10 text-[13px]">Không có session nào khớp</div>
        </div>

        <!-- input bar -->
        <div class="relative border-t border-[#262a36] bg-[#12141c] px-3 py-3 safepad">
          <div class="flex items-center gap-2 flex-wrap">
            <div class="flex items-center gap-2 w-full md:w-auto min-w-0">
              <div id="modeseg" class="seg segscroll">
                <button class="segbtn active" data-mode="">Normal</button>
                <button class="segbtn" data-mode="research">Research</button>
                <button class="segbtn" data-mode="coding">Coding</button>
                <button class="segbtn" data-mode="creative">Creative</button>
              </div>
              <!-- công tắc quyền: quyết định Claude có tự sửa file được không -->
              <button id="permbtn" class="permbtn ml-auto md:ml-0" onclick="cyclePerm()"
                      title="Quyền của Claude khi làm việc — bấm để đổi">
                <span id="permicon" class="permdot"></span><span id="permlabel">Tự sửa file</span>
              </button>
            </div>
            <!-- nút / mở command palette drawer (cmd+K) -->
            <button id="palbtn" class="w-11 h-11 rounded-xl bg-[#1a1d27] border border-[#262a36] hover:border-[#3b82f6]/60
                                        flex items-center justify-center text-[#8b8fa3] font-mono font-bold text-[15px]
                                        transition-colors shrink-0" title="Command palette (⌘K hoặc gõ /)">/</button>
            <div class="inputwrap flex-1 min-w-[200px] flex items-center gap-2 bg-[#1a1d27] border border-[#262a36] rounded-xl px-3.5
                        focus-within:border-[#3b82f6]/60 transition-colors">
              <input id="taskinput" class="flex-1 bg-transparent outline-none py-2.5 text-[16px] placeholder-[#666b7d]"
                     placeholder="Giao task cho Claude — gõ / để xem lệnh…">
            </div>
            <button id="enhancebtn" class="w-11 h-11 rounded-xl bg-[#1a1d27] border border-[#262a36] hover:border-[#8b5cf6]/60
                                           flex items-center justify-center text-[#a78bfa] transition-colors shrink-0"
                    title="Enhance prompt bằng Claude">
              <i data-lucide="sparkles" class="w-4 h-4"></i>
            </button>
            <button id="sendbtn" class="sendgrad w-11 h-11 rounded-xl flex items-center justify-center
                                        text-white shrink-0" title="Gửi (Enter)">
              <i data-lucide="send" class="w-4 h-4"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- chat view -->
      <div id="chat" class="hidden flex-1 flex-col min-h-0">
        <div class="flex items-center gap-3 px-4 py-2.5 border-b border-[#262a36]">
          <button class="w-8 h-8 rounded-lg hover:bg-[#1a1d27] flex items-center justify-center text-[#8b8fa3] transition-colors"
                  onclick="backToList()"><i data-lucide="arrow-left" class="w-4 h-4"></i></button>
          <button id="chatsid" class="chattitle text-[13px] font-medium text-[#a5a9b8] truncate text-left"
                  onclick="renameSession()" title="Bấm để đổi tên phiên"></button>
          <span id="chatstatus" class="chip st-IDLE"><span class="chip-dot"></span><span class="chip-label">IDLE</span></span>
          <button id="exportbtn" class="ml-auto w-8 h-8 rounded-lg hover:bg-[#1a1d27] flex items-center justify-center text-[#8b8fa3] transition-colors"
                  onclick="exportCurrent()" title="Export session (.md / .json)"><i data-lucide="download" class="w-4 h-4"></i></button>
          <button class="w-8 h-8 rounded-lg hover:bg-[#2a1518] flex items-center justify-center text-[#ef4444] transition-colors"
                  onclick="killCurrent()" title="Kill session"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>
        <div id="bubbles" class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2.5" style="scroll-behavior:smooth"></div>
        <!-- lỗi lần gửi gần nhất (vd claude không tìm thấy phiên) — trước đây thất bại IM LẶNG -->
        <div id="chaterr" class="hidden chaterr">
          <span id="chaterrmsg" class="flex-1 min-w-0"></span>
          <button class="chaterrx" onclick="document.getElementById('chaterr').classList.add('hidden')"
                  title="Đóng">✕</button>
        </div>
        <div id="typingind" class="hidden px-4"><div class="tdots"><span></span><span></span><span></span></div></div>
        <!-- lỗi khi chạy Claude (vd phiên không resume được) — trước đây bị nuốt im lặng -->
        <div id="chaterr" class="hidden mx-4 mb-2 chaterrbox"></div>
        <div class="border-t border-[#262a36] bg-[#12141c] px-3 py-3 safepad">
          <div class="flex items-center gap-2">
            <div class="inputwrap flex-1 flex items-center gap-2 bg-[#1a1d27] border border-[#262a36] rounded-xl px-3.5
                        focus-within:border-[#3b82f6]/60 transition-colors">
              <input id="chatinput" class="flex-1 bg-transparent outline-none py-2.5 text-[16px] placeholder-[#666b7d]"
                     placeholder="Tiếp tục cuộc trò chuyện…">
            </div>
            <button id="chatsendbtn" class="sendgrad w-11 h-11 rounded-xl flex items-center justify-center
                                            text-white shrink-0"><i data-lucide="send" class="w-4 h-4"></i></button>
          </div>
        </div>
      </div>

      <!-- compare view: 2 sessions side-by-side (read-only, poll 3s append-only) -->
      <div id="compare" class="hidden flex-1 flex-col min-h-0">
        <div class="flex items-center gap-3 px-4 py-2.5 border-b border-[#262a36]">
          <button class="w-8 h-8 rounded-lg hover:bg-[#1a1d27] flex items-center justify-center text-[#8b8fa3] transition-colors"
                  onclick="closeCompare()"><i data-lucide="arrow-left" class="w-4 h-4"></i></button>
          <span class="text-[13px] font-medium text-[#a5a9b8]">So sánh sessions</span>
        </div>
        <div class="flex-1 grid grid-cols-2 min-h-0">
          <div class="flex flex-col min-h-0 border-r border-[#262a36]">
            <div class="flex items-center gap-2 px-3 py-2 border-b border-[#262a36]">
              <span id="cmp-sid-0" class="text-[12px] font-medium text-[#a5a9b8] truncate"></span>
              <span id="cmp-st-0" class="chip ml-auto st-IDLE">IDLE</span>
            </div>
            <div id="cmp-bub-0" class="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-2"></div>
          </div>
          <div class="flex flex-col min-h-0">
            <div class="flex items-center gap-2 px-3 py-2 border-b border-[#262a36]">
              <span id="cmp-sid-1" class="text-[12px] font-medium text-[#a5a9b8] truncate"></span>
              <span id="cmp-st-1" class="chip ml-auto st-IDLE">IDLE</span>
            </div>
            <div id="cmp-bub-1" class="flex-1 overflow-y-auto px-2 py-3 flex flex-col gap-2"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ TAB 2: HERMES ============ -->
    <div id="tab-hermes" class="hidden flex-1 flex-col min-h-0">
      <div id="hermes-list" class="flex-1 overflow-y-auto py-2">
        <!-- chat trực tiếp với Hermes CLI: pinned trên cùng, không thuộc state.db -->
        <div class="srow" onclick="openHermesDirect()" style="border-color:rgba(139,92,246,.35)">
          <span class="chip" style="background:rgba(139,92,246,.14);color:#a78bfa">CLI</span>
          <span class="text-[13px] font-medium">Chat trực tiếp với Hermes</span>
          <span class="text-xs text-[#666b7d] ml-auto whitespace-nowrap">hermes -z</span>
        </div>
        <div id="hermesrows"></div>
        <div id="hermesempty" class="hidden text-center text-[#666b7d] py-10 text-[13px]">
          Chưa có data — không tìm thấy conversations trong ~/.hermes/state.db
        </div>
      </div>
      <div id="hermes-chat" class="hidden flex-1 flex-col min-h-0">
        <div class="flex items-center gap-3 px-4 py-2.5 border-b border-[#262a36]">
          <button class="w-8 h-8 rounded-lg hover:bg-[#1a1d27] flex items-center justify-center text-[#8b8fa3] transition-colors"
                  onclick="hermesBack()"><i data-lucide="arrow-left" class="w-4 h-4"></i></button>
          <span id="hermes-title" class="text-[13px] font-medium text-[#a5a9b8] truncate"></span>
          <button id="hermes-exportbtn" class="ml-auto w-8 h-8 rounded-lg hover:bg-[#1a1d27] flex items-center justify-center text-[#8b8fa3] transition-colors"
                  onclick="hermesExport()" title="Export chat (.md / .json)"><i data-lucide="download" class="w-4 h-4"></i></button>
        </div>
        <div id="hermes-bubbles" class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2.5" style="scroll-behavior:smooth"></div>
        <div id="hermes-typing" class="hidden px-4"><div class="tdots"><span></span><span></span><span></span></div></div>
        <div class="border-t border-[#262a36] bg-[#12141c] px-3 py-3 safepad">
          <div class="flex items-center gap-2">
            <div class="inputwrap-hm flex-1 flex items-center gap-2 bg-[#1a1d27] border border-[#262a36] rounded-xl px-3.5
                        focus-within:border-[#8b5cf6]/60 transition-colors">
              <input id="hermes-input" class="flex-1 bg-transparent outline-none py-2.5 text-[16px] placeholder-[#666b7d]"
                     placeholder="Trò chuyện với Hermes…">
            </div>
            <button id="hermessendbtn" class="sendgrad hm w-11 h-11 rounded-xl flex items-center justify-center
                                              text-white shrink-0"><i data-lucide="send" class="w-4 h-4"></i></button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ TAB 3: AGY-PROXY CONFIG (gọi CLI, không tự implement proxy) ============ -->
    <div id="tab-agy" class="hidden flex-1 flex-col min-h-0 overflow-y-auto">
      <div class="p-4 flex flex-col gap-4 max-w-[1000px] w-full mx-auto safepad-lg">
        <!-- THẺ TRẠNG THÁI: thông tin quan trọng nhất, 1 chỗ duy nhất -->
        <div id="agy-hero" class="agyhero">
          <div class="flex items-center gap-3 flex-wrap">
            <span class="agyhero-dot" id="agy-hero-dot"></span>
            <span id="agy-status" class="agyhero-state">đang kiểm tra…</span>
            <span id="agy-hero-meta" class="agyhero-meta"></span>
            <span id="agy-hero-tag" class="agyhero-tag hidden"></span>
          </div>
          <div class="flex flex-wrap gap-2 mt-3">
            <button id="agy-btn-start" class="agybtn" onclick="agyAction('start')">
              <i data-lucide="play" class="w-4 h-4"></i><span>Start</span></button>
            <button id="agy-btn-stop" class="agybtn agybtn-red" onclick="agyAction('stop')">
              <i data-lucide="square" class="w-4 h-4"></i><span>Stop</span></button>
            <button id="agy-btn-restart" class="agybtn" onclick="agyAction('restart')">
              <i data-lucide="rotate-cw" class="w-4 h-4"></i><span>Restart</span></button>
          </div>
          <div id="agy-note" class="hidden agyhero-note">
            Proxy đang chạy NGOÀI dashboard nên Stop/Restart không tác dụng — dừng nó ở nơi đã khởi chạy.
          </div>
        </div>

        <!-- LƯU LƯỢNG THẬT: đọc bảng gateway_usage trong state.db -->
        <div id="agy-usagebox" class="chartbox hidden">
          <div class="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
            <span class="text-[13px] font-semibold text-[#a5a9b8]">Lưu lượng 24 giờ</span>
            <span id="agy-u-avg" class="text-[11.5px] text-[#666b7d]"></span>
          </div>
          <div class="ustats">
            <div><div id="agy-u-reqs" class="ustat-n">–</div><div class="ustat-l">request</div></div>
            <div><div id="agy-u-errs" class="ustat-n">–</div><div class="ustat-l">lỗi</div></div>
            <div><div id="agy-u-tok" class="ustat-n">–</div><div class="ustat-l">token</div></div>
          </div>
          <div id="agy-u-alert" class="hidden uabox"></div>
          <div id="agy-u-hours" class="uhours"></div>
          <div id="agy-u-hourlbl" class="uhours-lbl"></div>
          <div id="agy-u-models" class="mt-3 flex flex-col gap-1.5"></div>
          <div id="agy-u-codes" class="mt-3 pt-2.5 border-t border-[#262a36] flex flex-wrap gap-2"></div>
        </div>

        <!-- SỨC KHOẺ TÀI KHOẢN: thanh phân bổ thay cho con số trơ trọi -->
        <div class="chartbox">
          <div class="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
            <span class="text-[13px] font-semibold text-[#a5a9b8]">Tài khoản
              <span id="agy-accounts" class="text-[#e4e4e7]">–</span></span>
            <span id="agy-acc-recent" class="text-[11.5px] text-[#666b7d]"></span>
          </div>
          <div id="agy-accbar" class="accbar"></div>
          <div id="agy-acclegend" class="flex flex-wrap gap-x-4 gap-y-1 mt-2.5"></div>
          <div id="agy-kiro" class="text-[11.5px] text-[#666b7d] mt-2.5 pt-2.5 border-t border-[#262a36]"></div>
        </div>

        <!-- KIỂM TRA: gộp nút chạy + kết quả lần cuối vào cùng chỗ -->
        <div class="chartbox">
          <div class="text-[13px] font-semibold mb-2.5 text-[#a5a9b8]">Kiểm tra</div>
          <div class="flex flex-wrap gap-2">
            <button id="agy-btn-typecheck" class="agybtn" onclick="agyAction('run', 'typecheck')">
              <i data-lucide="badge-check" class="w-4 h-4"></i><span>Typecheck</span></button>
            <button id="agy-btn-test" class="agybtn" onclick="agyAction('run', 'test')">
              <i data-lucide="flask-conical" class="w-4 h-4"></i><span>Test</span></button>
            <button id="agy-btn-build" class="agybtn" onclick="agyAction('run', 'build')">
              <i data-lucide="hammer" class="w-4 h-4"></i><span>Build</span></button>
          </div>
          <div class="flex flex-wrap gap-2 mt-2.5">
            <span id="agy-last-typecheck" class="agychip">TYPECHECK: —</span>
            <span id="agy-last-test" class="agychip">TEST: —</span>
            <span id="agy-last-build" class="agychip">BUILD: —</span>
          </div>
        </div>

        <!-- MODELS: gom nhóm theo nhà cung cấp + tìm kiếm, thay khối chữ 43 model -->
        <div class="chartbox">
          <div class="flex items-baseline justify-between mb-2 gap-2 flex-wrap">
            <span class="text-[13px] font-semibold text-[#a5a9b8]">Models
              <span id="agy-models" class="text-[#e4e4e7]">–</span></span>
            <input id="agy-modelsearch" class="modelsearch" placeholder="tìm model…" oninput="renderAgyModels()">
          </div>
          <div id="agy-modellist" class="flex flex-col gap-1.5"></div>
        </div>

        <!-- config .env: chỉ field whitelist, save ghi lại file -->
        <div class="chartbox">
          <div class="text-[13px] font-semibold mb-1 text-[#a5a9b8]">Config (.env của agy-proxy)</div>
          <div class="text-[11.5px] text-[#666b7d] mb-3">Lưu ý: giá trị đổi từ dashboard riêng của agy-proxy (settings DB) sẽ đè .env.</div>
          <div id="agy-config" class="flex flex-col gap-3">
            <div class="text-[12.5px] text-[#666b7d]">Đang tải config...</div>
          </div>
        </div>

        <!-- log panel realtime -->
        <div class="chartbox">
          <div class="flex items-center justify-between mb-2">
            <span class="text-[13px] font-semibold text-[#a5a9b8]">Log (dev / build / test / typecheck)</span>
            <button class="text-[11.5px] text-[#8b8fa3] hover:text-[#e4e4e7] border border-[#262a36] rounded-lg px-3 py-1.5 transition-colors"
                    onclick="agyClearLog()">Clear</button>
          </div>
          <div id="agy-log" class="agylog">(chưa có log — bấm Start/Build/Test/Typecheck)</div>
        </div>
      </div>
    </div>

    <!-- ============ TAB 4: STATS (Chart.js) ============ -->
    <div id="tab-stats" class="hidden flex-1 flex-col min-h-0 overflow-y-auto">
      <div class="p-4 flex flex-col gap-4 max-w-[1000px] w-full mx-auto safepad-lg">
        <!-- stat cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="statcard"><div id="stat-total" class="statnum text-[#e4e4e7]">0</div><div class="statlbl">TOTAL SESSIONS</div></div>
          <div class="statcard"><div id="stat-active" class="statnum text-[#60a5fa]">0</div><div class="statlbl">ACTIVE / RUNNING</div></div>
          <div class="statcard"><div id="stat-idle" class="statnum text-[#8b8fa3]">0</div><div class="statlbl">IDLE</div></div>
          <div class="statcard"><div id="stat-msgs" class="statnum text-[#a78bfa]">0</div><div class="statlbl">TOTAL MESSAGES</div></div>
        </div>
        <!-- charts: donut sessions/project + bar messages top 5 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="chartbox">
            <div class="text-[13px] font-semibold mb-3 text-[#a5a9b8]">Sessions theo project</div>
            <div class="relative h-[260px]"><canvas id="chart-donut"></canvas></div>
          </div>
          <div class="chartbox">
            <div class="text-[13px] font-semibold mb-3 text-[#a5a9b8]">Messages per project (top 5)</div>
            <div class="relative h-[260px]"><canvas id="chart-bar"></canvas></div>
          </div>
        </div>
      </div>
    </div>

  </div>
</div>

<!-- ============ command palette DRAWER (slide-up) ============ -->
<div id="drawerwrap">
  <div id="drawerback" onclick="closePalette()"></div>
  <div id="drawer">
    <div class="drawerhandle"></div>
    <!-- filter input -->
    <div class="px-4 pt-3 pb-2">
      <div class="inputwrap flex items-center gap-2 bg-[#1a1d27] border border-[#262a36] rounded-xl px-3.5
                  focus-within:border-[#3b82f6]/60 transition-colors">
        <i data-lucide="search" class="w-4 h-4 text-[#666b7d] shrink-0"></i>
        <input id="palfilter" class="flex-1 bg-transparent outline-none py-2.5 text-[16px] placeholder-[#666b7d]"
               placeholder="Lọc lệnh... (↑↓ chọn, Enter chạy, Esc đóng)">
      </div>
    </div>
    <!-- cards build 1 lần trong JS, filter chỉ ẩn/hiện -->
    <div id="palbody" class="flex-1 overflow-y-auto px-4 pb-4"></div>
  </div>
</div>

<!-- overlay modal dùng chung -->
<div id="overlay">
  <div id="overlaybox" class="bg-[#12141c] border border-[#262a36] rounded-2xl shadow-2xl w-[min(640px,92vw)] flex flex-col fadein"
       style="max-height:80vh;max-height:80dvh">
    <div class="flex items-center justify-between px-5 py-3.5 border-b border-[#262a36]">
      <span id="overlaytitle" class="font-semibold text-[14px]"></span>
      <button class="w-7 h-7 rounded-lg hover:bg-[#1a1d27] flex items-center justify-center text-[#8b8fa3]"
              onclick="closeOverlay()"><i data-lucide="x" class="w-4 h-4"></i></button>
    </div>
    <div id="overlaybody" class="px-5 py-4 overflow-y-auto whitespace-pre-wrap break-words text-[13.5px] leading-relaxed"></div>
    <div id="overlayfoot" class="px-5 py-3 border-t border-[#262a36] flex gap-2 justify-end empty:hidden"></div>
  </div>
</div>
<div id="toast"></div>

<script>
/* ================= state chung ================= */
let currentSid = null;
let chatTimer = null;
let allSessions = [];
let allJobs = [];
let activeTab = 'cli';
let currentMode = '';

// Icon SVG inline cho phần tử tạo động (tránh gọi lucide.createIcons() liên tục)
const ICON_TRASH = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const ICON_COPY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

window.addEventListener('load', () => { if (window.lucide) lucide.createIcons(); });

setInterval(() => {
  const el = document.getElementById('clock');
  const v = new Date().toLocaleTimeString();
  if (el.textContent !== v) el.textContent = v;
}, 1000);

function ago(ms) {
  if (!ms) return '?';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

// set text chỉ khi thay đổi — tránh mutation thừa gây reflow
function setText(el, v) { if (el.textContent !== v) el.textContent = v; }

/* ================= busy indicator ================= */
let busyCount = 0;
function busy(on) {
  busyCount += on ? 1 : -1;
  if (busyCount < 0) busyCount = 0;
  document.getElementById('busyind').classList.toggle('hidden', busyCount === 0);
}

/* ================= toast ================= */
let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ================= notifications: báo khi có reply mà không ở tab/chat đó ================= */
// Beep nhẹ qua WebAudio — iOS không hỗ trợ navigator.vibrate nên cần fallback âm thanh.
// AudioContext phải unlock bằng user gesture (autoplay policy) -> tạo lazy ở pointerdown/keydown đầu tiên.
let audioCtx = null;
let notifAsked = false;
function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!audioCtx && AC) { try { audioCtx = new AC(); } catch {} }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
  // xin quyền system notification 1 lần ở gesture đầu tiên (browser yêu cầu user gesture)
  if (!notifAsked && 'Notification' in window && Notification.permission === 'default') {
    notifAsked = true;
    try {
      Notification.requestPermission().then(function (perm) { if (perm === 'granted') setupPush(); }).catch(function () {});
    } catch {}
  } else setupPush(); // đã granted từ trước (hoặc subscribe fail lượt trước) -> thử subscribe
}
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('keydown', unlockAudio);

function beep() {
  if (!audioCtx || audioCtx.state !== 'running') return; // chưa unlock -> im lặng, không lỗi
  try {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.04, audioCtx.currentTime); // rất nhẹ
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.13);
  } catch {}
}

// Toast + vibration nhẹ (Android) + beep nhẹ (iOS/desktop) — khi reply xong mà user không nhìn thấy.
// Tab đang ẩn (chuyển app / khóa màn hình) -> đẩy thêm system notification nếu đã cấp quyền.
function notifyDone(msg) {
  toast(msg);
  if (navigator.vibrate) { try { navigator.vibrate(30); } catch {} }
  beep();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification('Claude Control Center', { body: msg, icon: '/icon.svg', tag: 'ccc-done' }); } catch {}
  }
}

/* ================= Web Push: đăng ký nhận push THẬT từ server ================= */
// Cần secure context (https hoặc localhost) + quyền notification. Không đủ điều kiện
// (vd mở qua http://100.x.x.x) -> im lặng, giữ fallback Notification local ở notifyDone.
let pushSetupDone = false;
async function setupPush() {
  if (pushSetupDone) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  pushSetupDone = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const vap = await fetch('/api/push/vapid').then(r => r.json());
    const key = urlB64ToU8(vap.key);
    let sub = await reg.pushManager.getSubscription();
    // server đổi VAPID key -> subscription cũ vô dụng, huỷ rồi đăng ký lại
    if (sub && sub.options && sub.options.applicationServerKey) {
      const cur = new Uint8Array(sub.options.applicationServerKey);
      let same = cur.length === key.length;
      for (let i = 0; same && i < key.length; i++) same = cur[i] === key[i];
      if (!same) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
  } catch (e) {
    pushSetupDone = false; // push service không sẵn (browser/mạng) -> thử lại ở gesture sau
  }
}
function urlB64ToU8(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* ================= tabs + badges ================= */
function switchTab(t) {
  activeTab = t;
  for (const name of ['cli', 'hermes', 'agy', 'stats']) {
    document.getElementById('tab-' + name).classList.toggle('hidden', t !== name);
    document.getElementById('tab-' + name).classList.toggle('flex', t === name);
    document.getElementById('tabbtn-' + name).classList.toggle('active', t === name);
  }
  if (t === 'hermes') { hermesSeenTs = hermesMaxTs; refreshHermes(); }
  if (t === 'stats') updateCharts(); // vẽ/refresh charts khi vào tab
  if (t === 'agy') agyEnter(); else agyLeave(); // poll status+log chỉ khi đang ở tab agy
  updateBadges();
}

/* ---- vuốt ngang để chuyển tab (mobile) ----
   Bỏ qua khi: đang vuốt dọc (cuộn), vuốt bên trong vùng cuộn ngang được (code block,
   log, biểu đồ), hoặc đang mở overlay/chat để không cướp thao tác của người dùng. */
const TAB_ORDER = ['cli', 'hermes', 'agy', 'stats'];
let swX = 0, swY = 0, swT = 0, swSkip = false;
function scrollableXAncestor(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 4) {
      const ov = getComputedStyle(n).overflowX;
      if (ov === 'auto' || ov === 'scroll') return true;
    }
  }
  return false;
}
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { swSkip = true; return; }
  const t = e.touches[0];
  swX = t.clientX; swY = t.clientY; swT = Date.now();
  const ov = document.getElementById('overlay');
  swSkip = (ov && ov.style.display === 'flex')
    || !!document.querySelector('.imgov')            // đang xem ảnh full màn
    || !!(currentSid || compareSids)                 // đang trong chat/compare: vuốt dễ nhầm
    || scrollableXAncestor(t.target);
}, { passive: true });
document.addEventListener('touchend', e => {
  if (swSkip || !e.changedTouches.length) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swX, dy = t.clientY - swY;
  // ngưỡng: đi ngang ≥60px, gấp đôi độ lệch dọc, trong 600ms -> chắc chắn là vuốt ngang
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - swT > 600) return;
  const i = TAB_ORDER.indexOf(activeTab);
  if (i < 0) return;
  const next = dx < 0 ? i + 1 : i - 1;
  if (next < 0 || next >= TAB_ORDER.length) return;
  switchTab(TAB_ORDER[next]);
}, { passive: true });

// Sidebar desktop: thu gọn / mở rộng
function toggleSidebar() {
  document.getElementById('sidenav').classList.toggle('collapsed');
}
function setBadge(id, n) {
  const el = document.getElementById(id);
  el.classList.toggle('hidden', !(n > 0));
  if (n > 0) setText(el, n > 99 ? '99+' : String(n));
}
function updateBadges() {
  let cli = 0;
  allSessions.forEach(s => { cli += s.unread || 0; });
  setBadge('badge-cli', cli);
  let h = 0;
  if (activeTab !== 'hermes') {
    hermesConvos.forEach(c => c.messages.forEach(m => { if (m.ts > hermesSeenTs) h++; }));
  }
  setBadge('badge-hermes', h);
  // badge đẩy lên title tab browser: "(n) Claude Control Center"
  const tot = cli + h;
  const title = (tot > 0 ? '(' + (tot > 99 ? '99+' : tot) + ') ' : '') + 'Claude Control Center';
  if (document.title !== title) document.title = title;
}

/* ================= SSE ================= */
const es = new EventSource('/stream');
let prevRunning = null; // Set sid RUNNING tick trước — null = tick đầu (không notify session cũ)
es.onmessage = e => {
  const data = JSON.parse(e.data);
  allSessions = data.sessions || [];
  allJobs = data.jobs || [];
  if (data.perm) { permMode = data.perm; renderPerm(); } // server là nguồn thật (renderPerm tự no-op nếu không đổi)
  // RUNNING -> hết RUNNING = Claude trả lời xong; chỉ notify khi KHÔNG đang mở chat đó
  const nowRunning = new Set();
  allSessions.forEach(s => { if (s.status === 'RUNNING') nowRunning.add(s.sid); });
  if (prevRunning) {
    for (const sid of prevRunning) {
      if (!nowRunning.has(sid) && !(activeTab === 'cli' && currentSid === sid)) {
        const s = allSessions.find(x => x.sid === sid);
        const label = (s && s.title) ? s.title : 'Claude ' + sid.slice(0, 8);
        notifyDone(label + ' đã trả lời xong');
      }
    }
  }
  prevRunning = nowRunning;
  // pill RUNNING trên header: chỉ toggle/setText — animation pulse 1 lần do CSS lo khi hiện lại
  const runpill = document.getElementById('runpill');
  runpill.classList.toggle('hidden', nowRunning.size === 0);
  if (nowRunning.size > 0) setText(document.getElementById('runpill-n'), String(nowRunning.size));
  setText(document.getElementById('modeltag'), data.model || 'default');
  updateProjectOptions();
  renderList();
  renderJobs();
  updateBadges();
  if (activeTab === 'stats') updateCharts(); // data đổi -> chart.update(), không rebuild
};

// Dropdown project: chỉ rebuild khi danh sách đổi (giữ lựa chọn)
function updateProjectOptions() {
  const sel = document.getElementById('projfilter');
  const projects = [...new Set(allSessions.map(s => s.project))].sort();
  const current = sel.value;
  const existing = [...sel.options].slice(1).map(o => o.value);
  if (existing.join('\\u0000') === projects.join('\\u0000')) return;
  sel.innerHTML = '<option value="">Tất cả project</option>';
  for (const pr of projects) {
    const opt = document.createElement('option');
    opt.value = pr;
    opt.textContent = pr;
    sel.appendChild(opt);
  }
  if (projects.includes(current)) sel.value = current;
}

/* ================= session list: STABLE RENDER (diff theo data-sid) ================= */

function createSessionRow(s) {
  const row = document.createElement('div');
  row.className = 'srow fadein';
  row.dataset.sid = s.sid;
  row.onclick = () => rowClick(s.sid); // compare mode ON -> chọn để so sánh, OFF -> mở chat
  // Layout: [dot] [avatar] [body: title + meta] [right: time + badge]
  row.innerHTML =
    // dot trạng thái
    '<span class="sdot s-dot shrink-0"></span>' +
    // avatar icon
    '<span class="s-avatar w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0 text-[#60a5fa]" style="background:rgba(59,130,246,.1)">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>' +
    '</span>' +
    // body
    '<span class="flex-1 min-w-0 flex flex-col gap-0.5">' +
      '<span class="flex items-center gap-2">' +
        '<span class="s-sid text-[13px] font-semibold text-[#e4e4e7] truncate leading-tight"></span>' +
        '<span class="s-badge ubadge hidden ml-1 shrink-0"></span>' +
      '</span>' +
      '<span class="s-proj text-[11.5px] text-[#666b7d] truncate leading-tight"></span>' +
    '</span>' +
    // right col: time + kill
    '<span class="flex flex-col items-end gap-1.5 shrink-0">' +
      '<span class="s-time text-[10.5px] text-[#4b5163] whitespace-nowrap tabular-nums"></span>' +
      '<span class="s-msgs text-[10px] text-[#4b5163] whitespace-nowrap"></span>' +
    '</span>';
  const kill = document.createElement('button');
  kill.className = 's-kill hidden w-7 h-7 rounded-lg hover:bg-[#2a1518] flex items-center justify-center text-[#ef4444] transition-colors shrink-0';
  kill.title = 'Kill';
  kill.innerHTML = ICON_TRASH;
  kill.onclick = ev => { ev.stopPropagation(); fetch('/api/kill/' + s.sid, { method: 'POST' }); };
  row.appendChild(kill);
  return row;
}

// Chỉ update phần thay đổi của row — không rebuild
function updateSessionRow(row, s) {
  // dot trạng thái
  const dot = row.querySelector('.s-dot');
  const dotClass = 'sdot s-dot shrink-0 sdot-' + s.status;
  if (dot.className !== dotClass) dot.className = dotClass;

  // avatar màu theo trạng thái
  const av = row.querySelector('.s-avatar');
  if (av) {
    if (s.status === 'RUNNING') {
      av.style.background = 'rgba(16,185,129,.12)';
      av.style.color = '#34d399';
    } else if (s.status === 'ACTIVE') {
      av.style.background = 'rgba(59,130,246,.1)';
      av.style.color = '#60a5fa';
    } else {
      av.style.background = 'rgba(59,130,246,.06)';
      av.style.color = '#4b5163';
    }
  }

  // tiêu đề thật (ai-title / tên tự đặt); chưa có thì mới rơi về ID
  setText(row.querySelector('.s-sid'), s.title || s.sid.slice(0, 8));
  const sidEl = row.querySelector('.s-sid');
  if (sidEl.title !== s.sid) sidEl.title = s.sid; // hover/long-press vẫn xem được ID gốc
  setText(row.querySelector('.s-proj'), s.project);
  setText(row.querySelector('.s-time'), ago(s.mtimeMs));
  setText(row.querySelector('.s-msgs'), s.msgs + ' msgs');
  const badge = row.querySelector('.s-badge');
  badge.classList.toggle('hidden', !(s.unread > 0));
  if (s.unread > 0) setText(badge, String(s.unread));
  row.querySelector('.s-kill').classList.toggle('hidden', s.status !== 'RUNNING');
  row.classList.toggle('cmp-sel', compareMode && compareSel.includes(s.sid));
}

function filteredSessions() {
  const proj = document.getElementById('projfilter').value;
  const q = document.getElementById('searchbox').value.trim().toLowerCase();
  return allSessions.filter(s => {
    if (proj && s.project !== proj) return false;
    if (q && !(s.sid + ' ' + s.project + ' ' + (s.title || '')).toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderList() {
  const cont = document.getElementById('sessrows');
  const sessions = filteredSessions();
  document.getElementById('emptystate').classList.toggle('hidden', sessions.length > 0);
  const skel = document.getElementById('skelrows');
  if (skel) skel.remove(); // data thật đã về -> bỏ skeleton (shimmer chỉ chạy lúc chờ)
  const seen = new Set();
  sessions.forEach((s, idx) => {
    let row = cont.querySelector('[data-sid="' + s.sid + '"]');
    if (!row) row = createSessionRow(s);
    updateSessionRow(row, s);
    seen.add(s.sid);
    // đặt đúng vị trí — insertBefore với node có sẵn chỉ MOVE khi lệch thứ tự
    const cur = cont.children[idx];
    if (cur !== row) cont.insertBefore(row, cur || null);
  });
  [...cont.children].forEach(ch => { if (!seen.has(ch.dataset.sid)) ch.remove(); });
  applySelection();
}

/* ================= jobs bar (diff theo data-jid) ================= */
function renderJobs() {
  const bar = document.getElementById('jobsbar');
  bar.classList.toggle('hidden', !allJobs.length);
  const seen = new Set();
  for (const j of allJobs) {
    let row = bar.querySelector('[data-jid="' + j.id + '"]');
    if (!row) {
      row = document.createElement('div');
      row.className = 'jobrow fadein';
      row.dataset.jid = j.id;
      row.innerHTML =
        '<span class="font-semibold j-kind"></span>' +
        '<span class="truncate j-prompt"></span>' +
        '<span class="j-runs ml-auto whitespace-nowrap"></span>';
      const stop = document.createElement('button');
      stop.className = 'text-[11px] font-semibold border border-[#d9a441]/40 rounded-md px-2 py-0.5 hover:bg-[#d9a441]/15 transition-colors';
      stop.textContent = 'STOP';
      stop.onclick = ev => { ev.stopPropagation(); fetch('/api/jobs/stop/' + j.id, { method: 'POST' }); };
      row.appendChild(stop);
      row.onclick = () => { if (j.lastSid) openChat(j.lastSid); };
      bar.appendChild(row);
    }
    setText(row.querySelector('.j-kind'), '[' + j.kind.toUpperCase() + ' ' + j.spec + ']');
    setText(row.querySelector('.j-prompt'), j.prompt);
    setText(row.querySelector('.j-runs'), 'runs: ' + j.runs);
    seen.add(j.id);
  }
  [...bar.children].forEach(ch => { if (!seen.has(ch.dataset.jid)) ch.remove(); });
}

document.getElementById('searchbox').addEventListener('input', renderList);
document.getElementById('projfilter').addEventListener('change', renderList);

/* ================= keyboard selection (j/k/Enter) ================= */
let selIdx = -1;
function visibleRows() { return [...document.querySelectorAll('#sessrows .srow')]; }
function applySelection() {
  const rows = visibleRows();
  if (selIdx >= rows.length) selIdx = rows.length - 1;
  rows.forEach((r, i) => r.classList.toggle('selected', i === selIdx));
}
function moveSel(d) {
  const rows = visibleRows();
  if (!rows.length) return;
  selIdx = Math.min(rows.length - 1, Math.max(0, selIdx + d));
  applySelection();
  rows[selIdx].scrollIntoView({ block: 'nearest' });
}
function openSelected() {
  const rows = visibleRows();
  if (selIdx >= 0 && rows[selIdx]) openChat(rows[selIdx].dataset.sid);
}

/* ================= keyboard shortcuts toàn cục ================= */
let pendingG = false, pendingGTimer = null;
document.addEventListener('keydown', e => {
  const tag = (e.target.tagName || '').toLowerCase();
  const inField = tag === 'input' || tag === 'textarea' || tag === 'select';

  // cmd+K: toggle command palette | cmd+N: focus task input — hoạt động cả khi đang trong input
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    return paletteOpen() ? closePalette() : openPalette('');
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    switchTab('cli');
    if (currentSid) backToList();
    return document.getElementById('taskinput').focus();
  }
  // cmd+1/2/3/4: switch tab trực tiếp — hoạt động cả khi đang trong input
  if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '4') {
    e.preventDefault();
    return switchTab(['cli', 'hermes', 'agy', 'stats'][+e.key - 1]);
  }

  if (e.key === 'Escape') {
    if (paletteOpen()) return closePalette();
    if (document.getElementById('overlay').style.display === 'flex') return closeOverlay();
    if (inField) return e.target.blur();
    if (activeTab === 'cli' && compareSids) return closeCompare();
    if (activeTab === 'cli' && currentSid) return backToList();
    if (activeTab === 'hermes' && hermesOpenId) return hermesBack();
    return;
  }
  if (inField) return; // các phím còn lại chỉ hoạt động ngoài input
  // overlay đang mở -> không cho shortcut chạy "sau lưng" modal (Esc đã xử lý ở trên)
  if (document.getElementById('overlay').style.display === 'flex') return;

  // chord "g h" / "g c"
  if (pendingG) {
    pendingG = false;
    clearTimeout(pendingGTimer);
    if (e.key === 'h') { switchTab('hermes'); return; }
    if (e.key === 'c') { switchTab('cli'); return; }
    if (e.key === 'a') { switchTab('agy'); return; }
    if (e.key === 's') { switchTab('stats'); return; }
  }
  if (e.key === 'g') {
    pendingG = true;
    clearTimeout(pendingGTimer);
    pendingGTimer = setTimeout(() => { pendingG = false; }, 900);
    return;
  }

  // j/k/Enter: chỉ điều hướng list session khi đang thực sự ở list view tab CLI
  const inList = activeTab === 'cli' && !currentSid;
  if (e.key === 'j' || e.key === 'ArrowDown') { if (!inList) return; e.preventDefault(); moveSel(1); }
  else if (e.key === 'k' || e.key === 'ArrowUp') { if (!inList) return; e.preventDefault(); moveSel(-1); }
  else if (e.key === 'Enter') { if (inList) openSelected(); }
  else if (e.key === '/') {
    e.preventDefault();
    openPalette(''); // mở drawer command palette
  }
  else if (e.key === 'n') {
    e.preventDefault();
    switchTab('cli');
    if (currentSid) backToList();
    document.getElementById('taskinput').focus();
  }
  else if (e.key === '?') { showShortcuts(); }
});

/* ================= overlay modal ================= */
function showOverlay(title, bodyEl, footButtons) {
  document.getElementById('overlaytitle').textContent = title;
  const body = document.getElementById('overlaybody');
  body.innerHTML = '';
  body.appendChild(bodyEl);
  const foot = document.getElementById('overlayfoot');
  foot.innerHTML = '';
  (footButtons || []).forEach(b => foot.appendChild(b));
  document.getElementById('overlay').style.display = 'flex';
}
function closeOverlay() { document.getElementById('overlay').style.display = 'none'; }
function overlayButton(label, fn, primary) {
  const b = document.createElement('button');
  b.className = primary
    ? 'px-4 py-1.5 rounded-lg bg-[#3b82f6] hover:bg-[#2f6fe0] text-white text-[13px] font-medium transition-colors'
    : 'px-4 py-1.5 rounded-lg bg-[#1a1d27] border border-[#262a36] hover:border-[#3b82f6]/50 text-[13px] transition-colors';
  b.textContent = label;
  b.onclick = fn;
  return b;
}

function showShortcuts() {
  const rows = [
    ['j / ↓', 'Session tiếp theo'],
    ['k / ↑', 'Session trước'],
    ['Enter', 'Mở chat session đang chọn'],
    ['/', 'Mở command palette (drawer)'],
    ['⌘K', 'Toggle command palette'],
    ['⌘N', 'Focus task input (giao task mới)'],
    ['⌘1-4', 'Switch tab: Claude / Hermes / Agy-proxy / Stats'],
    ['n', 'Focus task input'],
    ['↑ / ↓', 'Lịch sử lệnh trong input (task/chat/hermes)'],
    ['Esc', 'Đóng modal / palette / quay lại'],
    ['g h', 'Sang tab Hermes'],
    ['g c', 'Sang tab Claude CLI'],
    ['g a', 'Sang tab Agy-proxy'],
    ['g s', 'Sang tab Stats'],
    ['?', 'Hiện bảng shortcuts này'],
  ];
  const box = document.createElement('div');
  box.className = 'flex flex-col gap-2';
  for (const [key, desc] of rows) {
    const line = document.createElement('div');
    line.className = 'flex items-center gap-3';
    const kbd = document.createElement('kbd');
    kbd.className = 'kbd kbd-sm bg-[#1a1d27] border-[#262a36] text-[#e4e4e7] min-w-[64px] justify-center';
    kbd.textContent = key;
    const d = document.createElement('span');
    d.className = 'text-[#8b8fa3]';
    d.textContent = desc;
    line.appendChild(kbd);
    line.appendChild(d);
    box.appendChild(line);
  }
  showOverlay('Keyboard shortcuts', box, [overlayButton('Đóng', closeOverlay, true)]);
}

/* ================= commands + palette ================= */

const MODE_PREFIX = {
  research: 'Bạn là trợ lý nghiên cứu. Tìm kiếm, trích dẫn nguồn uy tín, phân tích khách quan.\\n\\n',
  coding: 'Bạn là senior engineer. Viết code sạch, có test, tuân thủ best practice.\\n\\n',
  creative: 'Bạn là writer sáng tạo. Viết engaging, có voice riêng.\\n\\n',
};

const TASK_COMMANDS = {
  'init': 'Khởi tạo tài liệu dự án (CLAUDE.md style) tóm tắt cấu trúc và quy ước',
  'review': 'Review code changes trên branch hiện tại, tìm bug và đề xuất fix',
  'simplify': 'Review code vừa đổi, đơn giản hóa và tái sử dụng, áp dụng fix',
  'security-review': 'Security review các thay đổi pending, liệt kê rủi ro',
  'run': 'Chạy app của project để verify change hoạt động',
  'dataviz': 'Thiết kế data visualization phù hợp cho dữ liệu này',
};

// Alias hợp lệ của claude CLI --model (nhận cả full ID như claude-opus-5)
const MODELS = ['opus', 'sonnet', 'haiku'];

// Danh sách lệnh cho palette drawer: tag claude (15 lệnh, thực thi tại đây)
// / hermes (6 lệnh, gửi qua Hermes CLI). icon = tên Lucide.
const COMMANDS = [
  { cmd: '/help', icon: 'circle-help', desc: 'Liệt kê tất cả lệnh', tag: 'claude', noargs: true },
  { cmd: '/model', icon: 'cpu', desc: 'Set model: ' + MODELS.join(', ') + ' | default', tag: 'claude' },
  { cmd: '/clear', icon: 'eraser', desc: 'Xóa chat view local (không xóa session thật)', tag: 'claude', noargs: true },
  { cmd: '/init', icon: 'file-plus-2', desc: 'Task: khởi tạo tài liệu dự án CLAUDE.md', tag: 'claude', noargs: true },
  { cmd: '/review', icon: 'git-pull-request', desc: 'Task: review code branch hiện tại', tag: 'claude', noargs: true },
  { cmd: '/simplify', icon: 'wand-sparkles', desc: 'Task: đơn giản hóa code vừa đổi', tag: 'claude', noargs: true },
  { cmd: '/security-review', icon: 'shield-check', desc: 'Task: security review thay đổi pending', tag: 'claude', noargs: true },
  { cmd: '/run', icon: 'play', desc: 'Task: chạy app verify change', tag: 'claude', noargs: true },
  { cmd: '/dataviz', icon: 'chart-column', desc: 'Task: thiết kế data visualization', tag: 'claude', noargs: true },
  { cmd: '/loop', icon: 'repeat', desc: '/loop 5m <prompt> — chạy lặp mỗi interval', tag: 'claude' },
  { cmd: '/schedule', icon: 'calendar-clock', desc: '/schedule */15 * * * * <prompt> — cron job', tag: 'claude' },
  { cmd: '/jobs', icon: 'list-checks', desc: 'Xem loop/cron jobs đang chạy', tag: 'claude', noargs: true },
  { cmd: '/summary', icon: 'file-text', desc: 'Tóm tắt session đang mở', tag: 'claude', noargs: true },
  { cmd: '/export', icon: 'download', desc: 'Export session: tải .md/.json hoặc copy clipboard', tag: 'claude', noargs: true },
  { cmd: '/theme', icon: 'sun-moon', desc: 'Toggle giao diện sáng/tối', tag: 'claude', noargs: true },
  { cmd: '/memory', icon: 'brain', desc: 'Hermes: quản lý memory', tag: 'hermes' },
  { cmd: '/todo', icon: 'list-todo', desc: 'Hermes: xem/thêm todo', tag: 'hermes' },
  { cmd: '/skill', icon: 'zap', desc: 'Hermes: chạy skill', tag: 'hermes' },
  { cmd: '/cron', icon: 'timer', desc: 'Hermes: quản lý cron agent', tag: 'hermes' },
  { cmd: '/search', icon: 'search', desc: 'Hermes: tìm kiếm', tag: 'hermes' },
  { cmd: '/plan', icon: 'map', desc: 'Hermes: lập plan', tag: 'hermes' },
];
const HERMES_CMDS = new Set(COMMANDS.filter(c => c.tag === 'hermes').map(c => c.cmd.slice(1)));

/* ---- command palette DRAWER: build cards 1 LẦN, filter chỉ ẩn/hiện (không rebuild) ---- */
let palIdx = 0;
let palCards = [];   // [{el, c}] toàn bộ card theo thứ tự
let palGroups = [];  // [{titleEl, cards}] để ẩn title khi cả nhóm bị filter hết
const palfilter = document.getElementById('palfilter');

function buildPalette() {
  const body = document.getElementById('palbody');
  const groups = [
    { tag: 'claude', label: 'CLAUDE CLI', icon: 'terminal' },
    { tag: 'hermes', label: 'HERMES', icon: 'bot' },
  ];
  for (const g of groups) {
    const title = document.createElement('div');
    title.className = 'palgrouptitle';
    title.innerHTML = '<i data-lucide="' + g.icon + '" class="w-3.5 h-3.5"></i><span></span>';
    title.querySelector('span').textContent = g.label + ' (' + COMMANDS.filter(c => c.tag === g.tag).length + ')';
    body.appendChild(title);
    const grid = document.createElement('div');
    grid.className = 'palgrid';
    body.appendChild(grid);
    const groupCards = [];
    COMMANDS.filter(c => c.tag === g.tag).forEach(c => {
      const card = document.createElement('div');
      card.className = 'palcard' + (c.tag === 'hermes' ? ' hm' : '');
      card.innerHTML =
        '<div class="pic"><i data-lucide="' + c.icon + '" class="w-4 h-4"></i></div>' +
        '<div class="min-w-0"><div class="pname"></div><div class="pdesc"></div></div>';
      card.querySelector('.pname').textContent = c.cmd;
      card.querySelector('.pdesc').textContent = c.desc;
      card.onclick = () => pickPaletteCard(c);
      grid.appendChild(card);
      palCards.push({ el: card, c });
      groupCards.push(card);
    });
    palGroups.push({ titleEl: title, gridEl: grid, cards: groupCards });
  }
  if (window.lucide) lucide.createIcons({ attrs: {} }); // render icon 1 lần sau khi build
}

function paletteOpen() { return document.getElementById('drawerwrap').classList.contains('open'); }

function openPalette(filter) {
  document.getElementById('drawerwrap').classList.add('open'); // CSS transition translateY 200ms
  palfilter.value = filter || '';
  applyPalFilter();
  palfilter.focus();
}
function closePalette() {
  document.getElementById('drawerwrap').classList.remove('open');
  palfilter.blur();
  palIdx = 0;
}

// Filter: khớp tên lệnh hoặc mô tả; ẩn title nhóm khi nhóm rỗng
function applyPalFilter() {
  const q = palfilter.value.trim().toLowerCase().replace(/^\\//, '');
  for (const { el, c } of palCards) {
    const hit = !q || c.cmd.slice(1).includes(q) || c.desc.toLowerCase().includes(q);
    el.classList.toggle('hidden', !hit);
  }
  for (const g of palGroups) {
    const any = g.cards.some(el => !el.classList.contains('hidden'));
    g.titleEl.classList.toggle('hidden', !any);
    g.gridEl.classList.toggle('hidden', !any);
  }
  palIdx = 0;
  highlightPal();
}
function visiblePalCards() { return palCards.filter(p => !p.el.classList.contains('hidden')); }
function highlightPal() {
  const vis = visiblePalCards();
  palCards.forEach(p => p.el.classList.remove('active'));
  if (vis[palIdx]) {
    vis[palIdx].el.classList.add('active');
    vis[palIdx].el.scrollIntoView({ block: 'nearest' });
  }
}
function movePalette(d) {
  const vis = visiblePalCards();
  if (!vis.length) return;
  palIdx = (palIdx + d + vis.length) % vis.length;
  highlightPal();
}
function pickPaletteCard(c) {
  closePalette();
  const inp = document.getElementById('taskinput');
  if (c.noargs) { routeSlash(c.cmd); }                  // lệnh không cần args: chạy luôn
  else if (c.tag === 'hermes') {                        // lệnh hermes: điền vào input hermes
    switchTab('hermes');
    const hi = document.getElementById('hermes-input');
    if (hi) { hi.value = c.cmd + ' '; hi.focus(); }
  } else { switchTab('cli'); inp.value = c.cmd + ' '; inp.focus(); } // cần args: điền sẵn
}

palfilter.addEventListener('input', applyPalFilter);
palfilter.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); return movePalette(1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); return movePalette(-1); }
  if (e.key === 'Enter') {
    e.preventDefault();
    const vis = visiblePalCards();
    if (vis[palIdx]) pickPaletteCard(vis[palIdx].c);
    return;
  }
  if (e.key === 'Escape') { e.stopPropagation(); closePalette(); }
});
document.getElementById('palbtn').addEventListener('click', () => openPalette(''));
buildPalette();

/* ================= command history: ↑/↓ trong input (localStorage, cap 50/input) ================= */
function histLoad(key) {
  try {
    const a = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
function histPush(key, v) {
  const a = histLoad(key);
  if (a[a.length - 1] === v) return; // không lưu trùng liên tiếp
  a.push(v);
  try { localStorage.setItem(key, JSON.stringify(a.slice(-50))); } catch {} // quota đầy -> bỏ qua
}
// ↑ lấy lệnh cũ dần, ↓ quay về mới dần rồi trả lại draft đang gõ dở
function attachHistory(input, key) {
  let idx = -1, draft = ''; // idx -1 = không ở chế độ history
  input.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const a = histLoad(key);
    if (!a.length) return;
    e.preventDefault();
    if (e.key === 'ArrowUp') {
      if (idx === -1) { draft = input.value; idx = a.length - 1; }
      else if (idx > 0) idx--;
      input.value = a[idx];
    } else {
      if (idx === -1) return;
      idx++;
      if (idx >= a.length) { idx = -1; input.value = draft; }
      else input.value = a[idx];
    }
  });
  input.addEventListener('input', () => { idx = -1; }); // user gõ tay -> thoát chế độ history
}

const taskinput = document.getElementById('taskinput');
// Gõ "/" ở đầu input -> mở drawer palette thay vì dropdown
taskinput.addEventListener('input', () => {
  if (taskinput.value === '/') { taskinput.value = ''; openPalette(''); }
});
taskinput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) submitTask(); // isComposing: không submit giữa chừng gõ IME tiếng Việt
});

function submitTask() {
  const v = taskinput.value.trim();
  if (!v) return;
  histPush('hist:task', v);
  taskinput.value = '';
  closePalette();
  if (v[0] === '/') return routeSlash(v);
  spawnTask((MODE_PREFIX[currentMode] || '') + v);
}
document.getElementById('sendbtn').addEventListener('click', submitTask);

/* ---- segmented mode control ---- */
document.querySelectorAll('#modeseg .segbtn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentMode = btn.dataset.mode;
    document.querySelectorAll('#modeseg .segbtn').forEach(b => b.classList.toggle('active', b === btn));
  });
});

/* ---- thực thi lệnh slash ---- */
function routeSlash(raw) {
  const cmd = raw.slice(1).split(/\\s+/)[0].toLowerCase();
  const rest = raw.slice(1 + cmd.length).trim();
  if (cmd === 'help') return showHelp();
  if (cmd === 'theme') return toggleTheme();
  if (cmd === 'clear') return clearChatLocal();
  if (cmd === 'model') return setModel(rest);
  if (cmd === 'export') return exportCurrent();
  if (cmd === 'summary') return summarize();
  if (cmd === 'loop') return startLoop(rest);
  if (cmd === 'schedule') return startSchedule(rest);
  if (cmd === 'jobs') return showJobs();
  if (TASK_COMMANDS[cmd]) return spawnTask(TASK_COMMANDS[cmd]);
  if (HERMES_CMDS.has(cmd)) return hermesSend(raw); // lệnh Hermes -> gọi Hermes CLI
  toast('Lệnh không tồn tại: /' + cmd + ' — gõ /help');
}

// /jobs: overlay liệt kê loop/cron jobs đang chạy
function showJobs() {
  const box = document.createElement('div');
  box.className = 'flex flex-col gap-1.5';
  if (!allJobs.length) box.textContent = 'Không có job nào đang chạy. Tạo bằng /loop hoặc /schedule.';
  for (const j of allJobs) {
    const line = document.createElement('div');
    line.className = 'flex items-baseline gap-2';
    line.innerHTML = '<span class="palcmd"></span><span class="paldesc"></span>';
    line.querySelector('.palcmd').textContent = '[' + j.kind + ' ' + j.spec + ']';
    line.querySelector('.paldesc').textContent = j.prompt + ' — runs: ' + j.runs;
    box.appendChild(line);
  }
  showOverlay('Jobs (' + allJobs.length + ')', box, [overlayButton('Đóng', closeOverlay, true)]);
}

function showHelp() {
  const box = document.createElement('div');
  box.className = 'flex flex-col gap-1.5';
  for (const c of COMMANDS) {
    const line = document.createElement('div');
    line.className = 'flex items-baseline gap-2';
    line.innerHTML = '<span class="palcmd"></span><span class="paldesc"></span>'
      + '<span class="paltag paltag-' + c.tag + '">' + c.tag + '</span>';
    line.querySelector('.palcmd').textContent = c.cmd;
    line.querySelector('.paldesc').textContent = c.desc;
    box.appendChild(line);
  }
  showOverlay('Slash commands', box, [overlayButton('Đóng', closeOverlay, true)]);
}

// /theme: light mode chỉ đổi nền — giữ tối giản (mặc định dark chuẩn)
function toggleTheme() {
  const light = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', light);
  toast('Theme: ' + light + ' (UI này tối ưu cho dark)');
}

const clearOffsets = {};
function clearChatLocal() {
  if (!currentSid) return toast('Mở 1 session trước rồi mới /clear');
  clearOffsets[currentSid] = chatTotal;
  chatRendered = 0;
  chatStart = -1;      // window bắt đầu lại từ vị trí mới, đừng so với start cũ
  chatCards.clear();   // card vừa bị xoá khỏi DOM -> bỏ khỏi Map reconcile
  chatLastN = 0;
  lastDayKey = '';
  document.getElementById('bubbles').innerHTML = '';
  toast('Đã clear chat view (local)');
}

async function setModel(name) {
  if (!name) return toast('Gõ /model <tên>: ' + MODELS.join(', ') + ' (hoặc /model default)');
  const model = name === 'default' ? '' : name;
  const r = await fetch('/api/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  }).then(r => r.json());
  toast('Model = ' + (r.model || 'default'));
}

// Markdown 1 message — cùng shape với mdForMessage() ở server để 2 kiểu export giống nhau
const TOOL_ST_TXT = { ok: 'OK', error: 'ERROR', running: 'RUNNING', pending: 'PENDING' };
function mdParts(msg) {
  const NL = String.fromCharCode(10);
  const F = String.fromCharCode(96, 96, 96);
  const TICK = String.fromCharCode(96);
  if (!msg.parts || !msg.parts.length) return msg.content || '';
  return msg.parts.map(p => {
    if (p.t === 'text') return p.text;
    let s = '> 🔧 **' + (p.disp || p.name) + '**'
      + (p.summary ? ' — ' + TICK + p.summary + TICK : '')
      + ' — ' + (TOOL_ST_TXT[p.status] || p.status);
    if (p.input) s += NL + NL + F + 'input' + NL + p.input + NL + F;
    if (p.result) s += NL + NL + F + 'result' + NL + p.result + NL + F;
    if (p.images && p.images.length) s += NL + NL + '_[' + p.images.length + ' ảnh]_';
    return s;
  }).filter(Boolean).join(NL + NL);
}

async function exportChat() {
  if (!currentSid) return toast('Mở 1 session trước rồi mới /export');
  const r = await fetch('/api/history/' + currentSid).then(r => r.json());
  const NL = String.fromCharCode(10);
  let md = '# Session ' + currentSid + NL + NL;
  for (const msg of r.messages) {
    md += '**' + (msg.role === 'user' ? 'User' : 'Assistant') + '**:' + NL + NL
      + mdParts(msg) + NL + NL + '---' + NL + NL;
  }
  navigator.clipboard.writeText(md)
    .then(() => toast('Đã copy ' + r.messages.length + ' messages (markdown)'))
    .catch(() => toast('Copy thất bại (cần https hoặc localhost)'));
}

function pollOneshot(id, cb, cbErr) {
  busy(true);
  let settled = false; // 2 fetch in-flight cùng resolve -> callback chỉ chạy 1 lần
  const t = setInterval(async () => {
    const r = await fetch('/api/oneshot/' + id).then(r => r.json()).catch(() => null);
    if (settled || !r || r.status === 'running') return;
    settled = true;
    clearInterval(t);
    busy(false);
    if (r.status === 'done') cb(r.output.trim());
    else (cbErr || toast)('Oneshot lỗi: ' + (r.output || '').slice(-200));
  }, 1500);
}

async function summarize() {
  if (!currentSid) return toast('Mở 1 session trước rồi mới /summary');
  const r = await fetch('/api/summary/' + currentSid, { method: 'POST' }).then(r => r.json());
  if (!r.ok) return toast('Lỗi: ' + (r.error || '?'));
  const wait = document.createElement('div');
  wait.textContent = 'Claude đang tóm tắt session...';
  showOverlay('Summary', wait, [overlayButton('Đóng', closeOverlay)]);
  pollOneshot(r.id, out => {
    const box = document.createElement('div');
    box.textContent = out;
    showOverlay('Summary · ' + currentSid.slice(0, 8), box, [
      overlayButton('Copy', () => navigator.clipboard.writeText(out).then(() => toast('Đã copy'))),
      overlayButton('Đóng', closeOverlay, true),
    ]);
  }, err => { closeOverlay(); toast(err); });
}

async function startLoop(rest) {
  const sp = rest.split(/\\s+/);
  const interval = sp.shift();
  const prompt = sp.join(' ');
  if (!interval || !prompt) return toast('Cú pháp: /loop 5m <prompt>');
  const r = await fetch('/api/loop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interval, prompt }),
  }).then(r => r.json());
  toast(r.ok ? 'Loop #' + r.id + ' chạy mỗi ' + interval : 'Lỗi: ' + r.error);
}

async function startSchedule(rest) {
  const sp = rest.split(/\\s+/);
  if (sp.length < 6) return toast('Cú pháp: /schedule */15 * * * * <prompt>');
  const cron = sp.slice(0, 5).join(' ');
  const prompt = sp.slice(5).join(' ');
  const r = await fetch('/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cron, prompt }),
  }).then(r => r.json());
  toast(r.ok ? 'Cron #' + r.id + ' [' + cron + ']' : 'Lỗi: ' + r.error);
}

async function spawnTask(prompt) {
  busy(true);
  const r = await fetch('/api/task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: prompt }),
  }).then(r => r.json()).catch(e => ({ error: e.message })).finally(() => busy(false));
  if (r.sid) { toast('Đã giao task → ' + r.sid.slice(0, 8)); openChat(r.sid); }
  else toast('Lỗi giao task: ' + (r.error || '?'));
}

/* ---- enhance prompt ---- */
document.getElementById('enhancebtn').addEventListener('click', async () => {
  const text = taskinput.value.trim();
  if (!text) return toast('Gõ prompt thô vào input trước rồi bấm enhance');
  const r = await fetch('/api/enhance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(r => r.json());
  if (!r.ok) return toast('Lỗi: ' + (r.error || '?'));
  const wait = document.createElement('div');
  wait.textContent = 'Claude đang viết lại prompt...';
  showOverlay('Enhance prompt', wait, [overlayButton('Hủy', closeOverlay)]);
  pollOneshot(r.id, out => {
    const box = document.createElement('div');
    box.textContent = out;
    showOverlay('Enhance preview', box, [
      overlayButton('Hủy', closeOverlay),
      overlayButton('Dùng prompt này', () => { taskinput.value = out; closeOverlay(); taskinput.focus(); }, true),
    ]);
  }, err => { closeOverlay(); toast(err); });
});

/* ================= chat view: STABLE RENDER (append-only) ================= */
let chatRendered = 0; // số bubble đã render cho session đang mở
let chatTotal = 0;    // tổng messages trong history lần fetch cuối
let chatStart = -1;   // chỉ số tuyệt đối của bubble đầu tiên đang render (-1 = chưa render gì)
let chatCards = new Map(); // tool_use_id -> {card, chip, status} để cập nhật chip khi tool xong
let chatLastN = 0;    // số message đã gộp vào lượt CUỐI (lượt đang chạy còn phình thêm)
let reopenTids = [];  // card đang mở, cần mở lại sau khi buộc phải vẽ lại

// Parse markdown an toàn: marked (render) + DOMPurify (sanitize chống XSS).
// Fallback textContent nếu CDN chưa load — không bao giờ vỡ render.
function mdToNode(text) {
  var div = document.createElement('div');
  div.className = 'md';
  if (window.marked && window.DOMPurify) {
    var html = marked.parse(text, { breaks: true, gfm: true });
    div.innerHTML = DOMPurify.sanitize(html);
    // link mở tab mới, không leak opener
    div.querySelectorAll('a').forEach(function (a) { a.target = '_blank'; a.rel = 'noopener'; });
  } else {
    div.textContent = text; // CDN offline -> hiện raw, vẫn an toàn
  }
  return div;
}

// Render nội dung message: tách code block (triple-backtick) trước — giữ nút Copy,
// phần text còn lại parse markdown. Dùng chung cho chat Claude CLI + Hermes.
function renderContent(el, content) {
  var FENCE = String.fromCharCode(96, 96, 96);
  var NL = String.fromCharCode(10);
  var parts = content.split(FENCE);
  for (var i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // text thường -> markdown (heading/bold/list/inline-code/link/blockquote...)
      if (parts[i].trim()) el.appendChild(mdToNode(parts[i]));
      continue;
    }
    var seg = parts[i];
    var j = seg.indexOf(NL);
    var lang = '', code = seg;
    if (j >= 0 && j <= 20) { lang = seg.slice(0, j).trim(); code = seg.slice(j + 1); }
    var wrap = document.createElement('div');
    wrap.className = 'codewrap';
    if (lang) {
      var lg = document.createElement('div');
      lg.className = 'codelang';
      lg.textContent = lang;
      wrap.appendChild(lg);
    }
    var btn = document.createElement('button');
    btn.className = 'copybtn';
    btn.innerHTML = ICON_COPY + '<span>Copy</span>';
    (function (c, b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        navigator.clipboard.writeText(c).then(function () {
          b.querySelector('span').textContent = 'Copied!';
          setTimeout(function () { b.querySelector('span').textContent = 'Copy'; }, 1200);
        });
      };
    })(code, btn);
    var pre = document.createElement('pre');
    pre.className = 'codeblock';
    pre.textContent = code;
    wrap.appendChild(btn);
    wrap.appendChild(pre);
    el.appendChild(wrap);
  }
}

/* ---------------- tool card ----------------
   SVG inline (không dùng data-lucide): node động không được gọi lại lucide.createIcons() */
const SVG_A = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const TICON = {
  Bash: SVG_A + '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>',
  Read: SVG_A + '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
  Edit: SVG_A + '<path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/><path d="M14 2v5h5"/><path d="M10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4Z"/></svg>',
  Write: SVG_A + '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M9 15h6"/><path d="M12 12v6"/></svg>',
  Grep: SVG_A + '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  Task: SVG_A + '<rect width="18" height="10" x="3" y="11" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" x2="8" y1="16" y2="16"/><line x1="16" x2="16" y1="16" y2="16"/></svg>',
  TodoWrite: SVG_A + '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>',
  Web: SVG_A + '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
  Skill: SVG_A + '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>',
  mcp: SVG_A + '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>',
  def: SVG_A + '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg>',
};
const ICON_CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_OK = SVG_A + '<path d="M20 6 9 17l-5-5"/></svg>';
const ICON_ERR = SVG_A + '<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const ICON_RUN = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>';
const ICON_DASH = SVG_A + '<path d="M5 12h14"/></svg>';

function toolIcon(name) {
  const n = String(name || '');
  if (n.startsWith('mcp__')) return TICON.mcp;
  if (TICON[n]) return TICON[n];
  if (n === 'MultiEdit' || n === 'NotebookEdit') return TICON.Edit;
  if (n === 'Glob' || n === 'ToolSearch') return TICON.Grep;
  if (n === 'Agent') return TICON.Task;
  if (n === 'WebFetch' || n === 'WebSearch') return TICON.Web;
  if (n === 'BashOutput' || n === 'KillShell') return TICON.Bash;
  return TICON.def;
}

function statusIcon(st) {
  if (st === 'ok') return { html: ICON_OK, cls: 'tcard-st-ok', tip: 'Thành công' };
  if (st === 'error') return { html: ICON_ERR, cls: 'tcard-st-err', tip: 'Lỗi' };
  if (st === 'running') return { html: ICON_RUN, cls: 'tcard-st-run', tip: 'Đang chạy…' };
  // pending: session đã dừng mà tool chưa có kết quả (bị kill / ngắt giữa chừng)
  return { html: ICON_DASH, cls: 'tcard-st-pend', tip: 'Không có kết quả (bị ngắt)' };
}

// Ngôn ngữ theo đuôi file -> nhãn code block ("ts", "py"...) cho dễ nhận ra
const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', html: 'html', css: 'css',
  scss: 'scss', sql: 'sql', md: 'markdown', txt: '', log: '',
};
function langOf(p) {
  const f = String((p && p.summary) || '').split(' ')[0].split(':')[0];
  const ext = f.indexOf('.') > 0 ? f.split('.').pop().toLowerCase() : '';
  return EXT_LANG[ext] || '';
}

// Text dài mà không phải code -> có xuống dòng mềm, dễ đọc hơn <pre> cuộn ngang
function looksLikeProse(t) {
  if (!t) return false;
  // dùng fromCharCode(10): backslash-n trong template literal của server bị nuốt thành xuống dòng thật
  const lines = t.split(String.fromCharCode(10));
  if (lines.length > 12) return false;                       // log/list -> giữ pre
  const longLines = lines.filter(l => l.length > 90).length; // câu văn dài -> nên wrap
  const head = lines[0] || '';
  const isStructured = /^[{[<]/.test(head.trim()); // JSON/XML -> giữ dạng code
  return longLines > 0 && !isStructured && t.indexOf('  ') < 0;
}

function copyBtnFor(text) {
  const btn = document.createElement('button');
  btn.className = 'copybtn';
  btn.innerHTML = ICON_COPY + '<span>Copy</span>';
  btn.onclick = function (ev) {
    ev.stopPropagation(); // đừng để click Copy làm gập card
    navigator.clipboard.writeText(text).then(function () {
      btn.querySelector('span').textContent = 'Copied!';
      setTimeout(function () { btn.querySelector('span').textContent = 'Copy'; }, 1200);
    });
  };
  return btn;
}

// Diff của Edit: tô xanh dòng thêm / đỏ dòng bớt thay vì một khối chữ xám phẳng
function renderDiff(text) {
  const pre = document.createElement('pre');
  pre.className = 'codeblock diffblock';
  let mode = '';
  for (const line of text.split(String.fromCharCode(10))) {
    if (line === '--- old') { mode = 'del'; appendDiffHead(pre, 'Trước', 'del'); continue; }
    if (line === '+++ new') { mode = 'add'; appendDiffHead(pre, 'Sau', 'add'); continue; }
    const row = document.createElement('div');
    row.className = 'dline' + (mode ? ' d-' + mode : '');
    row.textContent = line;
    pre.appendChild(row);
  }
  return pre;
}
function appendDiffHead(pre, label, cls) {
  const h = document.createElement('div');
  h.className = 'dhead d-' + cls;
  h.textContent = label;
  pre.appendChild(h);
}

// 1 section (Input / Result) trong body card
function toolSection(label, text, isErr, opts) {
  opts = opts || {};
  const sec = document.createElement('div');
  sec.className = 'tsec' + (isErr ? ' tsec-err' : '');
  const lb = document.createElement('div');
  lb.className = 'tlbl';
  lb.textContent = label;
  if (opts.lang) {
    const tag = document.createElement('span');
    tag.className = 'tlang';
    tag.textContent = opts.lang;
    lb.appendChild(tag);
  }
  sec.appendChild(lb);
  const wrap = document.createElement('div');
  wrap.className = 'codewrap';
  wrap.appendChild(copyBtnFor(text));
  if (opts.diff) {
    wrap.appendChild(renderDiff(text));
  } else if (opts.prose) {
    // văn bản thường (câu chữ) -> markdown + wrap, không phải khối code cuộn ngang
    const box = document.createElement('div');
    box.className = 'codeblock proseblock';
    box.appendChild(mdToNode(text));
    wrap.appendChild(box);
  } else {
    const pre = document.createElement('pre');
    pre.className = 'codeblock';
    pre.textContent = text;
    wrap.appendChild(pre);
  }
  sec.appendChild(wrap);
  return sec;
}

// Ảnh trong tool_result (screenshot...) -> render <img> THẬT, lazy, tap để phóng to
function toolImages(part) {
  const sec = document.createElement('div');
  sec.className = 'tsec';
  const lb = document.createElement('div');
  lb.className = 'tlbl';
  lb.textContent = part.images.length > 1 ? part.images.length + ' ẢNH' : 'ẢNH';
  sec.appendChild(lb);
  const grid = document.createElement('div');
  grid.className = 'timgs';
  part.images.forEach(function (im, idx) {
    const url = '/api/toolimg/' + currentSid + '/' + part.id + '/' + idx;
    const fig = document.createElement('button');
    fig.type = 'button';
    fig.className = 'timgbtn';
    fig.title = 'Bấm để xem full';
    const img = document.createElement('img');
    img.loading = 'lazy';            // chỉ tải khi cuộn tới — ảnh ~100KB/tấm
    img.decoding = 'async';
    img.src = url;
    img.alt = 'ảnh kết quả ' + (idx + 1);
    img.onerror = function () { fig.classList.add('timg-fail'); fig.textContent = 'Không tải được ảnh'; };
    fig.appendChild(img);
    fig.onclick = function (ev) { ev.stopPropagation(); openImageOverlay(url); };
    grid.appendChild(fig);
  });
  sec.appendChild(grid);
  return sec;
}

// Xem ảnh full màn hình: tap nền / Esc để đóng
function openImageOverlay(url) {
  const ov = document.createElement('div');
  ov.className = 'imgov fadein';
  const img = document.createElement('img');
  img.src = url;
  ov.appendChild(img);
  const close = function () { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  ov.onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// Dựng nội dung body — LAZY, chỉ chạy lần mở đầu tiên (30 msg x N tool mà dựng sẵn hết thì phí)
function buildToolBody(card) {
  const inner = card.querySelector('.tinner');
  inner.innerHTML = '';
  const p = card._part;
  const isDiff = p.name === 'Edit' && p.input && p.input.indexOf('--- old') === 0;
  if (p.input) {
    inner.appendChild(toolSection(isDiff ? 'THAY ĐỔI' : 'INPUT', p.input, false, {
      diff: isDiff,
      lang: isDiff ? '' : langOf(p),
    }));
  }
  const isErr = p.status === 'error';
  const hasResult = p.result || p.status === 'ok' || isErr;
  if (hasResult) {
    const txt = p.result || '(trống)';
    const sec = toolSection(isErr ? 'LỖI' : 'KẾT QUẢ', txt, isErr, {
      prose: !isErr && looksLikeProse(txt),
      lang: p.name === 'Read' ? langOf(p) : '',
    });
    sec.dataset.role = 'result';
    inner.appendChild(sec);
  }
  if (p.images && p.images.length) inner.appendChild(toolImages(p));
  card._built = true;
}

function renderToolCard(part) {
  const card = document.createElement('div');
  card._part = part;
  card.className = 'tcard fadein' + (part.status === 'error' ? ' t-err' : part.status === 'running' ? ' t-run' : '');
  if (part.id) card.dataset.tid = part.id;

  const head = document.createElement('button');
  head.className = 'tcard-head';
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');

  const ic = document.createElement('span');
  ic.className = 'tcard-ic';
  ic.innerHTML = toolIcon(part.name);
  const nm = document.createElement('span');
  nm.className = 'tcard-name';
  nm.textContent = part.disp || part.name;
  const sum = document.createElement('span');
  sum.className = 'tcard-sum';
  sum.textContent = part.summary || '';
  // summary bị ellipsis trên mobile -> giữ bản đầy đủ ở title (hover desktop / long-press)
  if (part.summary) sum.title = part.summary;
  nm.title = part.name; // tên MCP rút gọn -> title giữ tên gốc đầy đủ
  const si = statusIcon(part.status);
  const st = document.createElement('span');
  st.className = 'tcard-st ' + si.cls;
  st.innerHTML = si.html;
  st.title = si.tip;
  const chev = document.createElement('span');
  chev.className = 'tcard-chev';
  chev.innerHTML = ICON_CHEV;
  head.appendChild(ic); head.appendChild(nm); head.appendChild(sum); head.appendChild(st); head.appendChild(chev);

  const body = document.createElement('div');
  body.className = 'tcard-body';
  const inner = document.createElement('div');
  inner.className = 'tinner';
  body.appendChild(inner);

  head.onclick = function () {
    const opening = !card.classList.contains('open');
    if (opening && !card._built) buildToolBody(card);
    card.classList.toggle('open', opening);
    head.setAttribute('aria-expanded', opening ? 'true' : 'false');
  };

  card.appendChild(head);
  card.appendChild(body);
  // đăng ký để reconcileToolStatus cập nhật chip khi tool chạy xong (pending/running -> ok/error).
  // Compare view cũng dùng bubbleFor nhưng không reconcile -> không đăng ký, tránh Map phình.
  if (part.id && !compareSids) chatCards.set(part.id, { card: card, chip: st, status: part.status });
  return card;
}

/* ---- thời gian kiểu app chat: giờ dưới bubble + vạch ngăn ngày ---- */
function fmtClock(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function dayKey(ts) {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function fmtDay(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const today = new Date();
  const y = new Date(today.getTime() - 86400000);
  if (dayKey(d) === dayKey(today)) return 'Hôm nay';
  if (dayKey(d) === dayKey(y)) return 'Hôm qua';
  return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
}
function dayDivider(ts) {
  const div = document.createElement('div');
  div.className = 'daydiv';
  const s = document.createElement('span');
  s.textContent = fmtDay(ts);
  div.appendChild(s);
  return div;
}
// giờ + trạng thái, đặt dưới bubble như Telegram/iMessage
function metaLine(msg, align) {
  const meta = document.createElement('div');
  meta.className = 'bmeta' + (align === 'right' ? ' bmeta-r' : '');
  const t = document.createElement('span');
  t.textContent = fmtClock(msg.ts);
  meta.appendChild(t);
  if (msg.parts) {
    const tools = msg.parts.filter(p => p.t === 'tool');
    if (tools.length) {
      const nErr = tools.filter(p => p.status === 'error').length;
      const nRun = tools.filter(p => p.status === 'running').length;
      const s = document.createElement('span');
      s.className = 'bmeta-tools' + (nErr ? ' bmeta-err' : nRun ? ' bmeta-run' : '');
      s.textContent = nRun ? tools.length + ' tool · đang chạy'
        : nErr ? tools.length + ' tool · ' + nErr + ' lỗi'
        : tools.length + ' tool';
      meta.appendChild(s);
    }
  }
  return meta;
}

function bubbleFor(msg) {
  const hasTool = msg.parts && msg.parts.some(p => p.t === 'tool');
  const w = document.createElement('div');
  w.className = 'msgwrap fadein' + (msg.role === 'user' ? ' mw-user' : '');
  if (!hasTool) {
    const b = document.createElement('div');
    const cls = msg.role === 'user' ? 'bub-user' : msg.role === 'tool' ? 'bub-tool' : 'bub-assistant';
    b.className = 'bub ' + cls;
    renderContent(b, msg.content);
    w.appendChild(b);
  } else {
    // message có tool: text bubble + card xếp dọc trong 1 wrapper
    for (const p of mergeTextParts(msg.parts)) {
      if (p.t === 'text') {
        if (!p.text || !p.text.trim()) continue;
        const b = document.createElement('div');
        b.className = 'bub ' + (msg.role === 'user' ? 'bub-user' : 'bub-assistant');
        renderContent(b, p.text);
        w.appendChild(b);
      } else {
        w.appendChild(renderToolCard(p));
      }
    }
  }
  if (msg.ts) w.appendChild(metaLine(msg, msg.role === 'user' ? 'right' : 'left'));
  return w;
}

// Gộp các message assistant LIÊN TIẾP trong cùng ~2 phút thành 1 lượt.
// Claude CLI tách mỗi tool_use thành 1 message riêng -> không gộp thì câu văn và tool
// của cùng một lượt bị xé rời, kèm theo hàng loạt dòng "15:18 · 1 tool" lặp lại rất rối.
const GROUP_GAP_MS = 120000;
// 2 đoạn văn liền nhau (không có tool xen giữa) -> 1 bubble liền mạch, không phải 2 bong bóng rời
function mergeTextParts(parts) {
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (p.t === 'text' && prev && prev.t === 'text') {
      const NL = String.fromCharCode(10);
      out[out.length - 1] = { t: 'text', text: prev.text + NL + NL + p.text };
    } else out.push(p);
  }
  return out;
}
function groupMessages(msgs) {
  const out = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    const near = prev && prev.ts && m.ts && Math.abs(Date.parse(m.ts) - Date.parse(prev.ts)) < GROUP_GAP_MS;
    if (prev && prev.role === 'assistant' && m.role === 'assistant' && near) {
      prev.parts = mergeTextParts(
        (prev.parts || [{ t: 'text', text: prev.content }]).concat(m.parts || [{ t: 'text', text: m.content }]));
      prev.content = (prev.content ? prev.content + String.fromCharCode(10) : '') + (m.content || '');
      prev.ts = m.ts;   // giờ hiển thị = lúc lượt kết thúc
      prev.n = (prev.n || 1) + 1;
      continue;
    }
    out.push(Object.assign({}, m));
  }
  return out;
}

// Chèn bubble + vạch ngăn ngày khi sang ngày mới (so với bubble trước đó)
let lastDayKey = '';
function appendMessage(box, msg) {
  if (msg.ts) {
    const k = dayKey(msg.ts);
    if (k && k !== lastDayKey) {
      box.appendChild(dayDivider(msg.ts));
      lastDayKey = k;
    }
  }
  box.appendChild(bubbleFor(msg));
}

// Tool chạy xong trong lúc đang xem -> chỉ đổi CHIP + border của card đó, không đụng node khác
// (RULES: diff DOM, chỉ update node thay đổi — rebuild sẽ giết card user đang mở)
function reconcileToolStatus(msgs) {
  for (let i = Math.max(0, msgs.length - 10); i < msgs.length; i++) {
    const parts = msgs[i] && msgs[i].parts;
    if (!parts) continue;
    for (const p of parts) {
      if (p.t !== 'tool' || !p.id) continue;
      const ent = chatCards.get(p.id);
      if (!ent || ent.status === p.status) continue;
      ent.status = p.status;
      ent.card._part = p;
      const si = statusIcon(p.status);
      ent.chip.className = 'tcard-st ' + si.cls;
      ent.chip.innerHTML = si.html;
      ent.chip.title = si.tip;
      ent.card.classList.toggle('t-err', p.status === 'error');
      ent.card.classList.toggle('t-run', p.status === 'running');
      // card đang mở -> dựng lại body cho khớp kết quả mới; đang đóng thì để lazy build lo
      if (ent.card._built) buildToolBody(ent.card);
    }
  }
}

function openChat(sid) {
  switchTab('cli');
  if (compareSids) closeCompare(); // đang ở compare view -> đóng trước khi mở chat
  currentSid = sid;
  chatRendered = 0;
  chatTotal = 0;
  chatStart = -1;
  chatCards = new Map();
  chatLastN = 0;
  reopenTids = [];
  lastDayKey = '';
  delete clearOffsets[sid];
  document.getElementById('list').classList.add('hidden');
  const chat = document.getElementById('chat');
  chat.classList.remove('hidden');
  chat.classList.add('flex');
  // hiện tiêu đề ngay từ danh sách (khỏi chờ fetch), refreshChat sẽ xác nhận lại
  const known = allSessions.find(x => x.sid === sid);
  chatTitle = (known && known.title) || '';
  setText(document.getElementById('chatsid'), chatTitle || sid.slice(0, 8));
  document.getElementById('chatsid').title = sid;
  document.getElementById('bubbles').innerHTML = '';
  document.getElementById('typingind').classList.add('hidden');
  document.getElementById('chaterr').classList.add('hidden');
  refreshChat();
  clearInterval(chatTimer);
  chatTimer = setInterval(refreshChat, 2000); // auto-refresh: chỉ APPEND message mới
}

function backToList() {
  currentSid = null;
  clearInterval(chatTimer);
  document.getElementById('chat').classList.add('hidden');
  document.getElementById('chat').classList.remove('flex');
  document.getElementById('list').classList.remove('hidden');
}

/* ================= session compare: chọn 2 sessions -> split view ================= */
let compareMode = false;   // đang ở chế độ chọn session để so sánh
let compareSel = [];       // sids đã chọn (tối đa 2)
let compareSids = null;    // [sidA, sidB] đang mở trong compare view
let compareTimer = null;
const cmpRendered = [0, 0]; // số bubble đã render mỗi cột (append-only, không rebuild)

function toggleCompareMode() {
  compareMode = !compareMode;
  compareSel = [];
  document.getElementById('comparebtn').classList.toggle('cmp-on', compareMode);
  markCompareRows();
  toast(compareMode ? 'Chọn 2 session để so sánh side-by-side' : 'Đã tắt chế độ so sánh');
}
function markCompareRows() {
  document.querySelectorAll('#sessrows .srow').forEach(r =>
    r.classList.toggle('cmp-sel', compareMode && compareSel.includes(r.dataset.sid)));
}
// Click row: compare mode ON -> toggle chọn, đủ 2 -> mở compare view; OFF -> mở chat thường
function rowClick(sid) {
  if (!compareMode) return openChat(sid);
  compareSel = compareSel.includes(sid) ? compareSel.filter(x => x !== sid) : compareSel.concat(sid);
  if (compareSel.length === 2) {
    const pair = compareSel;
    compareMode = false;
    compareSel = [];
    document.getElementById('comparebtn').classList.remove('cmp-on');
    openCompare(pair[0], pair[1]);
  }
  markCompareRows();
}

function openCompare(a, b) {
  compareSids = [a, b];
  cmpRendered[0] = cmpRendered[1] = 0;
  document.getElementById('list').classList.add('hidden');
  const cv = document.getElementById('compare');
  cv.classList.remove('hidden');
  cv.classList.add('flex');
  for (const i of [0, 1]) {
    setText(document.getElementById('cmp-sid-' + i), compareSids[i].slice(0, 8));
    document.getElementById('cmp-bub-' + i).innerHTML = '';
  }
  refreshCompare();
  clearInterval(compareTimer);
  compareTimer = setInterval(refreshCompare, 3000);
}
let compareBusy = false; // chống 2 refresh chồng nhau -> duplicate bubbles
async function refreshCompare() {
  if (!compareSids || compareBusy) return;
  compareBusy = true;
  for (const i of [0, 1]) {
    if (!compareSids) break; // user đóng view giữa chừng
    const sid = compareSids[i];
    const r = await fetch('/api/history/' + sid).then(x => x.json()).catch(() => null);
    if (!r || !compareSids || compareSids[i] !== sid) continue;
    const st = document.getElementById('cmp-st-' + i);
    setText(st, r.status);
    const cls = 'chip ml-auto st-' + r.status;
    if (st.className !== cls) st.className = cls;
    const box = document.getElementById('cmp-bub-' + i);
    const cg = groupMessages(r.messages); // gộp lượt như chat view cho nhất quán
    if (cg.length < cmpRendered[i]) { box.innerHTML = ''; cmpRendered[i] = 0; }
    for (let k = cmpRendered[i]; k < cg.length; k++) box.appendChild(bubbleFor(cg[k]));
    if (cmpRendered[i] !== cg.length) {
      cmpRendered[i] = cg.length;
      box.scrollTop = box.scrollHeight;
    }
  }
  compareBusy = false;
}
function closeCompare() {
  compareSids = null;
  clearInterval(compareTimer);
  const cv = document.getElementById('compare');
  cv.classList.add('hidden');
  cv.classList.remove('flex');
  document.getElementById('list').classList.remove('hidden');
}

/* ================= export: tải session ra file .md / .json ================= */
// Claude: server trả full history kèm Content-Disposition -> chỉ cần điều hướng qua <a>
function downloadURL(u) {
  const a = document.createElement('a');
  a.href = u;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
// Hermes: data nằm ở client (server msgs + local extras) -> build Blob rồi tải
function downloadBlob(name, type, text) {
  const a = document.createElement('a');
  const blobUrl = URL.createObjectURL(new Blob([text], { type }));
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}

function exportCurrent() {
  if (!currentSid) return toast('Mở 1 session trước rồi mới export');
  const sid = currentSid;
  const box = document.createElement('div');
  box.textContent = 'Tải TOÀN BỘ history của "' + (chatTitle || sid.slice(0, 8))
    + '" (không giới hạn 30 message cuối), hoặc copy 30 message cuối ra clipboard.';
  showOverlay('Export session', box, [
    overlayButton('Copy clipboard', () => { closeOverlay(); exportChat(); }),
    overlayButton('Tải .json', () => { downloadURL('/api/export/' + sid + '?fmt=json'); closeOverlay(); toast('Đang tải .json'); }),
    overlayButton('Tải .md', () => { downloadURL('/api/export/' + sid + '?fmt=md'); closeOverlay(); toast('Đang tải .md'); }, true),
  ]);
}

function hermesExport() {
  if (!hermesOpenId) return toast('Mở 1 conversation trước rồi mới export');
  const c = hermesOpenId === '__direct__'
    ? { title: 'Chat trực tiếp với Hermes', messages: [] }
    : hermesConvos.find(x => x.id === hermesOpenId);
  const msgs = (c ? c.messages : []).concat(hermesExtra[hermesOpenId] || [])
    .map(x => ({ role: x.role, content: x.content, ts: x.ts || 0 }));
  if (!msgs.length) return toast('Chưa có message nào để export');
  const id = (hermesOpenId === '__direct__' ? 'direct' : String(hermesOpenId).slice(0, 12)).replace(/[^\\w.-]/g, '_');
  const title = c ? String(c.title) : String(hermesOpenId);
  const box = document.createElement('div');
  box.textContent = 'Export ' + msgs.length + ' messages của "' + title.slice(0, 60) + '".';
  showOverlay('Export Hermes chat', box, [
    overlayButton('Tải .json', () => {
      downloadBlob('hermes-' + id + '.json', 'application/json',
        JSON.stringify({ id: hermesOpenId, title, count: msgs.length, messages: msgs }, null, 2));
      closeOverlay();
      toast('Đang tải .json');
    }),
    overlayButton('Tải .md', () => {
      const NL = String.fromCharCode(10);
      let md = '# Hermes chat: ' + title + NL + NL;
      for (const x of msgs) {
        md += '**' + (x.role === 'user' ? 'User' : x.role === 'tool' ? 'Tool' : 'Assistant') + '**:'
          + NL + NL + x.content + NL + NL + '---' + NL + NL;
      }
      downloadBlob('hermes-' + id + '.md', 'text/markdown', md);
      closeOverlay();
      toast('Đang tải .md');
    }, true),
  ]);
}

let chatBusy = false; // chống 2 refresh chồng nhau (timer + gọi tay sau send) -> duplicate bubbles
async function refreshChat() {
  if (!currentSid || chatBusy) return;
  chatBusy = true;
  const sidAtFetch = currentSid;
  const r = await fetch('/api/history/' + sidAtFetch).then(r => r.json()).catch(() => null);
  chatBusy = false;
  if (!r || currentSid !== sidAtFetch) return;
  // tiêu đề có thể đổi (Claude CLI sinh ai-title mới giữa chừng) -> cập nhật tại chỗ
  if (r.title !== undefined && r.title !== chatTitle) {
    chatTitle = r.title || '';
    setText(document.getElementById('chatsid'), chatTitle || sidAtFetch.slice(0, 8));
  }
  const st = document.getElementById('chatstatus');
  const stClass = 'chip st-' + r.status;
  if (st.className !== stClass) st.className = stClass;
  const lbl = st.querySelector('.chip-label');
  if (lbl) setText(lbl, r.status); else setText(st, r.status);

  const box = document.getElementById('bubbles');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  // clearOffsets lưu TỔNG tuyệt đối lúc /clear; server trả window 30 cuối + total
  // -> quy đổi về vị trí trong window (fix: session >30 msg /clear xong vẫn nhận message mới)
  const total = r.total != null ? r.total : r.messages.length;
  const dropped = total - r.messages.length; // số msg cũ đã trôi khỏi window 30
  const skip = Math.max(0, (clearOffsets[currentSid] || 0) - dropped);
  const msgs = r.messages.slice(skip);
  chatTotal = total;
  // start: vị trí TUYỆT ĐỐI của msgs[0]. Chỉ so length là không đủ — khi window 30 trượt
  // (msg mới đẩy msg cũ ra) length không đổi -> vòng append bên dưới không chạy lần nào
  // -> client đứng hình, im lặng bỏ lỡ mọi message mới.
  // Window trượt (msg mới đẩy msg cũ ra): messages.length KHÔNG đổi, nên chỉ so length là
  // client đứng hình, im lặng bỏ lỡ mọi msg mới. So start tuyệt đối mới phát hiện được.
  // Vì bubble được GỘP theo lượt, số bubble != số message -> vẽ lại rồi mở lại đúng card cũ,
  // đơn giản và chắc hơn là cố cắt từng node ở đầu.
  const start = (r.start != null ? r.start : dropped) + skip;
  if (chatStart === -1) chatStart = start;
  if (start !== chatStart || msgs.length < chatRendered) {
    reopenTids = [...box.querySelectorAll('.tcard.open')].map(c => c.dataset.tid).filter(Boolean);
    box.innerHTML = '';
    chatRendered = 0;
    chatLastN = 0;
    chatCards.clear();
    chatStart = start;
  }
  // Gộp lượt assistant liên tiếp -> số BUBBLE khác số message, nên append theo nhóm.
  const groups = groupMessages(msgs);
  if (chatRendered === 0) lastDayKey = '';
  // Nhóm cuối có thể "lớn thêm" khi Claude gọi tiếp tool trong cùng lượt -> vẽ lại RIÊNG nhóm đó.
  // Không đụng nhóm trước, nên card đang mở ở các lượt cũ vẫn nguyên.
  if (chatRendered > 0 && chatRendered <= groups.length) {
    const lastIdx = chatRendered - 1;
    const g = groups[lastIdx];
    if (g && (g.n || 1) !== chatLastN) {
      const node = box.querySelector('[data-gi="' + lastIdx + '"]');
      if (node) {
        const wasOpen = [...node.querySelectorAll('.tcard.open')].map(c => c.dataset.tid);
        const fresh = bubbleFor(g);
        fresh.dataset.gi = lastIdx;
        node.replaceWith(fresh);
        // giữ lại card user đang mở trong chính lượt này
        wasOpen.forEach(tid => {
          const c = fresh.querySelector('.tcard[data-tid="' + tid + '"]');
          if (c && !c.classList.contains('open')) c.querySelector('.tcard-head').click();
        });
      }
    }
  }
  for (let i = chatRendered; i < groups.length; i++) {
    const before = box.lastElementChild;
    appendMessage(box, groups[i]);
    const added = box.lastElementChild;
    if (added && added !== before) added.dataset.gi = i;
  }
  chatRendered = groups.length;
  chatLastN = groups.length ? (groups[groups.length - 1].n || 1) : 0;
  // sau khi vẽ lại vì window trượt: mở lại đúng những card user đang xem dở
  if (reopenTids.length) {
    reopenTids.forEach(tid => {
      const c = box.querySelector('.tcard[data-tid="' + tid + '"]');
      if (c && !c.classList.contains('open')) c.querySelector('.tcard-head').click();
    });
    reopenTids = [];
  }
  reconcileToolStatus(msgs); // tool xong -> đổi chip tại chỗ (không rebuild)
  // lỗi từ lần chạy claude gần nhất -> hiện banner; trước đây lỗi bị nuốt hoàn toàn
  const errBox = document.getElementById('chaterr');
  if (r.error) {
    setText(document.getElementById('chaterrmsg'), r.error);
    errBox.classList.remove('hidden');
  } else errBox.classList.add('hidden');
  document.getElementById('typingind').classList.toggle('hidden', !r.typing);
  // lỗi chạy Claude (resume trượt...) -> hiện rõ, đừng để user tưởng đã gửi được
  const ce = document.getElementById('chaterr');
  if (r.error) { setText(ce, r.error); ce.classList.remove('hidden'); }
  else ce.classList.add('hidden');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function killCurrent() {
  if (currentSid) fetch('/api/kill/' + currentSid, { method: 'POST' });
}

/* ---- quyền của Claude ----
   Dashboard chạy claude ở chế độ -p với stdio ignore nên KHÔNG có hộp thoại hỏi quyền như CLI:
   ở chế độ mặc định, Claude im lặng bỏ qua việc cần quyền rồi trả lời "bạn chưa cấp quyền"
   — nhìn như đã làm mà thật ra không làm gì. */
const PERM_UI = {
  default: { label: 'Hỏi quyền', cls: '', toast: 'Chế độ mặc định — Claude KHÔNG tự sửa được file (sẽ báo chưa có quyền)' },
  acceptEdits: { label: 'Tự sửa file', cls: 'p-accept', toast: 'Claude tự sửa/tạo file được; lệnh nguy hiểm vẫn bị chặn' },
  bypassPermissions: { label: 'Bỏ mọi kiểm tra', cls: 'p-bypass', toast: 'CẨN THẬN: bỏ qua MỌI kiểm tra quyền, kể cả lệnh nguy hiểm' },
};
const PERM_CYCLE = ['acceptEdits', 'default', 'bypassPermissions'];
let permMode = 'acceptEdits';

function renderPerm() {
  const b = document.getElementById('permbtn');
  if (!b) return;
  const ui = PERM_UI[permMode] || PERM_UI.default;
  const cls = 'permbtn ' + ui.cls;
  if (b.className.trim() !== cls.trim()) b.className = cls;
  setText(document.getElementById('permlabel'), ui.label);
  b.title = 'Quyền của Claude: ' + ui.label + ' — bấm để đổi';
}

function cyclePerm() {
  const next = PERM_CYCLE[(PERM_CYCLE.indexOf(permMode) + 1) % PERM_CYCLE.length];
  permMode = next;
  renderPerm();
  fetch('/api/perm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: next }),
  }).then(r => r.json()).then(r => {
    if (r.mode) { permMode = r.mode; renderPerm(); }
    toast(PERM_UI[permMode].toast);
  }).catch(() => toast('Không đổi được chế độ quyền'));
}

/* ---- đổi tên phiên: lưu riêng ở dashboard, KHÔNG sửa .jsonl của Claude CLI ---- */
let chatTitle = '';
function renameSession() {
  if (!currentSid) return;
  const box = document.createElement('div');
  box.className = 'flex flex-col gap-2';
  const inp = document.createElement('input');
  inp.className = 'w-full bg-[#1a1d27] border border-[#262a36] rounded-xl px-3 py-2.5 text-[16px] outline-none';
  inp.value = chatTitle || '';
  inp.placeholder = 'Tên phiên…';
  const hint = document.createElement('div');
  hint.className = 'text-[11.5px] text-[#666b7d]';
  hint.textContent = 'Để trống rồi Lưu = quay về tên Claude CLI tự đặt.';
  box.appendChild(inp);
  box.appendChild(hint);
  const save = () => {
    const sid = currentSid;
    fetch('/api/title/' + sid, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: inp.value }),
    }).then(r => r.json()).then(r => {
      if (currentSid === sid) {
        chatTitle = r.title || '';
        setText(document.getElementById('chatsid'), chatTitle || sid.slice(0, 8));
      }
      const row = document.querySelector('#sessrows .srow[data-sid="' + sid + '"] .s-sid');
      if (row) setText(row, r.title || sid.slice(0, 8));
      const s = allSessions.find(x => x.sid === sid);
      if (s) s.title = r.title || ''; // giữ đồng bộ để SSE tick sau không ghi đè ngược
      closeOverlay();
      toast(r.title ? 'Đã đổi tên phiên' : 'Đã bỏ tên tự đặt');
    }).catch(() => toast('Đổi tên thất bại'));
  };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  showOverlay('Đổi tên phiên', box, [overlayButton('Hủy', closeOverlay), overlayButton('Lưu', save, true)]);
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
}

function submitChat() {
  const inp = document.getElementById('chatinput');
  const v = inp.value.trim();
  if (!v || !currentSid) return;
  histPush('hist:chat', v);
  inp.value = '';
  scrollChatsToEnd(); // tin mới gửi phải visible ngay, kể cả khi bàn phím đang bật
  if (v[0] === '/') return routeSlash(v);
  fetch('/api/chat/' + currentSid, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: v }),
  }).then(r => r.json())
    .then(r => {
      // 409 session busy / lỗi khác: trả lại tin nhắn vào input, không mất im lặng
      if (r && r.error) { inp.value = v; toast('Không gửi được: ' + r.error); }
      refreshChat();
    })
    .catch(e => { inp.value = v; toast('Lỗi mạng: ' + e.message); });
}
document.getElementById('chatinput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submitChat(); });
document.getElementById('chatsendbtn').addEventListener('click', submitChat);

/* ================= HERMES tab: stable render ================= */
let hermesConvos = [];
let hermesMaxTs = 0;
let hermesSeenTs = 0;
let hermesOpenId = null;
let hermesRendered = 0; // số bubble đã render của conversation đang mở

let hermesFetchBusy = false; // chống fetch chồng nhau khi mạng chậm hơn interval
async function refreshHermes() {
  if (hermesFetchBusy) return;
  hermesFetchBusy = true;
  const r = await fetch('/api/hermes').then(r => r.json()).catch(() => null);
  hermesFetchBusy = false;
  if (!r) return;
  hermesConvos = r.conversations || [];
  hermesWaitServer = !!r.sending; // hermes CLI đang xử lý (kể cả gửi từ client/tab khác)
  let max = 0;
  hermesConvos.forEach(c => c.messages.forEach(m => { if (m.ts > max) max = m.ts; }));
  if (hermesSeenTs === 0) hermesSeenTs = max; // lần đầu: không báo unread cũ
  hermesMaxTs = max;
  if (activeTab === 'hermes') {
    hermesSeenTs = max;
    if (hermesOpenId) renderHermesChat(); // append-only: chỉ bubble MỚI được thêm, không rebuild
    else renderHermesList();
    updateHermesTyping();
  }
  updateBadges();
}
setInterval(refreshHermes, 2500); // poll realtime (server cache 1.5s); nền: badge nhảy cả khi ở tab CLI
refreshHermes();

// List conversations: diff theo data-hid
function renderHermesList() {
  const cont = document.getElementById('hermesrows');
  document.getElementById('hermesempty').classList.toggle('hidden', hermesConvos.length > 0);
  const seen = new Set();
  hermesConvos.forEach((c, idx) => {
    let row = cont.querySelector('[data-hid="' + CSS.escape(c.id) + '"]');
    if (!row) {
      row = document.createElement('div');
      row.className = 'srow fadein';
      row.dataset.hid = c.id;
      row.innerHTML =
        '<span class="chip h-src" style="background:rgba(139,92,246,.14);color:#a78bfa"></span>' +
        '<span class="h-title text-[13px] font-medium truncate"></span>' +
        '<span class="h-meta text-xs text-[#666b7d] ml-auto whitespace-nowrap"></span>';
      row.onclick = () => { hermesOpenId = c.id; hermesRendered = 0; hermesExtraRendered = 0; document.getElementById('hermes-bubbles').innerHTML = ''; renderHermesChat(); updateHermesTyping(); };
      cont.appendChild(row);
    }
    setText(row.querySelector('.h-src'), c.source);
    setText(row.querySelector('.h-title'), String(c.title).slice(0, 70));
    setText(row.querySelector('.h-meta'), c.count + ' msgs · ' + ago(c.lastTs));
    seen.add(c.id);
    const cur = cont.children[idx];
    if (cur !== row) cont.insertBefore(row, cur || null);
  });
  [...cont.children].forEach(ch => { if (!seen.has(ch.dataset.hid)) ch.remove(); });
}

// Message local (user gửi + reply từ Hermes CLI) theo conversation id.
// '__direct__' = chat trực tiếp không thuộc state.db.
// Persist vào localStorage để reply KHÔNG mất khi F5 (state.db không lưu chat CLI trực tiếp).
const hermesExtra = (function () {
  try {
    const j = JSON.parse(localStorage.getItem('hermesExtra') || '{}');
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
  } catch { return {}; }
})();
function saveHermesExtra() {
  try {
    // cap: mỗi conversation giữ 60 message cuối, tránh phình localStorage
    for (const k of Object.keys(hermesExtra)) {
      if (hermesExtra[k].length > 60) hermesExtra[k] = hermesExtra[k].slice(-60);
    }
    localStorage.setItem('hermesExtra', JSON.stringify(hermesExtra));
  } catch {} // quota đầy / private mode -> bỏ qua, chat vẫn chạy
}
let hermesExtraRendered = 0;

function openHermesDirect() {
  hermesOpenId = '__direct__';
  hermesRendered = 0;
  hermesExtraRendered = 0;
  document.getElementById('hermes-bubbles').innerHTML = '';
  renderHermesChat();
  updateHermesTyping();
}

// Chat hermes: append-only theo số message đã render (server msgs + local extras)
function renderHermesChat() {
  const c = hermesOpenId === '__direct__'
    ? { source: 'cli', title: 'Chat trực tiếp với Hermes', messages: [] }
    : hermesConvos.find(x => x.id === hermesOpenId);
  if (!c) return hermesBack();
  document.getElementById('hermes-list').classList.add('hidden');
  const hc = document.getElementById('hermes-chat');
  hc.classList.remove('hidden');
  hc.classList.add('flex');
  setText(document.getElementById('hermes-title'), '[' + c.source + '] ' + String(c.title).slice(0, 60));
  const box = document.getElementById('hermes-bubbles');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const extra = hermesExtra[hermesOpenId] || [];
  // server msgs tăng SAU khi đã render extras -> render lại từ đầu để giữ đúng thứ tự
  if (c.messages.length < hermesRendered || (c.messages.length > hermesRendered && hermesExtraRendered > 0)) {
    box.innerHTML = '';
    hermesRendered = 0;
    hermesExtraRendered = 0;
  }
  for (let i = hermesRendered; i < c.messages.length; i++) {
    const m = c.messages[i];
    box.appendChild(bubbleFor({ role: m.role, content: m.role === 'tool' ? m.content.slice(0, 300) : m.content }));
  }
  hermesRendered = c.messages.length;
  for (let i = hermesExtraRendered; i < extra.length; i++) box.appendChild(bubbleFor(extra[i]));
  hermesExtraRendered = extra.length;
  if (atBottom || hermesRendered + hermesExtraRendered <= 30) box.scrollTop = box.scrollHeight;
}

function hermesBack() {
  hermesOpenId = null;
  hermesRendered = 0;
  hermesExtraRendered = 0;
  document.getElementById('hermes-chat').classList.add('hidden');
  document.getElementById('hermes-chat').classList.remove('flex');
  document.getElementById('hermes-list').classList.remove('hidden');
  renderHermesList();
}

// Typing indicator Hermes: hiện khi CHỜ THẬT — request của client này đang chờ reply,
// hoặc server báo hermes CLI đang chạy (r.sending — gửi từ client/tab khác).
let hermesWaitLocal = false;
let hermesWaitServer = false;
function updateHermesTyping() {
  const on = !!hermesOpenId && (hermesWaitLocal || hermesWaitServer);
  document.getElementById('hermes-typing').classList.toggle('hidden', !on);
}

// Gửi tin cho Hermes: server gọi Hermes CLI thật, reply hiển thị như assistant message
function hermesSend(text) {
  switchTab('hermes');
  if (!hermesOpenId) openHermesDirect(); // gửi từ nơi khác -> mở chat trực tiếp
  const convId = hermesOpenId;
  (hermesExtra[convId] = hermesExtra[convId] || []).push({ role: 'user', content: text });
  saveHermesExtra();
  renderHermesChat();
  hermesWaitLocal = true;
  updateHermesTyping();
  busy(true);
  return fetch('/api/hermes/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(r => r.json())
    .then(r => {
      (hermesExtra[convId] = hermesExtra[convId] || []).push({
        role: 'assistant',
        content: r.ok ? r.reply : 'Lỗi Hermes: ' + (r.error || '?'),
      });
      saveHermesExtra();
      if (hermesOpenId === convId) renderHermesChat();
      if (!r.ok) toast('Hermes lỗi: ' + (r.error || '?'));
      else if (activeTab !== 'hermes') notifyDone('Hermes đã trả lời'); // user đã chuyển tab trong lúc chờ
    })
    .catch(e => {
      (hermesExtra[convId] = hermesExtra[convId] || []).push({ role: 'assistant', content: 'Lỗi mạng: ' + e.message });
      saveHermesExtra();
      if (hermesOpenId === convId) renderHermesChat();
    })
    .finally(() => {
      busy(false);
      hermesWaitLocal = false;
      updateHermesTyping();
      refreshHermes(); // reply có thể đã vào state.db -> kéo data mới ngay, không đợi tick 2.5s
    });
}
function submitHermes() {
  const inp = document.getElementById('hermes-input');
  const v = inp.value.trim();
  if (!v) return;
  histPush('hist:hermes', v);
  inp.value = '';
  hermesSend(v);
  scrollChatsToEnd(); // bubble user vừa render phải visible ngay
}
document.getElementById('hermes-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submitHermes(); });
document.getElementById('hermessendbtn').addEventListener('click', submitHermes);

// history riêng cho từng input (task / chat resume / hermes)
attachHistory(taskinput, 'hist:task');
attachHistory(document.getElementById('chatinput'), 'hist:chat');
attachHistory(document.getElementById('hermes-input'), 'hist:hermes');

/* ================= tab STATS: Chart.js (donut + bar + stat cards) ================= */
// Palette categorical dark đã validate (CVD-safe, contrast >= 3:1 trên nền #171a23)
const CHART_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const CHART_OTHER = '#6b7280'; // xám trung tính cho nhóm "Khác"
const CHART_SURFACE = '#171a23';
let donutChart = null, barChart = null;
let lastChartSig = ''; // signature data lần trước — data không đổi thì bỏ qua update
const projColorSlot = {}; // project -> slot màu cố định (màu theo entity, không theo rank)

function projectColor(name) {
  if (!(name in projColorSlot)) projColorSlot[name] = Object.keys(projColorSlot).length;
  const slot = projColorSlot[name];
  return slot < CHART_COLORS.length ? CHART_COLORS[slot] : CHART_OTHER;
}

// Gom số liệu từ allSessions: sessions + messages theo project
function chartData() {
  const byProj = {};
  let active = 0, idle = 0, totalMsgs = 0;
  for (const s of allSessions) {
    const pr = byProj[s.project] = byProj[s.project] || { sessions: 0, msgs: 0 };
    pr.sessions++;
    pr.msgs += s.msgs;
    totalMsgs += s.msgs;
    if (s.status === 'IDLE') idle++; else active++; // ACTIVE + RUNNING gộp chung
  }
  return { byProj, total: allSessions.length, active, idle, totalMsgs };
}

function updateCharts() {
  if (!window.Chart) return; // CDN chưa load
  const d = chartData();

  // stat cards
  setText(document.getElementById('stat-total'), String(d.total));
  setText(document.getElementById('stat-active'), String(d.active));
  setText(document.getElementById('stat-idle'), String(d.idle));
  setText(document.getElementById('stat-msgs'), String(d.totalMsgs));

  // Donut: sessions theo project — tối đa 7 slot màu, phần còn lại gộp "Khác"
  const sorted = Object.entries(d.byProj).sort((a, b) => b[1].sessions - a[1].sessions);
  const top = sorted.slice(0, 7);
  const restSessions = sorted.slice(7).reduce((n, x) => n + x[1].sessions, 0);
  const donutLabels = top.map(x => x[0]);
  const donutVals = top.map(x => x[1].sessions);
  const donutCols = donutLabels.map(projectColor);
  if (restSessions > 0) { donutLabels.push('Khác'); donutVals.push(restSessions); donutCols.push(CHART_OTHER); }

  // Bar: messages per project top 5 — 1 measure -> 1 hue (không rainbow)
  const topMsgs = [...sorted].sort((a, b) => b[1].msgs - a[1].msgs).slice(0, 5);
  const barLabels = topMsgs.map(x => x[0]);
  const barVals = topMsgs.map(x => x[1].msgs);

  // data không đổi -> khỏi đụng canvas (không nháy)
  const sig = JSON.stringify([donutLabels, donutVals, barLabels, barVals, d.total, d.active, d.idle, d.totalMsgs]);
  if (sig === lastChartSig) return;
  lastChartSig = sig;

  Chart.defaults.color = '#8b8fa3';
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.animation = false; // update tại chỗ, không animation lặp

  if (!donutChart) {
    donutChart = new Chart(document.getElementById('chart-donut'), {
      type: 'doughnut',
      data: { labels: donutLabels, datasets: [{ data: donutVals, backgroundColor: donutCols,
        borderColor: CHART_SURFACE, borderWidth: 2 }] }, // gap 2px giữa các segment
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { position: 'right', labels: { boxWidth: 10, boxHeight: 10, padding: 10 } } },
      },
    });
  } else {
    // update tại chỗ — không destroy/rebuild để không nháy
    donutChart.data.labels = donutLabels;
    donutChart.data.datasets[0].data = donutVals;
    donutChart.data.datasets[0].backgroundColor = donutCols;
    donutChart.update();
  }

  if (!barChart) {
    barChart = new Chart(document.getElementById('chart-bar'), {
      type: 'bar',
      data: { labels: barLabels, datasets: [{ data: barVals, backgroundColor: CHART_COLORS[0],
        borderRadius: 4, barThickness: 18 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } }, // 1 series -> không cần legend
        scales: {
          x: { grid: { color: '#262a36' }, ticks: { precision: 0 }, border: { color: '#383a45' } },
          y: { grid: { display: false }, border: { color: '#383a45' } },
        },
      },
    });
  } else {
    barChart.data.labels = barLabels;
    barChart.data.datasets[0].data = barVals;
    barChart.update();
  }
}

/* ================= TAB AGY-PROXY: gọi CLI qua server, log realtime ================= */
let agyStatusTimer = null, agyLogTimer = null;
let agyLogNext = 0;       // absolute index dòng log tiếp theo cần fetch
let agyLogEmpty = true;   // còn placeholder trong panel log
let agyCfgLoaded = false; // config editor chỉ build 1 lần

function agyEnter() {
  refreshAgyStatus();
  pollAgyLog();
  if (!agyCfgLoaded) loadAgyConfig();
  clearInterval(agyStatusTimer);
  agyStatusTimer = setInterval(refreshAgyStatus, 3000);
  clearInterval(agyLogTimer);
  agyLogTimer = setInterval(pollAgyLog, 2000);
}
function agyLeave() {
  clearInterval(agyStatusTimer);
  clearInterval(agyLogTimer);
  agyStatusTimer = agyLogTimer = null;
}

function agyChip(el, name, rec, running) {
  var label = name.toUpperCase() + ': ';
  var cls = 'agychip';
  if (running) { label += 'RUNNING'; cls += ' run'; }
  else if (!rec) { label += '—'; }
  else { label += (rec.ok ? 'PASS' : 'FAIL') + ' · ' + ago(rec.at); cls += rec.ok ? ' ok' : ' fail'; }
  setText(el, label);
  if (el.className !== cls) el.className = cls;
}

// nhãn tiếng Việt cho trạng thái tài khoản
const ACC_LABEL = { ok: 'hoạt động', new: 'chưa dùng', needs_human: 'cần xử lý', failed: 'lỗi', unknown: 'không rõ' };
const ACC_ORDER = ['ok', 'new', 'needs_human', 'failed', 'unknown'];

function renderAccBar(acc) {
  const bar = document.getElementById('agy-accbar');
  const lg = document.getElementById('agy-acclegend');
  const total = acc.total || 0;
  const keys = ACC_ORDER.filter(k => acc.status[k]).concat(
    Object.keys(acc.status).filter(k => ACC_ORDER.indexOf(k) < 0));
  const sig = JSON.stringify([total, acc.status]);
  if (bar.dataset.sig === sig) return; // không đổi -> khỏi đụng DOM
  bar.dataset.sig = sig;
  bar.innerHTML = '';
  lg.innerHTML = '';
  for (const k of keys) {
    const n = acc.status[k];
    const seg = document.createElement('span');
    seg.className = 'acc-' + k;
    seg.style.width = (total ? (n / total * 100) : 0) + '%';
    seg.title = (ACC_LABEL[k] || k) + ': ' + n;
    bar.appendChild(seg);
    const item = document.createElement('span');
    item.className = 'acclg';
    const dot = document.createElement('i');
    dot.className = 'acc-' + k;
    const tx = document.createElement('span');
    tx.textContent = n + ' ' + (ACC_LABEL[k] || k);
    item.appendChild(dot); item.appendChild(tx);
    lg.appendChild(item);
  }
}

// 16814671 -> "16.8M"; 1317 -> "1.3k"
function shortNum(n) {
  n = +n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
// mã lỗi HTTP -> nói bằng tiếng người
const CODE_LABEL = {
  429: 'vượt hạn mức', 503: 'nhà cung cấp quá tải', 500: 'lỗi máy chủ',
  400: 'request sai', 401: 'sai khoá', 402: 'hết tiền', 404: 'không thấy model', 408: 'quá hạn chờ',
};

function renderAgyUsage(u) {
  const box = document.getElementById('agy-usagebox');
  if (!u || !u.ok) { box.classList.add('hidden'); return; } // không đọc được DB -> ẩn hẳn
  box.classList.remove('hidden');
  const sig = JSON.stringify(u);
  if (box.dataset.sig === sig) return; // số liệu chưa đổi -> khỏi đụng DOM
  box.dataset.sig = sig;

  const errPct = u.reqs ? Math.round(u.errs / u.reqs * 100) : 0;
  setText(document.getElementById('agy-u-reqs'), shortNum(u.reqs));
  const eEl = document.getElementById('agy-u-errs');
  setText(eEl, u.errs ? shortNum(u.errs) + ' (' + errPct + '%)' : '0');
  eEl.className = 'ustat-n' + (errPct >= 20 ? ' warn' : ''); // lỗi nhiều -> tô đỏ
  setText(document.getElementById('agy-u-tok'), shortNum(u.tokens));
  setText(document.getElementById('agy-u-avg'), u.avgMs ? 'trễ trung bình ' + (u.avgMs / 1000).toFixed(1) + 's' : '');

  // cảnh báo khi tỉ lệ lỗi cao — nói rõ nguyên nhân chính
  const alert = document.getElementById('agy-u-alert');
  if (errPct >= 20 && u.codes.length) {
    const top = u.codes[0];
    const why = CODE_LABEL[top.status] || (top.status ? 'mã ' + top.status : 'không rõ nguyên nhân');
    setText(alert, errPct + '% request lỗi trong 24h — chủ yếu do ' + why + ' (' + top.n + ' lần).');
    alert.classList.remove('hidden');
  } else alert.classList.add('hidden');

  // biểu đồ cột theo giờ: đỏ chồng trên xanh
  const hb = document.getElementById('agy-u-hours');
  const lblBox = document.getElementById('agy-u-hourlbl');
  hb.innerHTML = '';
  lblBox.innerHTML = '';
  const lbl = lblBox;
  const max = Math.max(1, ...u.hours.map(h => h.n));
  for (const h of u.hours) {
    const col = document.createElement('div');
    col.className = 'ubar';
    col.title = h.h + 'h: ' + h.n + ' request' + (h.e ? ', ' + h.e + ' lỗi' : '');
    if (!h.n) {
      const z = document.createElement('div'); z.className = 'ubar-empty'; col.appendChild(z);
    } else {
      const pct = h.n / max * 100;
      const ePct = h.n ? (h.e / h.n) : 0;
      const eDiv = document.createElement('div');
      eDiv.className = 'ubar-e';
      eDiv.style.height = (pct * ePct) + '%';
      const oDiv = document.createElement('div');
      oDiv.className = 'ubar-o';
      oDiv.style.height = (pct * (1 - ePct)) + '%';
      if (h.e) col.appendChild(eDiv);
      col.appendChild(oDiv);
    }
    hb.appendChild(col);
    const s = document.createElement('span');
    s.textContent = h.h;
    lbl.appendChild(s);
  }
  // model dùng nhiều nhất
  const mb = document.getElementById('agy-u-models');
  mb.innerHTML = '';
  const mMax = Math.max(1, ...u.models.map(m => m.n));
  for (const m of u.models) {
    const row = document.createElement('div');
    row.className = 'urow';
    const fill = document.createElement('div');
    fill.className = 'urow-fill';
    fill.style.width = (m.n / mMax * 100) + '%';
    const tx = document.createElement('div');
    tx.className = 'urow-txt';
    const nm = document.createElement('span'); nm.className = 'urow-name'; nm.textContent = m.model;
    const n = document.createElement('span'); n.className = 'urow-n'; n.textContent = m.n;
    tx.appendChild(nm); tx.appendChild(n);
    if (m.e) { const e = document.createElement('span'); e.className = 'urow-e'; e.textContent = m.e + ' lỗi'; tx.appendChild(e); }
    row.appendChild(fill); row.appendChild(tx);
    mb.appendChild(row);
  }

  // mã lỗi
  const cb = document.getElementById('agy-u-codes');
  cb.innerHTML = '';
  for (const c of u.codes) {
    const s = document.createElement('span');
    s.className = 'ucode';
    const b = document.createElement('b');
    b.textContent = c.status || '?';
    s.appendChild(b);
    s.appendChild(document.createTextNode(' ' + (CODE_LABEL[c.status] || 'khác') + ' · ' + c.n));
    cb.appendChild(s);
  }
}

let agyModelGroups = [];
function renderAgyModels() {
  const box = document.getElementById('agy-modellist');
  const q = (document.getElementById('agy-modelsearch').value || '').trim().toLowerCase();
  const open = new Set([...box.querySelectorAll('.mgrp.open')].map(g => g.dataset.g));
  box.innerHTML = '';
  if (!agyModelGroups.length) {
    const e = document.createElement('div');
    e.className = 'text-[12.5px] text-[#666b7d]';
    e.textContent = '(gateway chưa trả models)';
    box.appendChild(e);
    return;
  }
  let shown = 0;
  for (const g of agyModelGroups) {
    const items = q ? g.items.filter(m => m.toLowerCase().indexOf(q) >= 0) : g.items;
    if (!items.length) continue;
    shown += items.length;
    const wrap = document.createElement('div');
    wrap.className = 'mgrp' + (q || open.has(g.name) ? ' open' : ''); // đang tìm -> mở sẵn
    wrap.dataset.g = g.name;
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'mgrp-head';
    const nm = document.createElement('span'); nm.className = 'mgrp-name'; nm.textContent = g.name;
    const ct = document.createElement('span'); ct.className = 'mgrp-count'; ct.textContent = items.length;
    const ch = document.createElement('span'); ch.className = 'mgrp-chev'; ch.innerHTML = ICON_CHEV;
    head.appendChild(nm); head.appendChild(ct); head.appendChild(ch);
    head.onclick = () => wrap.classList.toggle('open');
    const body = document.createElement('div'); body.className = 'mgrp-body';
    const inner = document.createElement('div');
    for (const m of items) {
      const it = document.createElement('div');
      it.className = 'mitem';
      if (q) { // tô sáng đoạn khớp, dùng textContent nên an toàn XSS
        const i = m.toLowerCase().indexOf(q);
        it.appendChild(document.createTextNode(m.slice(0, i)));
        const mk = document.createElement('mark'); mk.textContent = m.slice(i, i + q.length);
        it.appendChild(mk);
        it.appendChild(document.createTextNode(m.slice(i + q.length)));
      } else it.textContent = m;
      inner.appendChild(it);
    }
    body.appendChild(inner);
    wrap.appendChild(head); wrap.appendChild(body);
    box.appendChild(wrap);
  }
  if (!shown) {
    const e = document.createElement('div');
    e.className = 'text-[12.5px] text-[#666b7d]';
    e.textContent = 'Không có model nào khớp "' + q + '"';
    box.appendChild(e);
  }
}

async function refreshAgyStatus() {
  const r = await fetch('/api/agy/status').then(r => r.json()).catch(() => null);
  if (!r) return;
  // thẻ trạng thái
  const hero = document.getElementById('agy-hero');
  const heroCls = 'agyhero ' + (r.running ? 'on' : 'off');
  if (hero.className !== heroCls) hero.className = heroCls;
  setText(document.getElementById('agy-status'), r.running ? 'Đang chạy' : 'Đã dừng');
  const meta = r.running
    ? 'cổng ' + r.port + (r.dev ? ' · dashboard quản lý (pid ' + r.dev.pid + ')' : '')
    : 'cổng ' + r.port + ' không phản hồi';
  setText(document.getElementById('agy-hero-meta'), meta);
  const tag = document.getElementById('agy-hero-tag');
  tag.classList.toggle('hidden', !r.external);
  if (r.external) setText(tag, 'CHẠY NGOÀI');

  renderAgyUsage(r.usage);
  setText(document.getElementById('agy-accounts'), String(r.accounts));
  if (r.acc) {
    renderAccBar(r.acc);
    setText(document.getElementById('agy-acc-recent'), r.acc.recent24h + ' chạy trong 24h');
    const kiroOk = (r.acc.kiro && r.acc.kiro.ok) || 0;
    setText(document.getElementById('agy-kiro'), 'Kiro: ' + kiroOk + ' tài khoản sẵn sàng / ' + r.acc.total);
  }

  setText(document.getElementById('agy-models'), String(r.models.length));
  const gsig = JSON.stringify(r.modelGroups || []);
  if (gsig !== window.__agyGsig) { // danh sách model đổi mới render lại (giữ nhóm đang mở)
    window.__agyGsig = gsig;
    agyModelGroups = r.modelGroups || [];
    renderAgyModels();
  }
  // chạy ngoài dashboard -> Stop/Restart không kill được, hiện note
  document.getElementById('agy-note').classList.toggle('hidden', !(r.running && !r.dev));
  // buttons: Start disable khi đang chạy; Stop/Restart chỉ enable khi dashboard là chủ process
  // (proxy chạy ngoài -> Restart cũng disable: bấm chỉ spawn dev mới rồi dính EADDRINUSE)
  document.getElementById('agy-btn-start').disabled = !!r.dev || r.running;
  document.getElementById('agy-btn-stop').disabled = !r.dev;
  document.getElementById('agy-btn-restart').disabled = r.running && !r.dev;
  const taskName = r.task ? r.task.name : null;
  for (const name of ['build', 'test', 'typecheck']) {
    document.getElementById('agy-btn-' + name).disabled = !!taskName;
    agyChip(document.getElementById('agy-last-' + name), name, r.last[name], taskName === name);
  }
}

let agyLogBusy = false; // chống 2 poll chồng nhau (timer + gọi tay sau agyAction) -> log double-append
// Phân loại 1 dòng log để tô màu (textContent -> an toàn XSS)
function logLineNode(line) {
  const d = document.createElement('div');
  d.textContent = line;
  const l = line.toLowerCase();
  if (/\b(error|failed|fail|exception|cannot|econn|eaddrinuse)\b/.test(l) || l.indexOf('[exit code=1') >= 0) d.className = 'lg-err';
  else if (/\b(warn|warning|deprecat)\b/.test(l)) d.className = 'lg-warn';
  else if (/\b(success|passed|done|ready|listening|compiled|ok)\b/.test(l) || l.indexOf('[exit code=0') >= 0) d.className = 'lg-ok';
  else if (line.trim()[0] === '[') d.className = 'lg-dim'; // dòng nhãn [dev] [build]...
  return d;
}

async function pollAgyLog() {
  if (agyLogBusy) return;
  agyLogBusy = true;
  const r = await fetch('/api/agy/log?since=' + agyLogNext).then(r => r.json()).catch(() => null);
  agyLogBusy = false;
  if (!r) return;
  // server dashboard restart -> buffer mới: reset về 0 VÀ clear panel — không clear thì
  // lượt sau fetch lại từ đầu sẽ append trùng toàn bộ log đang hiển thị
  if (r.next < agyLogNext) { agyLogNext = 0; agyClearLog(); return; }
  if (!r.lines.length) { agyLogNext = r.next; return; }
  const box = document.getElementById('agy-log');
  if (agyLogEmpty) { box.textContent = ''; agyLogEmpty = false; }
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  // mỗi dòng 1 node có màu: lỗi đỏ / cảnh báo vàng / xong xanh — quét mắt ra ngay
  for (const line of r.lines) box.appendChild(logLineNode(line));
  agyLogNext = r.next;
  // cap DOM: quá nhiều dòng thì cắt bớt đầu (log cũ đã trôi khỏi buffer server rồi)
  while (box.childElementCount > 1200) box.removeChild(box.firstChild);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function agyClearLog() {
  document.getElementById('agy-log').textContent = '(đã clear — log mới sẽ hiện ở đây)';
  agyLogEmpty = true;
}

// Start/Stop/Restart/Build/Test/Typecheck — server spawn npm trong folder agy-proxy
async function agyAction(seg, cmd) {
  busy(true);
  const r = await fetch('/api/agy/' + seg, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd ? { cmd } : {}),
  }).then(r => r.json()).catch(e => ({ error: e.message })).finally(() => busy(false));
  if (r.error) toast('Lỗi: ' + r.error);
  else toast(seg === 'run' ? 'Đang chạy ' + cmd + ' — xem log bên dưới' : 'OK: ' + seg);
  refreshAgyStatus();
  pollAgyLog();
}

// Config editor: build 1 lần từ GET /api/agy/config, mỗi row có Save riêng
async function loadAgyConfig() {
  const r = await fetch('/api/agy/config').then(r => r.json()).catch(() => null);
  if (!r) return;
  agyCfgLoaded = true;
  const cont = document.getElementById('agy-config');
  cont.innerHTML = '';
  for (const f of r.fields) {
    const row = document.createElement('div');
    row.className = 'flex flex-col gap-1';
    const lbl = document.createElement('div');
    lbl.className = 'text-[12px] font-semibold text-[#a5a9b8]';
    lbl.style.fontFamily = 'ui-monospace, Menlo, monospace';
    lbl.textContent = f.key;
    const desc = document.createElement('div');
    desc.className = 'text-[11.5px] text-[#666b7d]';
    desc.textContent = f.desc;
    const line = document.createElement('div');
    line.className = 'agycfgrow flex items-center gap-2';
    const inp = document.createElement('input');
    inp.value = f.value;
    inp.placeholder = '(chưa đặt — dùng mặc định)';
    inp.setAttribute('autocomplete', 'off');
    const save = document.createElement('button');
    save.className = 'agycfgsave';
    save.textContent = 'Save';
    inp.addEventListener('input', () => save.classList.toggle('dirty', inp.value.trim() !== f.value));
    save.onclick = async () => {
      const value = inp.value.trim();
      const resp = await fetch('/api/agy/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: f.key, value }),
      }).then(x => x.json()).catch(e => ({ error: e.message }));
      if (resp.error) return toast('Lỗi: ' + resp.error);
      f.value = value;
      save.classList.remove('dirty');
      toast('Đã lưu ' + f.key + (resp.restart ? ' — bấm Restart để áp dụng' : ''));
    };
    line.appendChild(inp);
    line.appendChild(save);
    row.appendChild(lbl);
    row.appendChild(desc);
    row.appendChild(line);
    cont.appendChild(row);
  }
}

/* ================= soft keyboard (iOS/Android): visualViewport ================= */
// Cuộn vùng chat đang mở xuống cuối — CHỈ scroll box nội bộ, không scroll toàn trang
// (tránh nhảy layout). Box đang ẩn scroll vô hại nên không cần check view.
function scrollChatsToEnd() {
  for (const id of ['bubbles', 'hermes-bubbles']) {
    const box = document.getElementById(id);
    if (box) box.scrollTop = box.scrollHeight;
  }
}

(function () {
  const vv = window.visualViewport;
  if (!vv) return; // browser cũ không có API: giữ hành vi như trước
  let raf = 0;
  function apply() {
    raf = 0;
    // phần layout viewport bị bàn phím che ở đáy; offsetTop bù việc iOS đẩy trang lên
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    // <80px không phải bàn phím (URL bar co giãn / bounce) -> không đụng layout.
    // Android interactive-widget=resizes-content: innerHeight tự co -> kb≈0, cũng đúng.
    const open = kb > 80;
    document.documentElement.style.setProperty('--kb', (open ? Math.round(kb) : 0) + 'px');
    document.body.classList.toggle('kb-open', open);
    if (open) scrollChatsToEnd(); // viewport co lại -> giữ tin nhắn mới nhất visible
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); }; // debounce burst events
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
})();

// Focus input -> đợi bàn phím bật + padding áp xong (iOS animate ~250ms) rồi đưa
// input vào tầm nhìn + cuộn chat xuống cuối để thấy đang gõ ở đâu.
for (const id of ['taskinput', 'chatinput', 'hermes-input']) {
  document.getElementById(id).addEventListener('focus', function () {
    const inp = this;
    setTimeout(() => {
      inp.scrollIntoView({ block: 'end' });
      scrollChatsToEnd();
    }, 250);
  });
}

// PWA service worker + Web Push (tự subscribe nếu đã cấp quyền từ session trước)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(function () { setupPush(); }).catch(function () {});
}
</script>
</body>
</html>`;

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} đang bận (dashboard khác đang chạy?). Đổi port: PORT=7800 node claude-dashboard.js`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`claude-dashboard listening on http://localhost:${PORT}`);
});
