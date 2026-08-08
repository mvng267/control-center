/* ================= commands + palette ================= */

const MODE_PREFIX = {
  research: 'Bạn là trợ lý nghiên cứu. Tìm kiếm, trích dẫn nguồn uy tín, phân tích khách quan.\n\n',
  coding: 'Bạn là senior engineer. Viết code sạch, có test, tuân thủ best practice.\n\n',
  creative: 'Bạn là writer sáng tạo. Viết engaging, có voice riêng.\n\n',
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
  { cmd: '/cost', icon: 'coins', desc: 'Token đã dùng của session đang mở', tag: 'claude', noargs: true },
  { cmd: '/compact', icon: 'fold-vertical', desc: 'Dọn ngữ cảnh khi hội thoại quá dài', tag: 'claude', noargs: true },
  { cmd: '/stop', icon: 'square', desc: 'Dừng Claude đang chạy (hoặc bấm Esc)', tag: 'claude', noargs: true },
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
  const q = palfilter.value.trim().toLowerCase().replace(/^\//, '');
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

taskinput = document.getElementById('taskinput');
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
  const cmd = raw.slice(1).split(/\s+/)[0].toLowerCase();
  const rest = raw.slice(1 + cmd.length).trim();
  if (cmd === 'help') return showHelp();
  if (cmd === 'theme') return toggleTheme();
  if (cmd === 'clear') return clearChatLocal();
  if (cmd === 'model') return setModel(rest);
  if (cmd === 'export') return exportCurrent();
  if (cmd === 'cost') return showCost();
  if (cmd === 'compact') return compactSession();
  if (cmd === 'stop') return stopCurrent();
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
    if (p.t === 'think') return '> 💭 _Suy nghĩ:_ ' + p.text.split(NL).join(NL + '> ');
    if (p.todos && p.todos.length) {
      return '> ✅ **Todos**' + NL + NL + p.todos.map(t =>
        '- [' + (t.status === 'completed' ? 'x' : ' ') + '] ' + t.text
        + (t.status === 'in_progress' ? ' _(đang làm)_' : '')).join(NL);
    }
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
  const sp = rest.split(/\s+/);
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
  const sp = rest.split(/\s+/);
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
