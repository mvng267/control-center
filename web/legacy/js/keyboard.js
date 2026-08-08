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
