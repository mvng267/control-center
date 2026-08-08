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
    const es = new EventSource(streamUrl());
    esRef.current = es;

    es.onmessage = (e) => {
      if (stopped) return;
      setOffline(false);
      try { setData(JSON.parse(e.data)); } catch {}
    };
    es.onopen = () => !stopped && setOffline(false);
    es.onerror = () => {
      if (stopped) return;
      setOffline(true);
      // Không có token thì server trả 401 và SSE không bao giờ mở được -> hiện màn nhập mã
      if (es.readyState === EventSource.CLOSED && !localStorage.getItem('dashToken')) {
        setUnauthorized(true);
      }
    };

    const onNet = () => setOffline(!navigator.onLine);
    window.addEventListener('offline', onNet);
    window.addEventListener('online', onNet);

    return () => {
      stopped = true;
      es.close();
      window.removeEventListener('offline', onNet);
      window.removeEventListener('online', onNet);
    };
  }, []);

  return { data, offline, unauthorized };
}
