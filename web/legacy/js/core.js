/* ================= trạng thái dùng chung giữa các file =================
   Client JS chia theo tính năng nhưng nạp bằng nhiều thẻ <script> nên DÙNG CHUNG scope.
   Biến khai báo bằng let/const trong file nạp SAU sẽ không tồn tại với file nạp TRƯỚC
   (temporal dead zone) — SSE tick sớm từng làm vỡ trang vì stream.js đọc permBusy khi
   export.js chưa nạp. Nên mọi biến dùng xuyên file khai báo hết ở đây, file đầu tiên. */
let es = null;                                   // stream.js  — EventSource
let taskinput = null;                            // palette.js — ô nhập task
let chatRendered = 0, chatTotal = 0, chatStart = -1;  // chat.js
let chatCards = new Map(), chatLastN = 0, lastDayKey = "";
let chatModel = null, chatTitle = "";            // export.js  — model + tiêu đề phiên đang mở
let compareSids = null, compareMode = false, compareSel = [];  // compare.js
let permMode = "acceptEdits", permBusy = 0, permChain = Promise.resolve();  // export.js
let hermesConvos = [], hermesMaxTs = 0, hermesSeenTs = 0;      // hermes.js
let hermesOpenId = null, hermesExtra = {};

/* ================= token truy cập =================
   Bọc fetch một lần để mọi lệnh gọi tự kèm token — khỏi sửa 26 chỗ và khỏi sót về sau.
   Token lấy từ ?t=... trên URL (link tiện mở máy khác) rồi lưu localStorage. */
let dashToken = '';
try {
  const u = new URL(location.href);
  const fromUrl = u.searchParams.get('t');
  if (fromUrl) {
    localStorage.setItem('dashToken', fromUrl);
    u.searchParams.delete('t');            // dọn URL cho khỏi lộ token trong lịch sử/chia sẻ
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  }
  dashToken = localStorage.getItem('dashToken') || '';
} catch {}

const rawFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  // chỉ gắn token cho API của chính dashboard, không đụng request ra ngoài
  if (dashToken && (url.indexOf('/api/') === 0 || url.indexOf('/stream') === 0)) {
    init = Object.assign({}, init);
    init.headers = Object.assign({}, init.headers, { 'X-Dash-Token': dashToken });
  }
  return rawFetch(input, init).then(r => {
    if (r.status === 401) askToken();       // token sai/hết -> hỏi lại
    return r;
  });
};

// Màn nhập mã: hiện khi chưa có token hoặc token sai
let tokenPromptOpen = false;
function askToken() {
  if (tokenPromptOpen) return;
  tokenPromptOpen = true;
  const box = document.getElementById('tokengate');
  if (box) box.classList.remove('hidden');
  const inp = document.getElementById('tokeninput');
  if (inp) setTimeout(() => inp.focus(), 60);
}
function saveToken() {
  const v = (document.getElementById('tokeninput').value || '').trim();
  if (!v) return;
  localStorage.setItem('dashToken', v);
  location.reload(); // nạp lại để mọi kết nối (kể cả SSE) dùng token mới
}

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
