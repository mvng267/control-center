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
