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
