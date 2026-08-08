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
/* ---- kéo-để-làm-mới trên danh sách session (chỉ khi đã ở đỉnh) ---- */
let ptrY = 0, ptrActive = false;
function ptrEl() { return document.getElementById('ptr'); }
document.addEventListener('touchstart', e => {
  const main = document.getElementById('main');
  ptrActive = !!(e.touches.length === 1 && main && !main.classList.contains('hidden')
    && activeTab === 'cli' && !currentSid && !compareSids && main.scrollTop <= 0);
  if (ptrActive) ptrY = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!ptrActive || !e.touches.length) return;
  const dy = e.touches[0].clientY - ptrY;
  const el = ptrEl();
  if (!el) return;
  if (dy > 24) {
    el.classList.add('on');
    // đủ xa -> đổi màu + đổi chữ báo thả tay là làm mới
    el.classList.toggle('ready', dy > 70);
    setText(el, dy > 70 ? 'thả ra để làm mới' : 'kéo xuống để làm mới');
  } else el.classList.remove('on', 'ready');
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!ptrActive) return;
  ptrActive = false;
  const el = ptrEl();
  if (!el) return;
  const fire = el.classList.contains('ready');
  el.classList.remove('on', 'ready');
  if (!fire) return;
  if (navigator.vibrate) navigator.vibrate(15);
  // SSE tự đẩy dữ liệu; nạp lại trang là cách chắc chắn nhất khi kết nối đã chết
  if (es.readyState === 2) location.reload();
  else { renderList(); toast('Đã làm mới'); }
}, { passive: true });

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
// EventSource KHÔNG gửi được custom header -> token phải đi qua query string
const es = new EventSource('/stream' + (dashToken ? '?t=' + encodeURIComponent(dashToken) : ''));
es.onerror = () => {
  if (!dashToken) askToken();       // chưa có token thì hiện màn nhập mã
  setOffline(true);                 // SSE đứt = mất kết nối tới server
};
es.onopen = () => setOffline(false);

/* ---- báo mất mạng: vỏ app vẫn mở nhờ service worker nhưng dữ liệu thì đứng im ---- */
function setOffline(off) {
  const bar = document.getElementById('offbar');
  if (!bar) return;
  const show = off || !navigator.onLine;
  if (bar.classList.contains('hidden') === !show) return; // không đổi -> khỏi đụng DOM
  bar.classList.toggle('hidden', !show);
}
window.addEventListener('offline', () => setOffline(true));
window.addEventListener('online', () => setOffline(false));
let prevRunning = null; // Set sid RUNNING tick trước — null = tick đầu (không notify session cũ)
es.onmessage = e => {
  const data = JSON.parse(e.data);
  allSessions = data.sessions || [];
  allJobs = data.jobs || [];
  // server là nguồn thật, NHƯNG đang đổi dở thì đừng để tick cũ kéo ngược lại
  if (data.perm && !permBusy) { permMode = data.perm; renderPerm(); }
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
  if (existing.join('\u0000') === projects.join('\u0000')) return;
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
    // Claude đang chạy -> Esc là DỪNG (giống CLI), chưa phải thoát ra danh sách
    if (activeTab === 'cli' && currentSid
        && !document.getElementById('typingind').classList.contains('hidden')) return stopCurrent();
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
const ICON_THINK = SVG_A + '<path d="M12 3a6 6 0 0 0-4 10.5V16a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.5A6 6 0 0 0 12 3Z"/><path d="M10 21h4"/></svg>';
const ICON_STOP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
// SVG thay vì <i data-lucide>: nút này đổi qua lại gửi/dừng, Lucide chỉ thay icon 1 lần lúc load
const ICON_SEND = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
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
  // TodoWrite -> checklist thật thay vì JSON thô
  if (p.todos && p.todos.length) {
    inner.appendChild(renderTodoList(p.todos));
    card._built = true;
    return;
  }
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

/* Phần suy nghĩ của Claude: mặc định thu gọn (không chiếm chỗ), bấm để mở.
   Claude CLI có hiện phần này; dashboard trước đây vứt hoàn toàn. */
function renderThinkCard(part) {
  const card = document.createElement('div');
  card.className = 'thinkcard fadein';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'think-head';
  head.setAttribute('aria-expanded', 'false');
  const ic = document.createElement('span');
  ic.className = 'think-ic';
  ic.innerHTML = ICON_THINK;
  const lb = document.createElement('span');
  lb.className = 'think-lbl';
  lb.textContent = 'Suy nghĩ';
  // trích 1 dòng đầu làm mồi, để đóng vẫn đoán được nội dung
  const peek = document.createElement('span');
  peek.className = 'think-peek';
  // KHÔNG dùng regex \s ở đây: template literal của server nuốt backslash -> /s+/ (thay chữ "s")
  peek.textContent = part.text.split(String.fromCharCode(10)).join(' ').slice(0, 90);
  const chev = document.createElement('span');
  chev.className = 'tcard-chev';
  chev.innerHTML = ICON_CHEV;
  head.appendChild(ic); head.appendChild(lb); head.appendChild(peek); head.appendChild(chev);

  const body = document.createElement('div');
  body.className = 'tcard-body';
  const inner = document.createElement('div');
  inner.className = 'tinner think-body';
  body.appendChild(inner);
  head.onclick = () => {
    const open = card.classList.toggle('open');
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && !card._built) { inner.appendChild(mdToNode(part.text)); card._built = true; }
  };
  card.appendChild(head);
  card.appendChild(body);
  return card;
}

