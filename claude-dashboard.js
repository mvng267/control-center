#!/usr/bin/env node
// claude-dashboard.js — Hybrid Control Center: Claude CLI sessions + Hermes stream
// UI hiện đại kiểu Linear/Vercel dark: Tailwind + daisyUI + Lucide (CDN), KHÔNG hiệu ứng nháy.
// Render ổn định: diff DOM theo key, chỉ update node thay đổi — không full-repaint.
// Usage: node claude-dashboard.js   (http://localhost:7799)

const http = require('http');
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

function parseSessionFile(file) {
  let st;
  try { st = fs.statSync(file); } catch { cache.delete(file); return null; }
  const c = cache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.data;

  const msgs = [];
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    const m = obj.message || obj;
    const text = extractText(m.content);
    if (!text.trim()) continue;
    msgs.push({ role: obj.type, text, ts: obj.timestamp || null });
  }
  // tsMs: timestamp (ms) từng message — precompute 1 lần để đếm unread không tốn Date.parse mỗi tick
  const data = { msgs, mtimeMs: st.mtimeMs, tsMs: msgs.map(m => Date.parse(m.ts) || 0) };
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
  return parsed.msgs.slice(-30).map(m => ({ role: m.role, content: m.text }));
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

function spawnClaude(args, sid, meta) {
  const proc = spawn('claude', args, {
    cwd: os.homedir(),
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
  });
  proc.on('error', () => procs.delete(sid));
  proc.on('exit', () => procs.delete(sid));
  proc.unref();
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
  const args = ['-p', job.prompt, '--session-id', sid];
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

// Cache 3s — client poll 4s, tránh spawn sqlite3 dồn dập
let hermesCache = { at: 0, data: null };

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
  if (hermesCache.data && Date.now() - hermesCache.at < 3000) return hermesCache.data;
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
  const data = {
    running, port, accounts, models,
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
      try { res.write(`data: ${JSON.stringify({ sessions: listSessions(), jobs: listJobs(), model: currentModel })}\n\n`); } catch {}
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
    const args = ['-p', task, '--session-id', sid];
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
    spawnClaude(['-p', msg, '--resume', sid], sid, { task: msg });
    return json(res, 200, { ok: true, sid });
  }

  if ((m = p.match(/^\/api\/kill\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    const entry = procs.get(sid);
    if (!entry) return json(res, 404, { error: 'not running' });
    try { process.kill(-entry.proc.pid, 'SIGTERM'); } catch { try { entry.proc.kill('SIGTERM'); } catch {} }
    procs.delete(sid);
    return json(res, 200, { ok: true });
  }

  if ((m = p.match(/^\/api\/history\/([\w-]+)$/))) {
    const sid = m[1];
    const typing = procs.has(sid);
    const file = findSessionFile(sid);
    // user đang xem chat -> đánh dấu đã đọc (chỉ set cho session THẬT, sid rác không phình Map)
    if (file || typing) lastSeen.set(sid, Date.now());
    if (!file) return json(res, 200, { sid, messages: [], total: 0, typing, status: statusOf(sid, 0) });
    let mt = 0;
    try { mt = fs.statSync(file).mtimeMs; } catch {}
    const messages = getHistory(sid) || [];
    // total: TỔNG message tuyệt đối (messages chỉ là window 30 cuối) — client cần để
    // quy đổi offset /clear; thiếu total thì /clear trên session >30 msg mất message mới vĩnh viễn
    const parsed = parseSessionFile(file);
    const total = parsed ? parsed.msgs.length : messages.length;
    return json(res, 200, { sid, messages, total, typing, status: statusOf(sid, mt) });
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
    const msgs = parsed.msgs.map(x => ({ role: x.role, content: x.text, ts: x.ts }));
    let body, type;
    if (fmt === 'json') {
      body = JSON.stringify({ sid, exportedAt: new Date().toISOString(), count: msgs.length, messages: msgs }, null, 2);
      type = 'application/json';
    } else {
      body = '# Claude session ' + sid + '\n\n'
        + msgs.map(x => '**' + (x.role === 'user' ? 'User' : 'Assistant') + '**'
          + (x.ts ? ' · ' + x.ts : '') + ':\n\n' + x.content + '\n\n---\n').join('\n');
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
    return json(res, 200, await getHermesData());
  }
  // Chat 2 chiều: gọi THẬT Hermes CLI (-z "<text>" -m <model>), đợi stdout -> reply
  if (p === '/api/hermes/send' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
    const text = (body.text || '').trim();
    if (!text) return json(res, 400, { ok: false, error: 'text required' });
    execFile(HERMES_BIN, ['-z', text, '-m', HERMES_MODEL],
      { maxBuffer: 10 * 1024 * 1024, timeout: 180000, env: process.env },
      (err, stdout, stderr) => {
        if (err) {
          const msg = ((stderr || '').trim() || err.message || 'hermes error').slice(-2000);
          return json(res, 500, { ok: false, error: msg });
        }
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
  name: 'Claude Control Center',
  short_name: 'Claude',
  start_url: '/',
  display: 'standalone',
  background_color: '#0f1117',
  theme_color: '#0f1117',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
});

// Service worker tối thiểu — network-only, đủ điều kiện cài PWA
const SW_JS = `self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* network-only */ });
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
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: #262a36; border-radius: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }

  /* fade-in MỘT LẦN cho phần tử mới xuất hiện — không có animation lặp */
  .fadein { animation: fadein .2s ease-out; }
  @keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

  /* tab sidebar */
  .tabbtn {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px;
    padding: 10px 6px; border-radius: 10px; color: #666b7d; min-height: 48px; flex: 1;
    transition: color .15s, background .15s; cursor: pointer; border: none; background: none;
    font: inherit; font-size: 10px; font-weight: 600; letter-spacing: .3px;
  }
  @media (min-width: 768px) { .tabbtn { flex: none; margin: 0 10px; } }
  .tabbtn:hover { color: #a5a9b8; background: #1a1d27; }
  .tabbtn.active { color: #3b82f6; background: rgba(59, 130, 246, .12); }
  .tabbtn.hm.active { color: #8b5cf6; background: rgba(139, 92, 246, .12); }
  .tabbadge {
    position: absolute; top: 2px; right: 6px; background: #ef4444; color: #fff;
    border-radius: 999px; font-size: 10px; line-height: 15px; padding: 0 5px; font-weight: 600;
  }

  /* session / conversation row */
  .srow {
    display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin: 2px 10px;
    border-radius: 10px; cursor: pointer; border: 1px solid transparent;
    transition: background .15s, border-color .15s;
  }
  .srow:hover { background: #1a1d27; }
  .srow.selected { border-color: rgba(59, 130, 246, .55); background: #1a1d27; }

  /* status chip */
  .chip { font-size: 10px; font-weight: 600; letter-spacing: .4px; padding: 2px 9px; border-radius: 999px; white-space: nowrap; }
  .st-RUNNING { background: rgba(245, 158, 11, .16); color: #f59e0b; }
  .st-ACTIVE { background: rgba(59, 130, 246, .16); color: #60a5fa; }
  .st-IDLE { background: #1e222d; color: #666b7d; }

  /* unread badge nhỏ trên card */
  .ubadge { background: #ef4444; color: #fff; border-radius: 999px; font-size: 10px; line-height: 16px; padding: 0 6px; font-weight: 600; }

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
  .bub-user { align-self: flex-end; background: #3b82f6; color: #fff; border-bottom-right-radius: 6px; }
  .bub-assistant { align-self: flex-start; background: #1a1d27; border: 1px solid #262a36; color: #e4e4e7; border-bottom-left-radius: 6px; }
  .bub-tool {
    align-self: flex-start; background: rgba(139, 92, 246, .08); border: 1px solid rgba(139, 92, 246, .25);
    color: #b7a5ef; font-size: 12px; max-width: 82%;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  /* code block trong bubble */
  .codewrap { position: relative; margin: 8px 0; }
  .codelang { font-size: 11px; color: #666b7d; margin: 0 0 3px 4px; }
  .codeblock {
    background: #0b0d13; border: 1px solid #262a36; border-radius: 10px;
    padding: 10px 12px; overflow-x: auto; white-space: pre;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: #c9d1d9;
  }
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
  .md pre { background: #0b0d13; border: 1px solid #262a36; border-radius: 10px; padding: 10px 12px; overflow-x: auto; margin: 6px 0; }
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

  /* typing dots — animation duy nhất, chỉ hiện khi đang chờ */
  .tdots { display: flex; gap: 4px; align-items: center; padding: 12px 14px; }
  .tdots span { width: 6px; height: 6px; border-radius: 50%; background: #666b7d; animation: tblink 1.4s ease-in-out infinite; }
  .tdots span:nth-child(2) { animation-delay: .2s; }
  .tdots span:nth-child(3) { animation-delay: .4s; }
  @keyframes tblink { 0%, 60%, 100% { opacity: .25; } 30% { opacity: 1; } }

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
    position: fixed; left: 50%; bottom: 92px; transform: translateX(-50%); z-index: 70;
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

  /* ---- command palette DRAWER: slide-up từ dưới, translateY 200ms MỘT LẦN ---- */
  #drawerwrap { position: fixed; inset: 0; z-index: 80; pointer-events: none; }
  #drawerwrap.open { pointer-events: auto; }
  #drawerback { position: absolute; inset: 0; background: rgba(0,0,0,.55); backdrop-filter: blur(2px);
                opacity: 0; transition: opacity .2s ease; }
  #drawerwrap.open #drawerback { opacity: 1; }
  #drawer {
    position: absolute; left: 0; right: 0; bottom: 0; max-height: 78vh;
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
  .agylog {
    background: #0b0d13; border: 1px solid #262a36; border-radius: 10px; padding: 10px 12px;
    height: 280px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    line-height: 1.5; color: #c9d1d9; -webkit-overflow-scrolling: touch;
  }
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

  /* ---- sidebar desktop collapsible ---- */
  @media (min-width: 768px) {
    #sidenav { transition: width .2s ease; }
    #sidenav.collapsed { width: 52px; }
    #sidenav.collapsed .tabbtn span:not(.tabbadge) { display: none; }
    #sidenav.collapsed .tabbtn { margin: 0 6px; padding: 10px 4px; }
  }
  #collapsebtn { display: none; }
  @media (min-width: 768px) { #collapsebtn { display: flex; } }
</style>
</head>
<body class="bg-[#0f1117] text-[#e4e4e7] h-screen flex flex-col overflow-hidden text-[14px]">

<!-- ================= header ================= -->
<header class="flex items-center gap-3 px-4 py-2.5 border-b border-[#262a36] bg-[#12141c] shrink-0"
        style="padding-top:calc(env(safe-area-inset-top) + 10px)">
  <div class="w-8 h-8 rounded-[10px] bg-[#3b82f6]/15 flex items-center justify-center text-[#3b82f6] shrink-0">
    <i data-lucide="terminal" class="w-4 h-4"></i>
  </div>
  <h1 class="font-semibold text-[15px] tracking-tight whitespace-nowrap">Claude Control Center</h1>
  <span id="busyind" class="loading loading-dots loading-xs text-[#3b82f6] hidden"></span>
  <div class="ml-auto flex items-center gap-3">
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
          <div class="flex-1 min-w-0 flex items-center gap-2 bg-[#1a1d27] border border-[#262a36] rounded-[10px] px-3
                      focus-within:border-[#3b82f6]/60 transition-colors">
            <i data-lucide="search" class="w-3.5 h-3.5 text-[#666b7d] shrink-0"></i>
            <input id="searchbox" class="flex-1 min-w-0 w-full bg-transparent outline-none py-1.5 text-[13px] placeholder-[#666b7d]"
                   placeholder="Tìm session...">
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
          <div id="sessrows"></div>
          <div id="emptystate" class="hidden text-center text-[#666b7d] py-10 text-[13px]">Không có session nào khớp</div>
        </div>

        <!-- input bar -->
        <div class="relative border-t border-[#262a36] bg-[#12141c] px-3 py-3"
             style="padding-bottom:calc(env(safe-area-inset-bottom) + 12px)">
          <div class="flex items-center gap-2 flex-wrap">
            <div id="modeseg" class="seg">
              <button class="segbtn active" data-mode="">Normal</button>
              <button class="segbtn" data-mode="research">Research</button>
              <button class="segbtn" data-mode="coding">Coding</button>
              <button class="segbtn" data-mode="creative">Creative</button>
            </div>
            <!-- nút / mở command palette drawer (cmd+K) -->
            <button id="palbtn" class="w-11 h-11 rounded-xl bg-[#1a1d27] border border-[#262a36] hover:border-[#3b82f6]/60
                                        flex items-center justify-center text-[#8b8fa3] font-mono font-bold text-[15px]
                                        transition-colors shrink-0" title="Command palette (⌘K hoặc gõ /)">/</button>
            <div class="flex-1 min-w-[200px] flex items-center gap-2 bg-[#1a1d27] border border-[#262a36] rounded-xl px-3.5
                        focus-within:border-[#3b82f6]/60 transition-colors">
              <input id="taskinput" class="flex-1 bg-transparent outline-none py-2.5 text-[16px] placeholder-[#666b7d]"
                     placeholder="Giao task mới, hoặc gõ / xem lệnh...">
            </div>
            <button id="enhancebtn" class="w-11 h-11 rounded-xl bg-[#1a1d27] border border-[#262a36] hover:border-[#8b5cf6]/60
                                           flex items-center justify-center text-[#a78bfa] transition-colors shrink-0"
                    title="Enhance prompt bằng Claude">
              <i data-lucide="sparkles" class="w-4 h-4"></i>
            </button>
            <button id="sendbtn" class="w-11 h-11 rounded-xl bg-[#3b82f6] hover:bg-[#2f6fe0] flex items-center justify-center
                                        text-white transition-colors shrink-0" title="Gửi (Enter)">
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
          <span id="chatsid" class="text-[13px] font-medium text-[#a5a9b8] truncate"></span>
          <span id="chatstatus" class="chip st-IDLE">IDLE</span>
          <button id="exportbtn" class="ml-auto w-8 h-8 rounded-lg hover:bg-[#1a1d27] flex items-center justify-center text-[#8b8fa3] transition-colors"
                  onclick="exportCurrent()" title="Export session (.md / .json)"><i data-lucide="download" class="w-4 h-4"></i></button>
          <button class="w-8 h-8 rounded-lg hover:bg-[#2a1518] flex items-center justify-center text-[#ef4444] transition-colors"
                  onclick="killCurrent()" title="Kill session"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </div>
        <div id="bubbles" class="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2.5" style="scroll-behavior:smooth"></div>
        <div id="typingind" class="hidden px-4"><div class="tdots"><span></span><span></span><span></span></div></div>
        <div class="border-t border-[#262a36] bg-[#12141c] px-3 py-3"
             style="padding-bottom:calc(env(safe-area-inset-bottom) + 12px)">
          <div class="flex items-center gap-2">
            <div class="flex-1 flex items-center gap-2 bg-[#1a1d27] border border-[#262a36] rounded-xl px-3.5
                        focus-within:border-[#3b82f6]/60 transition-colors">
              <input id="chatinput" class="flex-1 bg-transparent outline-none py-2.5 text-[16px] placeholder-[#666b7d]"
                     placeholder="Nhắn tiếp (resume session)...">
            </div>
            <button id="chatsendbtn" class="w-11 h-11 rounded-xl bg-[#3b82f6] hover:bg-[#2f6fe0] flex items-center justify-center
                                            text-white transition-colors shrink-0"><i data-lucide="send" class="w-4 h-4"></i></button>
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
        <div class="border-t border-[#262a36] bg-[#12141c] px-3 py-3"
             style="padding-bottom:calc(env(safe-area-inset-bottom) + 12px)">
          <div class="flex items-center gap-2">
            <div class="flex-1 flex items-center gap-2 bg-[#1a1d27] border border-[#262a36] rounded-xl px-3.5
                        focus-within:border-[#8b5cf6]/60 transition-colors">
              <input id="hermes-input" class="flex-1 bg-transparent outline-none py-2.5 text-[16px] placeholder-[#666b7d]"
                     placeholder="Nhắn Hermes (CLI trả lời thật)...">
            </div>
            <button id="hermessendbtn" class="w-11 h-11 rounded-xl bg-[#8b5cf6] hover:bg-[#7a4de0] flex items-center justify-center
                                              text-white transition-colors shrink-0"><i data-lucide="send" class="w-4 h-4"></i></button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ TAB 3: AGY-PROXY CONFIG (gọi CLI, không tự implement proxy) ============ -->
    <div id="tab-agy" class="hidden flex-1 flex-col min-h-0 overflow-y-auto">
      <div class="p-4 flex flex-col gap-4 max-w-[1000px] w-full mx-auto"
           style="padding-bottom:calc(env(safe-area-inset-bottom) + 16px)">
        <!-- status cards -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="statcard"><div id="agy-status" class="statnum text-[#8b8fa3]">–</div><div class="statlbl">STATUS</div></div>
          <div class="statcard"><div id="agy-port" class="statnum text-[#e4e4e7]">–</div><div class="statlbl">PORT</div></div>
          <div class="statcard"><div id="agy-accounts" class="statnum text-[#60a5fa]">–</div><div class="statlbl">ACCOUNTS</div></div>
          <div class="statcard"><div id="agy-models" class="statnum text-[#a78bfa]">–</div><div class="statlbl">MODELS</div></div>
        </div>

        <!-- action buttons: touch >= 44px, gap >= 8px -->
        <div class="flex flex-wrap gap-2">
          <button id="agy-btn-start" class="agybtn" onclick="agyAction('start')">
            <i data-lucide="play" class="w-4 h-4"></i><span>Start</span></button>
          <button id="agy-btn-stop" class="agybtn agybtn-red" onclick="agyAction('stop')">
            <i data-lucide="square" class="w-4 h-4"></i><span>Stop</span></button>
          <button id="agy-btn-restart" class="agybtn" onclick="agyAction('restart')">
            <i data-lucide="rotate-cw" class="w-4 h-4"></i><span>Restart</span></button>
          <button id="agy-btn-build" class="agybtn" onclick="agyAction('run', 'build')">
            <i data-lucide="hammer" class="w-4 h-4"></i><span>Build</span></button>
          <button id="agy-btn-test" class="agybtn" onclick="agyAction('run', 'test')">
            <i data-lucide="flask-conical" class="w-4 h-4"></i><span>Test</span></button>
          <button id="agy-btn-typecheck" class="agybtn" onclick="agyAction('run', 'typecheck')">
            <i data-lucide="badge-check" class="w-4 h-4"></i><span>Typecheck</span></button>
        </div>
        <div id="agy-note" class="hidden text-[12px] text-[#d9a441] bg-[#f59e0b]/10 border border-[#f59e0b]/25 rounded-[10px] px-3 py-2">
          agy-proxy đang chạy NGOÀI dashboard — Stop/Restart chỉ áp dụng cho process do dashboard start.
        </div>

        <!-- kết quả lần chạy cuối -->
        <div class="flex flex-wrap gap-2">
          <span id="agy-last-typecheck" class="agychip">TYPECHECK: —</span>
          <span id="agy-last-test" class="agychip">TEST: —</span>
          <span id="agy-last-build" class="agychip">BUILD: —</span>
        </div>

        <!-- models từ gateway -->
        <div class="chartbox">
          <div class="text-[13px] font-semibold mb-2 text-[#a5a9b8]">Models (gateway /proxy/v1/models)</div>
          <div id="agy-modellist" class="text-[12.5px] text-[#8b8fa3] leading-relaxed break-words">–</div>
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
      <div class="p-4 flex flex-col gap-4 max-w-[1000px] w-full mx-auto">
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
      <div class="flex items-center gap-2 bg-[#1a1d27] border border-[#262a36] rounded-xl px-3.5
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
  <div id="overlaybox" class="bg-[#12141c] border border-[#262a36] rounded-2xl shadow-2xl w-[min(640px,92vw)] max-h-[80vh] flex flex-col fadein">
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
    try { Notification.requestPermission().catch(function () {}); } catch {}
  }
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
  // RUNNING -> hết RUNNING = Claude trả lời xong; chỉ notify khi KHÔNG đang mở chat đó
  const nowRunning = new Set();
  allSessions.forEach(s => { if (s.status === 'RUNNING') nowRunning.add(s.sid); });
  if (prevRunning) {
    for (const sid of prevRunning) {
      if (!nowRunning.has(sid) && !(activeTab === 'cli' && currentSid === sid)) {
        notifyDone('Claude ' + sid.slice(0, 8) + ' đã trả lời xong');
      }
    }
  }
  prevRunning = nowRunning;
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
  row.innerHTML =
    '<span class="chip s-status"></span>' +
    '<span class="s-sid text-[13px] font-medium text-[#e4e4e7]"></span>' +
    '<span class="s-proj text-[13px] text-[#8b8fa3] truncate"></span>' +
    '<span class="s-meta text-xs text-[#666b7d] ml-auto whitespace-nowrap"></span>' +
    '<span class="s-badge ubadge hidden"></span>';
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
  const st = row.querySelector('.s-status');
  setText(st, s.status);
  const stClass = 'chip s-status st-' + s.status;
  if (st.className !== stClass) st.className = stClass;
  setText(row.querySelector('.s-sid'), s.sid.slice(0, 8));
  setText(row.querySelector('.s-proj'), s.project);
  setText(row.querySelector('.s-meta'), s.msgs + ' msgs · ' + ago(s.mtimeMs));
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
    if (q && !(s.sid + ' ' + s.project).toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderList() {
  const cont = document.getElementById('sessrows');
  const sessions = filteredSessions();
  document.getElementById('emptystate').classList.toggle('hidden', sessions.length > 0);
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

async function exportChat() {
  if (!currentSid) return toast('Mở 1 session trước rồi mới /export');
  const r = await fetch('/api/history/' + currentSid).then(r => r.json());
  const NL = String.fromCharCode(10);
  let md = '# Session ' + currentSid + NL + NL;
  for (const msg of r.messages) {
    md += '**' + (msg.role === 'user' ? 'User' : 'Assistant') + '**:' + NL + NL
      + msg.content + NL + NL + '---' + NL + NL;
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

function bubbleFor(msg) {
  const b = document.createElement('div');
  const cls = msg.role === 'user' ? 'bub-user' : msg.role === 'tool' ? 'bub-tool' : 'bub-assistant';
  b.className = 'bub ' + cls + ' fadein'; // fade-in MỘT LẦN khi xuất hiện
  renderContent(b, msg.content);
  return b;
}

function openChat(sid) {
  switchTab('cli');
  if (compareSids) closeCompare(); // đang ở compare view -> đóng trước khi mở chat
  currentSid = sid;
  chatRendered = 0;
  chatTotal = 0;
  delete clearOffsets[sid];
  document.getElementById('list').classList.add('hidden');
  const chat = document.getElementById('chat');
  chat.classList.remove('hidden');
  chat.classList.add('flex');
  setText(document.getElementById('chatsid'), sid);
  document.getElementById('bubbles').innerHTML = '';
  document.getElementById('typingind').classList.add('hidden');
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
    if (r.messages.length < cmpRendered[i]) { box.innerHTML = ''; cmpRendered[i] = 0; }
    for (let k = cmpRendered[i]; k < r.messages.length; k++) box.appendChild(bubbleFor(r.messages[k]));
    if (cmpRendered[i] !== r.messages.length) {
      cmpRendered[i] = r.messages.length;
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
  box.textContent = 'Tải TOÀN BỘ history của session ' + sid.slice(0, 8)
    + ' (không giới hạn 30 message cuối), hoặc copy 30 message cuối ra clipboard.';
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
  const st = document.getElementById('chatstatus');
  setText(st, r.status);
  const stClass = 'chip st-' + r.status;
  if (st.className !== stClass) st.className = stClass;

  const box = document.getElementById('bubbles');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  // clearOffsets lưu TỔNG tuyệt đối lúc /clear; server trả window 30 cuối + total
  // -> quy đổi về vị trí trong window (fix: session >30 msg /clear xong vẫn nhận message mới)
  const total = r.total != null ? r.total : r.messages.length;
  const dropped = total - r.messages.length; // số msg cũ đã trôi khỏi window 30
  const skip = Math.max(0, (clearOffsets[currentSid] || 0) - dropped);
  const msgs = r.messages.slice(skip);
  chatTotal = total;
  // history co lại (hiếm: file bị cắt) -> render lại từ đầu
  if (msgs.length < chatRendered) { box.innerHTML = ''; chatRendered = 0; }
  // STABLE: chỉ append phần mới, không đụng bubble cũ
  for (let i = chatRendered; i < msgs.length; i++) box.appendChild(bubbleFor(msgs[i]));
  chatRendered = msgs.length;
  document.getElementById('typingind').classList.toggle('hidden', !r.typing);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function killCurrent() {
  if (currentSid) fetch('/api/kill/' + currentSid, { method: 'POST' });
}

function submitChat() {
  const inp = document.getElementById('chatinput');
  const v = inp.value.trim();
  if (!v || !currentSid) return;
  histPush('hist:chat', v);
  inp.value = '';
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

async function refreshHermes() {
  const r = await fetch('/api/hermes').then(r => r.json()).catch(() => null);
  if (!r) return;
  hermesConvos = r.conversations || [];
  let max = 0;
  hermesConvos.forEach(c => c.messages.forEach(m => { if (m.ts > max) max = m.ts; }));
  if (hermesSeenTs === 0) hermesSeenTs = max; // lần đầu: không báo unread cũ
  hermesMaxTs = max;
  if (activeTab === 'hermes') {
    hermesSeenTs = max;
    if (hermesOpenId) renderHermesChat();
    else renderHermesList();
  }
  updateBadges();
}
setInterval(refreshHermes, 4000); // poll nền: badge nhảy cả khi ở tab CLI
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
      row.onclick = () => { hermesOpenId = c.id; hermesRendered = 0; hermesExtraRendered = 0; document.getElementById('hermes-bubbles').innerHTML = ''; renderHermesChat(); };
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

// Gửi tin cho Hermes: server gọi Hermes CLI thật, reply hiển thị như assistant message
function hermesSend(text) {
  switchTab('hermes');
  if (!hermesOpenId) openHermesDirect(); // gửi từ nơi khác -> mở chat trực tiếp
  const convId = hermesOpenId;
  (hermesExtra[convId] = hermesExtra[convId] || []).push({ role: 'user', content: text });
  saveHermesExtra();
  renderHermesChat();
  document.getElementById('hermes-typing').classList.remove('hidden');
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
      document.getElementById('hermes-typing').classList.add('hidden');
    });
}
function submitHermes() {
  const inp = document.getElementById('hermes-input');
  const v = inp.value.trim();
  if (!v) return;
  histPush('hist:hermes', v);
  inp.value = '';
  hermesSend(v);
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

async function refreshAgyStatus() {
  const r = await fetch('/api/agy/status').then(r => r.json()).catch(() => null);
  if (!r) return;
  const st = document.getElementById('agy-status');
  setText(st, r.running ? 'ON' : 'OFF');
  const stCls = 'statnum ' + (r.running ? 'text-[#34d399]' : 'text-[#ef4444]');
  if (st.className !== stCls) st.className = stCls;
  setText(document.getElementById('agy-port'), String(r.port));
  setText(document.getElementById('agy-accounts'), String(r.accounts));
  setText(document.getElementById('agy-models'), String(r.models.length));
  setText(document.getElementById('agy-modellist'),
    r.models.length ? r.models.join('  ·  ') : (r.running ? '(gateway chưa trả models)' : '(agy-proxy không chạy)'));
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
  const NL = String.fromCharCode(10);
  box.appendChild(document.createTextNode(r.lines.join(NL) + NL)); // append-only, không rebuild
  agyLogNext = r.next;
  // cap DOM: quá dài thì cắt bớt đầu (log cũ đã trôi khỏi buffer server rồi)
  if (box.textContent.length > 200000) box.textContent = box.textContent.slice(-150000);
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

// PWA service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(function () {});
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
