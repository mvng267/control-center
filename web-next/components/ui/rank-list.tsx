'use client';

import { cn } from '@/lib/utils';

/* Bảng xếp hạng kiểu Atlas ("Revenue by channel" ở /reports). Đo được:
     hàng cao 34px · nhãn chữ 14px · giá trị bên phải · % mờ theo sau
     thanh mảnh 6px BO TRÒN nằm DƯỚI nhãn, mỗi hàng một màu
   Mẫu cũ trong agy-tab tô nền mờ cả hàng rồi đặt chữ đè lên — chữ nằm trên nền
   loang lổ, khó đọc, và không ra mẫu Atlas. */

// Cùng bảng màu với donut/chart để cả trang nhất quán
const MAU = [
  'var(--primary)',
  'var(--status-ok)',
  'var(--status-run)',
  'var(--tool-accent)',
  'var(--status-error)',
];

export interface RankRow {
  label: string;
  value: number;
  /** chữ hiện bên phải; không truyền thì dùng value đã format */
  display?: string;
  /** ghi chú nhỏ dưới nhãn, ví dụ tên provider */
  sub?: string;
}

export function RankList({
  rows, total, max = 6, mono, testid, empty = 'Chưa có dữ liệu',
}: {
  rows: RankRow[];
  /** tổng để tính %; không truyền thì lấy tổng các hàng đang hiện */
  total?: number;
  max?: number;
  /** nhãn dạng mã (tên model, email) -> font đều để dễ so */
  mono?: boolean;
  testid?: string;
  empty?: string;
}) {
  const hien = rows.slice(0, max);
  if (!hien.length) {
    return <p className="py-6 text-center text-[14px] text-muted-foreground">{empty}</p>;
  }
  /* % tính trên tổng của phần ĐANG HIỆN, không phải tổng tất cả — nếu không thì các
     dòng cộng lại không ra 100% mà người xem chẳng biết phần thiếu đi đâu. */
    const tong = total ?? hien.reduce((a, r) => a + r.value, 0);
  const an = rows.length - hien.length;
  const lonNhat = Math.max(1, ...hien.map((r) => r.value));

  return (
    <div className="flex flex-col" data-testid={testid}>
      {hien.map((r, i) => {
        const pct = tong > 0 ? Math.round((r.value / tong) * 100) : 0;
        return (
          <div key={r.label + i} data-testid={testid ? testid + '-row' : undefined}
            className="flex flex-col gap-1.5 border-b border-border py-2.5 last:border-0">
            <div className="flex items-baseline gap-2">
              <span className={cn('min-w-0 flex-1 truncate text-[14px]', mono && 'font-mono text-[14px]')}
                title={r.label}>
                {r.label}
                {r.sub && <span className="ml-1.5 text-[12px] text-muted-foreground">{r.sub}</span>}
              </span>
              <span className="shrink-0 text-[14px] font-medium tabular-nums">
                {r.display ?? r.value.toLocaleString('vi-VN')}
              </span>
              <span className="w-8 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
                {pct}%
              </span>
            </div>
            {/* thanh 6px — dài theo hàng LỚN NHẤT để chênh lệch dễ thấy, không theo tổng */}
            <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full transition-[width] duration-500"
                style={{ width: `${(r.value / lonNhat) * 100}%`, background: MAU[i % MAU.length] }} />
            </span>
          </div>
        );
      })}
      {an > 0 && (
        <p className="pt-2 text-[12px] text-muted-foreground">
          và {an} mục khác không hiện — phần trăm tính trên {hien.length} mục ở trên
        </p>
      )}
    </div>
  );
}
