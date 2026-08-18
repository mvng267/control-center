'use client';

import { useEffect } from 'react';
import { cn } from '@/lib/utils';

/* Sheet trượt từ đáy màn — kiểu bảng chức năng của app iOS.

   Dùng cho những chỗ mà trên điện thoại KHÔNG đủ bề ngang để bày hết nút ra. Trước
   đây khung chat nhét 4 nút chức năng + nút ảnh vào một hàng cuộn ngang: nút thứ tư
   trở đi nằm ngoài màn, phải biết là có mới vuốt đi tìm — tức là coi như không có.

   Không dùng Dialog: Dialog canh giữa màn, mà giữa màn là chỗ ngón cái với tới khó
   nhất trên điện thoại một tay. Sheet bám đáy, ngay trên chỗ vừa chạm.

   Không thư viện: cả app zero-dependency, thêm một gói chỉ để trượt một khối lên thì
   không đáng. */

export function SheetDuoi({ mo, onDong, tieuDe, children, testid }: {
  mo: boolean;
  onDong: () => void;
  tieuDe: string;
  children: React.ReactNode;
  testid?: string;
}) {
  // Esc đóng, giống mọi hộp thoại khác trong app
  useEffect(() => {
    if (!mo) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDong(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mo, onDong]);

  if (!mo) return null;

  return (
    /* z-[110]: trên cả màn giao task (z-[100]) và thanh tab dưới (z-[95]) */
    <div className="fixed inset-0 z-[110] flex flex-col justify-end" data-testid={testid}>
      {/* Nền mờ — chạm ra ngoài là đóng, thói quen chung của mọi sheet */}
      <button aria-label="Đóng" data-testid="sheet-nen"
        className="absolute inset-0 bg-black/50" onClick={onDong} />
      <div role="dialog" aria-label={tieuDe}
        className="relative max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        {/* Thanh vuốt — dấu hiệu quen thuộc rằng khối này kéo xuống được */}
        <div className="flex justify-center pb-1 pt-2.5">
          <span aria-hidden className="h-1 w-9 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="px-4 pb-1 text-[14px] font-semibold text-muted-foreground">{tieuDe}</div>
        <div className="p-2">{children}</div>
      </div>
    </div>
  );
}

/* Một dòng trong sheet: icon + nhãn + mô tả. Cao 44px trở lên để chạm không trượt. */
export function MucSheet({ Icon, nhan, mo, onClick, testid, ky }: {
  Icon: React.ComponentType<{ className?: string }>;
  nhan: string;
  mo?: string;
  onClick: () => void;
  testid?: string;
  ky?: string;
}) {
  return (
    <button type="button" onClick={onClick} data-testid={testid}
      className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left',
        'transition-colors hover:bg-accent/60 active:scale-[0.99]')}>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-[14px] font-medium">
          {nhan}
          {!!ky && <code className="rounded bg-muted px-1 py-px font-mono text-[12px] text-muted-foreground">{ky}</code>}
        </span>
        {!!mo && <span className="truncate text-[12px] text-muted-foreground">{mo}</span>}
      </span>
    </button>
  );
}