/* Checklist TodoWrite: hiện việc thật + tiến độ, thay vì đổ JSON thô ra khối code */
function renderTodoList(todos) {
  const box = document.createElement('div');
  box.className = 'tsec todobox';
  const done = todos.filter(t => t.status === 'completed').length;
  const head = document.createElement('div');
  head.className = 'todohead';
  const lb = document.createElement('span');
  lb.className = 'tlbl';
  lb.textContent = 'CÔNG VIỆC';
  const cnt = document.createElement('span');
  cnt.className = 'todocount';
  cnt.textContent = done + '/' + todos.length;
  head.appendChild(lb); head.appendChild(cnt);
  box.appendChild(head);
  const bar = document.createElement('div');
  bar.className = 'todobar';
  const fill = document.createElement('span');
  fill.style.width = (todos.length ? done / todos.length * 100 : 0) + '%';
  bar.appendChild(fill);
  box.appendChild(bar);
  const list = document.createElement('div');
  list.className = 'todolist';
  for (const t of todos) {
    const row = document.createElement('div');
    row.className = 'todoitem td-' + t.status;
    const mark = document.createElement('span');
    mark.className = 'todomark';
    mark.innerHTML = t.status === 'completed' ? ICON_OK : (t.status === 'in_progress' ? ICON_RUN : '');
    const tx = document.createElement('span');
    tx.className = 'todotext';
    tx.textContent = t.text;
    row.appendChild(mark); row.appendChild(tx);
    list.appendChild(row);
  }
  box.appendChild(list);
  return box;
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
    if (navigator.vibrate) navigator.vibrate(10); // phản hồi chạm nhẹ như app native
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
  // 'think' cũng phải đi nhánh parts: msg.content không chứa thinking (flattenParts bỏ nó)
  const hasTool = msg.parts && msg.parts.some(p => p.t === 'tool' || p.t === 'think');
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
      } else if (p.t === 'think') {
        w.appendChild(renderThinkCard(p));
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
  chatModel = (known && known.model) || null;
  renderChatModel();
  document.getElementById('bubbles').innerHTML = '';
  document.getElementById('typingind').classList.add('hidden');
  document.getElementById('chaterr').classList.add('hidden');
  setChatRunning(false); // phiên mới: nút về trạng thái gửi cho tới khi poll xác nhận
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
  const id = (hermesOpenId === '__direct__' ? 'direct' : String(hermesOpenId).slice(0, 12)).replace(/[^\w.-]/g, '_');
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
  setChatRunning(r.status === 'RUNNING'); // đang chạy -> nút gửi thành nút Dừng
  // lỗi chạy Claude (resume trượt...) -> hiện rõ, đừng để user tưởng đã gửi được
  const ce = document.getElementById('chaterr');
  if (r.error) { setText(ce, r.error); ce.classList.remove('hidden'); }
  else ce.classList.add('hidden');
  if (r.model !== undefined && r.model !== chatModel) { chatModel = r.model; renderChatModel(); }
  // chờ duyệt kế hoạch -> hiện thanh Duyệt/Sửa (rung nhẹ 1 lần khi vừa xuất hiện)
  const ap = document.getElementById('chatapprove');
  const wasHidden = ap.classList.contains('hidden');
  ap.classList.toggle('hidden', !r.awaiting);
  if (r.awaiting && wasHidden && navigator.vibrate) navigator.vibrate(30);
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
  plan: { label: 'Duyệt trước', cls: 'p-plan', toast: 'Claude trình bày kế hoạch rồi chờ bạn bấm Duyệt mới làm' },
  bypassPermissions: { label: 'Bỏ mọi kiểm tra', cls: 'p-bypass', toast: 'CẨN THẬN: bỏ qua MỌI kiểm tra quyền, kể cả lệnh nguy hiểm' },
};
const PERM_CYCLE = ['acceptEdits', 'plan', 'default', 'bypassPermissions'];
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

