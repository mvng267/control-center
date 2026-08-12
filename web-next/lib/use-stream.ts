'use client';

import { useEffect, useRef, useState } from 'react';
import { streamUrl } from './api';
import type { StreamData } from './types';

// SSE /stream: server đẩy danh sách phiên + jobs mỗi 2s.
// Trả thêm `offline` để hiện banner khi kết nối đứt (app vẫn mở nhờ service worker,
// nhưng dữ liệu thì đứng im — phải nói rõ cho người dùng biết).
export function useStream() {
  const [data, setData] = useState<StreamData | null>(null);
  const [offline, setOffline] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let stopped = false;
    /* withCredentials BẮT BUỘC khi đã đặt mã khoá. EventSource mặc định KHÔNG gửi
       cookie, mà cookie `dashUnlock` chính là thứ chứng minh đã mở khoá — thiếu nó
       thì /stream bị chặn ở cổng mã khoá (423), SSE đứt ngay rồi thử lại vô hạn:
       trên iPhone nhìn ra "mất kết nối" liên tục dù server vẫn chạy bình thường.
       Không lộ ra khi chạy ở localhost vì loopback được miễn cả token lẫn mã khoá —
       đúng loại lỗi chỉ hiện khi vào từ máy khác. */
    const es = new EventSource(streamUrl(), { withCredentials: true });
    esRef.current = es;

    /* CHỜ 8 GIÂY rồi mới báo mất kết nối, đừng báo ngay khi onerror bắn.
       EventSource TỰ nối lại sau mỗi lần đứt, thường xong trong 1-2 giây. Qua
       Tailscale thì gián đoạn ngắn là chuyện thường — đo thật khi giữ 3 phút: 90/90
       snapshot về đủ, nhưng có một nhịp chậm 10,8s. Báo ngay lập tức thì banner
       "mất kết nối" nhấp nháy liên tục dù dữ liệu vẫn về đều, còn người dùng thì
       tưởng server hỏng. Ngưỡng 8s: dài hơn một lần nối lại bình thường, ngắn hơn
       mức người dùng kịp sốt ruột. */
    let henBao: ReturnType<typeof setTimeout> | null = null;
    const huyBao = () => { if (henBao) { clearTimeout(henBao); henBao = null; } };
    const noiLai = () => { huyBao(); setOffline(false); };

    es.onmessage = (e) => {
      if (stopped) return;
      noiLai();
      try { setData(JSON.parse(e.data)); } catch {}
    };
    es.onopen = () => !stopped && noiLai();
    es.onerror = () => {
      if (stopped) return;
      // Không có token thì server trả 401 và SSE không bao giờ mở được -> hiện màn
      // nhập mã NGAY, đây là lỗi thật chứ không phải mạng chập chờn.
      if (es.readyState === EventSource.CLOSED && !localStorage.getItem('dashToken')) {
        huyBao();
        setOffline(true);
        setUnauthorized(true);
        return;
      }
      if (!henBao) henBao = setTimeout(() => { if (!stopped) setOffline(true); }, 8000);
    };

    const onNet = () => setOffline(!navigator.onLine);
    window.addEventListener('offline', onNet);
    window.addEventListener('online', onNet);

    return () => {
      stopped = true;
      huyBao();   // đừng để hẹn giờ bắn sau khi component đã rời đi
      es.close();
      window.removeEventListener('offline', onNet);
      window.removeEventListener('online', onNet);
    };
  }, []);

  return { data, offline, unauthorized };
}
