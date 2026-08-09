'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { batPush, huyPush } from '@/lib/use-pwa';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* Nút bật/tắt thông báo đẩy.

   Vì sao cần: server VẪN gửi thông báo mỗi khi Claude chạy xong (pushAll —
   src/server/index.js:1036), nhưng giao diện mới KHÔNG CÓ CHỖ NÀO xin quyền
   (`Notification.requestPermission` không xuất hiện ở đâu trong web-next). Hệ quả:
   ai chưa từng cấp quyền từ bản cũ thì không bao giờ nhận được gì — tính năng coi
   như chết. Bản legacy có xin, ở lần chạm đầu tiên (notify.js:11-14).

   Trình duyệt bắt buộc requestPermission phải nằm trong một cú bấm thật của người
   dùng, nên không thể tự xin lúc tải trang. */

type TT = 'chua-ho-tro' | 'tat' | 'bat' | 'chan';

export function NotifyToggle() {
  const [tt, setTt] = useState<TT>('chua-ho-tro');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('Notification' in window) || !('PushManager' in window)) { setTt('chua-ho-tro'); return; }
    if (Notification.permission === 'denied') { setTt('chan'); return; }
    if (Notification.permission !== 'granted') { setTt('tat'); return; }
    // đã cấp quyền: còn phải xem có subscription thật không
    navigator.serviceWorker?.ready
      .then((r) => r.pushManager.getSubscription())
      .then((s) => setTt(s ? 'bat' : 'tat'))
      .catch(() => setTt('tat'));
  }, []);

  if (tt === 'chua-ho-tro') return null;

  const bam = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (tt === 'bat') {
        await huyPush();
        setTt('tat');
        toast('Đã tắt thông báo');
        return;
      }
      if (Notification.permission === 'denied') {
        toast.error('Trình duyệt đang chặn — mở Cài đặt trang để bật lại');
        return;
      }
      if (Notification.permission !== 'granted') {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          setTt(perm === 'denied' ? 'chan' : 'tat');
          toast.error('Chưa được cấp quyền thông báo');
          return;
        }
      }
      const ok = await batPush();
      setTt(ok ? 'bat' : 'tat');
      toast[ok ? 'success' : 'error'](ok
        ? 'Đã bật — sẽ báo khi Claude chạy xong'
        : 'Không đăng ký được, thử lại sau');
      if (ok) navigator.vibrate?.(12);
    } finally { setBusy(false); }
  };

  const Icon = tt === 'bat' ? BellRing : tt === 'chan' ? BellOff : Bell;

  return (
    <Button variant="ghost" size="icon" className={cn('tap44 size-8', tt === 'bat' && 'text-primary')}
      onClick={bam} disabled={busy} data-testid="notify-toggle" data-state={tt}
      title={tt === 'bat' ? 'Đang bật thông báo — bấm để tắt'
        : tt === 'chan' ? 'Trình duyệt đang chặn thông báo'
          : 'Bật thông báo khi Claude chạy xong'}
      aria-label="Bật tắt thông báo">
      <Icon className="size-4" />
    </Button>
  );
}