let permBusy = 0;      // >0 = đang chờ server xác nhận -> SSE tick cũ không được ghi đè
let permChain = Promise.resolve(); // xếp hàng: bấm nhanh 2 lần vẫn nhảy đúng 2 nấc
function cyclePerm() {
  const next = PERM_CYCLE[(PERM_CYCLE.indexOf(permMode) + 1) % PERM_CYCLE.length];
  permMode = next;
  permBusy++;
  renderPerm();
  permChain = permChain.then(() =>
    fetch('/api/perm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    }).then(r => r.json()).then(r => {
      // chỉ nhận kết quả của lượt CUỐI, tránh phản hồi cũ kéo ngược trạng thái
      if (r.mode && permBusy === 1) { permMode = r.mode; renderPerm(); }
      toast(PERM_UI[permMode].toast);
    }).catch(() => toast('Không đổi được chế độ quyền'))
      .finally(() => { permBusy--; }));
  return permChain;
}

/* ---- model riêng từng phiên: /model đổi TOÀN CỤC nên phiên khác dính theo ---- */
let chatModel = null; // model riêng của phiên đang mở (null = theo model toàn cục)
function renderChatModel() {
  const el = document.getElementById('chatmodel');
  if (!el) return;
  setText(el, chatModel || 'model: mặc định');
  const cls = 'modelchip' + (chatModel ? ' set' : '');
  if (el.className !== cls) el.className = cls;
}
function pickSessionModel() {
  if (!currentSid) return;
  const sid = currentSid;
  const box = document.createElement('div');
  box.className = 'flex flex-col gap-2';
  const hint = document.createElement('div');
  hint.className = 'text-[12px] text-[#7f8598] leading-relaxed';
  hint.textContent = 'Chỉ áp dụng cho phiên này. Chọn "Mặc định" để dùng lại model chung.';
  box.appendChild(hint);
  const apply = mv => {
    fetch('/api/model/' + sid, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: mv }),
    }).then(r => r.json()).then(r => {
      if (currentSid === sid) { chatModel = r.model || null; renderChatModel(); }
      const s = allSessions.find(x => x.sid === sid);
      if (s) s.model = r.model || null;
      closeOverlay();
      toast(r.model ? 'Phiên này dùng ' + r.model : 'Phiên này dùng model mặc định');
    }).catch(() => toast('Không đổi được model'));
  };
  const btns = MODELS.concat(['default']).map(mv => {
    const b = document.createElement('button');
    b.className = 'agybtn' + (chatModel === mv ? ' agybtn-on' : '');
    b.textContent = mv === 'default' ? 'Mặc định' : mv;
    b.onclick = () => apply(mv === 'default' ? '' : mv);
    return b;
  });
  const row = document.createElement('div');
  row.className = 'flex flex-wrap gap-2';
  btns.forEach(b => row.appendChild(b));
  box.appendChild(row);
  showOverlay('Model cho phiên này', box, [overlayButton('Đóng', closeOverlay)]);
}

/* ---- đính kèm ảnh: chọn -> thu nhỏ nếu quá lớn -> upload -> chèn đường dẫn vào prompt.
   Claude CLI đọc ảnh bằng tool Read nên chỉ cần đưa nó đường dẫn trên đĩa. ---- */
let attachments = []; // [{path, name, thumb}]

