'use client';

import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

/* Donut kiểu Atlas ("Dataset Mix" ở /reports):
     vòng có SỐ TỔNG ở giữa · chú giải nằm BÊN PHẢI, mỗi dòng: chấm màu · nhãn · giá trị · %
   Bản trong stats-tab đặt chú giải nằm dưới và không có số giữa — mắt phải nhảy
   qua lại giữa vòng và danh sách để hiểu. Rút ra đây để tab nào cũng dùng được. */

export const DONUT_COLORS = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899',
];
export const DONUT_OTHER = '#4b5163';

export interface DonutSlice {
  name: string;
  value: number;
  fill?: string;
}

export function DonutCard({
  data, tongLabel, tongValue, max = 6, testid, className,
}: {
  data: DonutSlice[];
  /** chữ nhỏ trên số giữa, ví dụ "Request" */
  tongLabel?: string;
  /** số giữa đã format sẵn; không truyền thì cộng data */
  tongValue?: string;
  max?: number;
  testid?: string;
  className?: string;
}) {
  if (!data.length) {
    return <p className="py-8 text-center text-[12.5px] text-muted-foreground">Chưa có dữ liệu</p>;
  }
  // gộp phần đuôi thành "Khác" — 34 model mà vẽ 34 lát thì không đọc được lát nào
  const sap = [...data].sort((a, b) => b.value - a.value);
  const dau = sap.slice(0, max).map((d, i) => ({ ...d, fill: d.fill || DONUT_COLORS[i % DONUT_COLORS.length] }));
  const con = sap.slice(max).reduce((a, d) => a + d.value, 0);
  const lat = con > 0 ? [...dau, { name: 'Khác', value: con, fill: DONUT_OTHER }] : dau;

  const tong = data.reduce((a, d) => a + d.value, 0);
  const soGiua = tongValue ?? (tong >= 1e6 ? (tong / 1e6).toFixed(1) + 'M'
    : tong >= 1e3 ? (tong / 1e3).toFixed(1) + 'k' : String(tong));

  return (
    <div className={cn('flex flex-col items-center gap-4 sm:flex-row', className)} data-testid={testid}>
      <div className="relative h-[168px] w-[168px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={lat} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%"
              paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
              {lat.map((e, i) => <Cell key={i} fill={e.fill} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* số tổng nằm GIỮA vòng — điểm khác biệt chính so với bản cũ */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {tongLabel && <span className="text-[11.5px] text-muted-foreground">{tongLabel}</span>}
          <span className="text-[19px] font-bold tabular-nums leading-tight" data-testid={testid ? testid + '-total' : undefined}>
            {soGiua}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {lat.map((d, i) => (
          <div key={d.name + i} className="flex items-center gap-2 border-b border-border py-1.5 last:border-0">
            <span className="size-2 shrink-0 rounded-full" style={{ background: d.fill }} />
            <span className="min-w-0 flex-1 truncate text-[13px]" title={d.name}>{d.name}</span>
            <span className="shrink-0 text-[13px] font-medium tabular-nums">
              {d.value >= 1e6 ? (d.value / 1e6).toFixed(1) + 'M'
                : d.value >= 1e3 ? (d.value / 1e3).toFixed(1) + 'k' : d.value}
            </span>
            <span className="w-8 shrink-0 text-right text-[11.5px] tabular-nums text-muted-foreground">
              {tong > 0 ? Math.round((d.value / tong) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
