'use client';

import { useEffect } from 'react';
import { api } from './api';

function urlB64ToU8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/* Đăng ký nhận thông báo đẩy. Tách ra khỏi usePwa để NÚT BẬT cũng gọi được:
   trước đây hàm này chỉ chạy khi quyền ĐÃ được cấp, mà chẳng chỗ nào xin quyền cả
   -> ai chưa từng cấp thì KHÔNG BAO GIỜ nhận được thông báo, dù server vẫn gửi mỗi
   khi Claude chạy xong (pushAll ở src/server/index.js:1036). */
const TAT_KEY = 'pushTat';
export const daTatPush = () => {
  try { return localStorage.getItem(TAT_KEY) === '1'; } catch { return false; }
};

/* Khoá chống chạy chồng. Đo được: bấm nút BẬT một lần mà server lưu HAI endpoint
   khác nhau — vì usePwa (chạy lúc focus) và nút bấm cùng gọi subscribe song song,
   mỗi luồng tạo một subscription riêng. Tắt thì chỉ xoá được cái mới nhất, cái kia
   đọng lại vĩnh viễn và vẫn nhận thông báo. */
let dangChay: Promise<boolean> | null = null;

// Người dùng chủ động BẬT: xoá cờ tắt rồi đăng ký.
export function batPush(): Promise<boolean> {
  try { localStorage.removeItem(TAT_KEY); } catch {}
  return dangKyPush();
}

export function dangKyPush(): Promise<boolean> {
  // Nối vào lượt đang chạy nếu có; xong thì tự nhả khoá.
  if (!dangChay) dangChay = _dangKyPush().finally(() => { dangChay = null; });
  return dangChay;
}

async function _dangKyPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window) || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const vap = await api<{ key: string }>('/api/push/vapid');
    const key = urlB64ToU8(vap.key);
    let sub = await reg.pushManager.getSubscription();
    if (sub?.options?.applicationServerKey) {
      const cur = new Uint8Array(sub.options.applicationServerKey as ArrayBuffer);
      let same = cur.length === key.length;
      for (let i = 0; same && i < key.length; i++) same = cur[i] === key[i];
      if (!same) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    return true;
  } catch { return false; }
}

/* Người dùng đã CHỦ ĐỘNG tắt thông báo. Phải ghi nhớ, vì usePwa tự đăng ký lại mỗi
   lần cửa sổ được focus — không nhớ thì vừa bấm tắt xong, chuyển tab rồi quay lại là
   nó bật lại ngay, và server đọng một đăng ký "ma" không ai xoá được. */
export async function huyPush(): Promise<void> {
  try { localStorage.setItem(TAT_KEY, '1'); } catch {}
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    // báo server TRƯỚC: unsubscribe xong thì endpoint biến mất, không còn gì để gửi lên
    await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
    await sub.unsubscribe();
  } catch {}
}

export function usePwa() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let done = false;

    const setupPush = async () => {
      if (done) return;
      if (!('PushManager' in window) || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      if (daTatPush()) return;   // người dùng đã chủ động tắt — đừng bật lại sau lưng
      // Dùng CHUNG dangKyPush (có khoá chống chạy chồng) thay vì tự đăng ký lần nữa
      done = await dangKyPush();
    };

    navigator.serviceWorker.register('/sw.js').then(setupPush).catch(() => {});
    // người dùng vừa bấm "Cho phép" ở lần tương tác nào đó -> thử lại
    const retry = () => setupPush();
    window.addEventListener('focus', retry);
    return () => window.removeEventListener('focus', retry);
  }, []);
}