// Ảnh iPhone 12MP ~4-6MB, gửi thẳng thì nặng và chậm qua Tailscale -> thu nhỏ cạnh dài
// về 1600px, xuất JPEG chất lượng 0.85. Đủ nét để Claude đọc chữ trong ảnh chụp màn hình.
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('không đọc được file'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(fr.result); // định dạng lạ (HEIC…) -> gửi nguyên bản
      img.onload = () => {
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        if (scale === 1 && fr.result.length < 3e6) return resolve(fr.result);
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        try { resolve(cv.toDataURL('image/jpeg', 0.85)); } catch { resolve(fr.result); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

async function pickImage(input) {
  const file = input.files && input.files[0];
  input.value = ''; // reset để chọn lại đúng ảnh đó vẫn kích hoạt onchange
  if (!file) return;
  // dùng indexOf thay regex: dấu gạch chéo ngược trong template literal của server bị nuốt
  if (String(file.type || '').indexOf('image/') !== 0) return toast('Chỉ gửi được ảnh');
  toast('Đang xử lý ảnh…');
  let data;
  try { data = await shrinkImage(file); } catch { return toast('Không đọc được ảnh'); }
  const r = await fetch('/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  }).then(x => x.json()).catch(() => null);
  if (!r || !r.ok) return toast('Gửi ảnh lỗi: ' + ((r && r.error) || '?'));
  attachments.push({ path: r.path, name: file.name || r.name, thumb: data });
  renderAttachments();
  if (navigator.vibrate) navigator.vibrate(10);
}

function renderAttachments() {
  const bar = document.getElementById('attachbar');
  bar.innerHTML = '';
  bar.classList.toggle('hidden', !attachments.length);
  attachments.forEach((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'attachchip';
    const im = document.createElement('img');
    im.src = a.thumb; im.alt = '';
    const nm = document.createElement('span');
    nm.className = 'axname';
    nm.textContent = a.name;
    const x = document.createElement('button');
    x.className = 'attachx';
    x.textContent = '✕';
    x.title = 'Bỏ ảnh này';
    x.onclick = () => { attachments.splice(i, 1); renderAttachments(); };
    chip.appendChild(im); chip.appendChild(nm); chip.appendChild(x);
    bar.appendChild(chip);
  });
}

// Ghép đường dẫn ảnh vào cuối prompt rồi xoá khay đính kèm
function consumeAttachments(text) {
  if (!attachments.length) return text;
  const NL = String.fromCharCode(10);
  const list = attachments.map(a => a.path).join(NL);
  attachments = [];
  renderAttachments();
  return (text ? text + NL + NL : '') + 'Ảnh đính kèm:' + NL + list;
}

/* ---- /cost: token đã dùng của phiên (đọc từ JSONL, không gọi CLI) ---- */
function showCost() {
  if (!currentSid) return toast('Mở 1 session trước rồi mới /cost');
  fetch('/api/history/' + currentSid).then(r => r.json()).then(r => {
    const u = r.usage;
    if (!u || !u.turns) return toast('Phiên này chưa có dữ liệu token');
    const box = document.createElement('div');
    box.className = 'flex flex-col gap-2 text-[13px]';
    const row = (k, v, dim) => {
      const d = document.createElement('div');
      d.className = 'flex justify-between gap-4' + (dim ? ' text-[#7f8598]' : '');
      const a = document.createElement('span'); a.textContent = k;
      const b = document.createElement('span'); b.className = 'tabular-nums'; b.textContent = v;
      d.appendChild(a); d.appendChild(b);
      return d;
    };
    // cache_read rẻ hơn nhiều so với input thường -> tách riêng cho khỏi hiểu nhầm
    box.appendChild(row('Số lượt', String(u.turns)));
    box.appendChild(row('Token gửi đi', shortNum(u.inTok)));
    box.appendChild(row('Token nhận về', shortNum(u.outTok)));
    box.appendChild(row('Đọc từ cache', shortNum(u.cacheRead), true));
    box.appendChild(row('Ghi vào cache', shortNum(u.cacheWrite), true));
    const note = document.createElement('div');
    note.className = 'text-[11.5px] text-[#7f8598] leading-relaxed mt-1 pt-2 border-t border-[#262a36]';
    note.textContent = 'Token đọc từ cache rẻ hơn nhiều so với token gửi mới, nên con số lớn ở dòng đó là bình thường.';
    box.appendChild(note);
    showOverlay('Token đã dùng — ' + (chatTitle || currentSid.slice(0, 8)), box,
      [overlayButton('Đóng', closeOverlay, true)]);
  }).catch(() => toast('Không đọc được dữ liệu token'));
}

/* ---- /compact: nhờ Claude tóm tắt ngữ cảnh khi hội thoại quá dài ---- */
function compactSession() {
  if (!currentSid) return toast('Mở 1 session trước rồi mới /compact');
  fetch('/api/chat/' + currentSid, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '/compact' }),
  }).then(r => r.json()).then(r => {
    if (r.ok) { toast('Đang dọn ngữ cảnh…'); refreshChat(); }
    else toast('Lỗi: ' + (r.error || '?'));
  }).catch(() => toast('Không chạy được /compact'));
}

/* ---- dừng Claude giữa chừng (nút ⏹, /stop, hoặc Esc khi đang chạy).
   Uỷ quyền cho stopChat() — bản đó cập nhật cả trạng thái nút gửi. ---- */
function stopCurrent() {
  if (!currentSid) return;
  if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  stopChat();
}

/* ---- duyệt kế hoạch: chạy tiếp lượt đang chờ, lần này cho phép sửa file ---- */
function approvePlan() {
  if (!currentSid) return;
  const sid = currentSid;
  const ap = document.getElementById('chatapprove');
  ap.classList.add('hidden'); // ẩn ngay cho khỏi bấm 2 lần
  fetch('/api/approve/' + sid, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).then(r => r.json()).then(r => {
    if (r.ok) { toast('Đã duyệt — Claude đang thực hiện'); refreshChat(); }
    else { toast('Không duyệt được: ' + (r.error || '?')); ap.classList.remove('hidden'); }
  }).catch(() => { toast('Không duyệt được'); ap.classList.remove('hidden'); });
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

/* Nút gửi hoá thành nút DỪNG khi Claude đang chạy — tương đương Esc trong Claude CLI.
   Trước đây đang chạy mà bấm gửi thì server trả 409 "session is busy", không có cách nào
   ngắt ngoài nút thùng rác (nhìn như xoá phiên, chẳng ai dám bấm). */
let chatRunning = false;
function setChatRunning(on) {
  if (chatRunning === on) return;
  chatRunning = on;
  const b = document.getElementById('chatsendbtn');
  if (!b) return;
  b.classList.toggle('stopbtn', on);
  b.classList.toggle('sendgrad', !on);
  b.innerHTML = on ? ICON_STOP : ICON_SEND;
  b.title = on ? 'Dừng Claude (đang chạy)' : 'Gửi';
  b.setAttribute('aria-label', b.title);
}

function submitChat() {
  if (chatRunning) return stopChat();
  const inp = document.getElementById('chatinput');
  const v = inp.value.trim();
  // có ảnh đính kèm thì gửi được dù chưa gõ chữ nào
  if ((!v && !attachments.length) || !currentSid) return;
  if (v) histPush('hist:chat', v);
  inp.value = '';
  scrollChatsToEnd(); // tin mới gửi phải visible ngay, kể cả khi bàn phím đang bật
  if (v && v[0] === '/') return routeSlash(v);
  const msg = consumeAttachments(v); // ghép đường dẫn ảnh vào cuối prompt
  fetch('/api/chat/' + currentSid, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg }),
  }).then(r => r.json())
    .then(r => {
      // 409 session busy / lỗi khác: trả lại tin nhắn vào input, không mất im lặng
      if (r && r.error) { inp.value = v; toast('Không gửi được: ' + r.error); }
      refreshChat();
    })
    .catch(e => { inp.value = v; toast('Lỗi mạng: ' + e.message); });
}
function stopChat() {
  if (!currentSid) return;
  const sid = currentSid;
  fetch('/api/kill/' + sid, { method: 'POST' })
    .then(r => r.json())
    .then(r => {
      if (r && r.error) return toast('Không dừng được: ' + r.error);
      toast('Đã dừng Claude');
      setChatRunning(false);
      refreshChat();
    })
    .catch(e => toast('Lỗi mạng: ' + e.message));
}
document.getElementById('chatinput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submitChat(); });
document.getElementById('chatsendbtn').addEventListener('click', submitChat);
document.getElementById('chatsendbtn').innerHTML = ICON_SEND; // trạng thái ban đầu: gửi

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
