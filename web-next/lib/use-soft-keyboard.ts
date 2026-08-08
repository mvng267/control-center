'use client';

import { useEffect } from 'react';

/* Bàn phím ảo iOS/Android — PORT NGUYÊN thuật toán từ web/legacy/js/keyboard.js.
   Logic này đã sửa qua nhiều vòng trên iPhone thật (commit 707aa83), nên giữ y hệt:
   chỉ đổi cách gắn vào DOM cho hợp React, KHÔNG chỉnh số liệu hay điều kiện.

   Vì sao cần: khi bàn phím bật, layout viewport của iOS GIỮ NGUYÊN kích thước
   (chỉ visualViewport co lại) -> đáy trang, tức ô nhập, nằm sau bàn phím.
   Đo phần bị che rồi bơm vào --kb để CSS đẩy ô nhập lên trên bàn phím. */

const SCROLL_BOXES = ['chat-bubbles', 'hermes-bubbles'];

function scrollChatsToEnd() {
  for (const id of SCROLL_BOXES) {
    const box = document.querySelector<HTMLElement>(`[data-testid=${id}]`);
    if (box) box.scrollTop = box.scrollHeight;
  }
}

export function useSoftKeyboard() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;              // trình duyệt cũ: giữ hành vi như trước

    let raf = 0;
    const apply = () => {
      raf = 0;
      // phần layout viewport bị bàn phím che ở đáy; offsetTop bù việc iOS đẩy trang lên
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      // <80px không phải bàn phím (thanh URL co giãn / bounce) -> không đụng layout.
      // Android interactive-widget=resizes-content: innerHeight tự co -> kb≈0, cũng đúng.
      const open = kb > 80;
      document.documentElement.style.setProperty('--kb', (open ? Math.round(kb) : 0) + 'px');
      document.body.classList.toggle('kb-open', open);
      if (open) scrollChatsToEnd();  // viewport co lại -> giữ tin mới nhất trong tầm nhìn
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(apply); };

    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);

    // Focus ô nhập -> đợi bàn phím bật + padding áp xong (iOS animate ~250ms) rồi đưa
    // ô nhập vào tầm nhìn. Dùng capture vì focus không nổi bọt.
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || !el.matches('input, textarea')) return;
      setTimeout(() => { el.scrollIntoView({ block: 'end' }); scrollChatsToEnd(); }, 250);
    };
    document.addEventListener('focusin', onFocus);

    apply();
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      document.removeEventListener('focusin', onFocus);
      if (raf) cancelAnimationFrame(raf);
      document.body.classList.remove('kb-open');
      document.documentElement.style.setProperty('--kb', '0px');
    };
  }, []);
}
