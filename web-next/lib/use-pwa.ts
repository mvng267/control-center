'use client';

import { useEffect } from 'react';
import { api } from './api';

function urlB64ToU8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Đăng ký service worker (để offline + Web Push) rồi đăng ký nhận push.
// Chỉ chạy khi người dùng ĐÃ cho phép thông báo — không tự hỏi để khỏi phiền.
export function usePwa() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let done = false;

    const setupPush = async () => {
      if (done) return;
      if (!('PushManager' in window) || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      done = true;
      try {
        const reg = await navigator.serviceWorker.ready;
        const vap = await api<{ key: string }>('/api/push/vapid');
        const key = urlB64ToU8(vap.key);
        let sub = await reg.pushManager.getSubscription();
        // server đổi khoá VAPID -> subscription cũ vô dụng, huỷ rồi đăng ký lại
        if (sub?.options?.applicationServerKey) {
          const cur = new Uint8Array(sub.options.applicationServerKey as ArrayBuffer);
          let same = cur.length === key.length;
          for (let i = 0; same && i < key.length; i++) same = cur[i] === key[i];
          if (!same) { await sub.unsubscribe(); sub = null; }
        }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
      } catch {
        done = false; // push service chưa sẵn -> thử lại lần sau
      }
    };

    navigator.serviceWorker.register('/sw.js').then(setupPush).catch(() => {});
    // người dùng vừa bấm "Cho phép" ở lần tương tác nào đó -> thử lại
    const retry = () => setupPush();
    window.addEventListener('focus', retry);
    return () => window.removeEventListener('focus', retry);
  }, []);
}
