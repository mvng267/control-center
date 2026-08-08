'use client';

import { useEffect, useRef, useState } from 'react';

/* Cử chỉ cảm ứng cho iPhone: kéo-để-làm-mới và vuốt ngang chuyển tab.
   Chỉ gắn khi có cảm ứng — chuột không kích hoạt nhầm. */

const PULL_TRIGGER = 70;   // kéo quá ngưỡng này mới làm mới
const PULL_MAX = 110;      // kéo thêm nữa cũng không dài ra (cản đàn hồi)
const SWIPE_MIN = 60;      // vuốt ngang tối thiểu để tính là chuyển tab
const SWIPE_SLOPE = 1.6;   // ngang phải dài hơn dọc chừng này, tránh cướp cú cuộn

export function usePullToRefresh(onRefresh: () => void | Promise<void>) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  // Giữ trong ref chứ không đọc state trong handler: effect chỉ gắn listener MỘT LẦN,
  // nên closure sẽ nhìn thấy giá trị của lần render đầu (luôn 0) và không bao giờ
  // đạt ngưỡng. Đưa cả onRefresh vào ref để effect không phải chạy lại giữa cú kéo.
  const st = useRef({ y0: 0, box: null as HTMLElement | null, active: false, pull: 0, busy: false });
  const cb = useRef(onRefresh);
  cb.current = onRefresh;
  st.current.busy = busy;

  useEffect(() => {
    if (!('ontouchstart' in window)) return;

    const scroller = (el: HTMLElement | null): HTMLElement | null => {
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (/auto|scroll/.test(cs.overflowY) && n.scrollHeight > n.clientHeight) return n;
      }
      return null;
    };

    const onStart = (e: TouchEvent) => {
      if (st.current.busy || e.touches.length !== 1) return;
      const box = scroller(e.target as HTMLElement);
      // Chỉ bắt đầu khi vùng cuộn ĐANG Ở ĐỈNH, nếu không sẽ cướp cú cuộn bình thường
      if (box && box.scrollTop > 0) return;
      st.current.y0 = e.touches[0].clientY;
      st.current.box = box;
      st.current.active = true;
      st.current.pull = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!st.current.active) return;
      const dy = e.touches[0].clientY - st.current.y0;
      if (dy <= 0) { st.current.pull = 0; setPull(0); return; }
      if (st.current.box && st.current.box.scrollTop > 0) {
        st.current.active = false; st.current.pull = 0; setPull(0); return;
      }
      // cản đàn hồi: kéo càng xa càng nặng, giống cảm giác iOS
      const v = Math.min(PULL_MAX, dy * 0.5);
      st.current.pull = v;
      setPull(v);
    };

    const onEnd = async () => {
      if (!st.current.active) return;
      st.current.active = false;
      const reached = st.current.pull >= PULL_TRIGGER;
      st.current.pull = 0;
      setPull(0);
      if (!reached || st.current.busy) return;
      st.current.busy = true;
      setBusy(true);
      navigator.vibrate?.(12);
      try { await cb.current(); } finally { setTimeout(() => setBusy(false), 400); }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);   // gắn MỘT LẦN — mọi giá trị thay đổi đọc qua ref ở trên

  return { pull, busy };
}

export function useSwipeTabs(onSwipe: (dir: 1 | -1) => void) {
  // onSwipe là hàm mới mỗi lần render (nó đóng trên tab/openSid). Nếu để nó làm
  // dependency thì listener bị gỡ/gắn lại liên tục và cú vuốt đang dở mất touchstart.
  const cb = useRef(onSwipe);
  cb.current = onSwipe;

  useEffect(() => {
    if (!('ontouchstart' in window)) return;
    let x0 = 0, y0 = 0, ok = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.target as HTMLElement;
      // Bỏ qua khi vuốt trên thứ tự nó cuộn ngang được (bảng, khối code) hoặc
      // trên ô nhập — nếu không sẽ cướp thao tác chọn chữ.
      if (t.closest('input, textarea, [data-no-swipe], pre, table')) { ok = false; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; ok = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (!ok) return;
      ok = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * SWIPE_SLOPE) return;
      navigator.vibrate?.(8);
      cb.current(dx < 0 ? 1 : -1);   // vuốt sang trái = sang tab kế tiếp
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, []);   // gắn MỘT LẦN — onSwipe mới nhất đọc qua ref
}
