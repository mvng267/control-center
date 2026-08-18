'use client';

import { cn } from '@/lib/utils';

/* Nút chọn phân đoạn — dựng theo số đo thật của Atlas (/reports, nút 3M/6M/12M):
     vỏ ngoài   bg-muted, bo 10px
     nút chọn   nền bằng màu nền trang, bo 8px, cao 25px, chữ 14px/500, bóng nhẹ
     không chọn chữ mờ (~60%), nền trong suốt
   Trước đây mỗi nơi tự vẽ một kiểu: task-bar dùng nền xanh đậm bo 6px chữ 12.5px —
   lệch hẳn mẫu. Gom về một chỗ để mọi tab trông như một hệ. */

export interface SegItem<T extends string> {
  id: T;
  label: string;
  title?: string;
}

export function Segmented<T extends string>({
  items, value, onChange, testid, className, size = 'md',
}: {
  items: readonly SegItem<T>[];
  value: T;
  onChange: (id: T) => void;
  testid?: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div data-testid={testid}
      /* max-w-full + overflow-x-auto NGAY TRÊN vỏ: nếu để vùng cuộn ở div cha thì
         vỏ này (inline-flex shrink-0) kẹp theo bề rộng cha, các nút shrink-0 tràn RA
         NGOÀI vỏ chứ không làm cha cuộn được. Đo trên iPhone 390px: nút cuối chạm
         290px trong khi khung chỉ tới 170px — bị cắt 120px, ngón tay không với tới. */
      style={{ scrollbarWidth: 'none' }}
      className={cn('inline-flex max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-[10px] bg-muted p-0.5',
        className)}>
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button key={it.id} type="button" onClick={() => onChange(it.id)} title={it.title || it.label}
            data-testid={testid ? `${testid}-${it.id || 'mac-dinh'}` : undefined} data-active={on}
            className={cn(
              'tap44 shrink-0 rounded-[8px] px-2.5 transition-colors',
              size === 'sm' ? 'h-[25px] text-[14px]' : 'h-[25px] text-[14px]',
              on
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
