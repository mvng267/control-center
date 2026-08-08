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
