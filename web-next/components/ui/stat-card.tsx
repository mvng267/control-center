'use client';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Thẻ số liệu dựng theo đúng cấu trúc Atlas:
//   tiêu đề · phụ đề IN HOA nhỏ · số lớn · badge % thay đổi · sparkline · chấm trạng thái
// Dùng chung cho tab Thống kê và khối lưu lượng AGY để hai nơi trông như một hệ.

export type Tone = 'ok' | 'warn' | 'error' | 'idle' | 'primary';

const DOT: Record<Tone, string> = {
  ok: 'bg-status-ok', warn: 'bg-status-run', error: 'bg-status-error',
  idle: 'bg-status-idle', primary: 'bg-primary',
};
const TEXT: Record<Tone, string> = {
  ok: 'text-status-ok', warn: 'text-status-run', error: 'text-status-error',
  idle: 'text-muted-foreground', primary: 'text-primary',
};

// Sparkline: đường nhỏ trong thẻ, vẽ tay bằng SVG cho nhẹ (không kéo Recharts vào đây).
function Spark({ data, tone }: { data: number[]; tone: Tone }) {
  if (!data || data.length < 2) return null;
  const w = 84, h = 30;
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const stroke = tone === 'error' ? 'var(--status-error)'
    : tone === 'warn' ? 'var(--status-run)'
      : tone === 'ok' ? 'var(--status-ok)' : 'var(--primary)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatCard({
  title, sub, value, delta, deltaLabel, spark, tone = 'primary', dot, testid,
  tangLaTot = true,
}: {
  title: string;
  sub?: string;
  value: string | number;
  delta?: number;            // % thay đổi; âm = giảm
  deltaLabel?: string;       // chú thích cạnh badge, ví dụ "5 phiên"
  tangLaTot?: boolean;       // false cho thẻ mà TĂNG là xấu (lỗi, độ trễ)
  spark?: number[];
  tone?: Tone;
  dot?: Tone;                // chấm trạng thái góc phải
  testid?: string;
}) {
  // Tăng KHÔNG phải lúc nào cũng tốt. Thẻ "Lỗi" tăng 55% mà tô xanh lá thì đọc thành
  // tin mừng — ngược hẳn ý nghĩa. `tangLaTot=false` để loại thẻ đó tô đỏ khi tăng.
  const up = (delta ?? 0) >= 0;
  const tot = tangLaTot ? up : !up;
  return (
    <Card className="gap-0 p-4" data-testid={testid}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{title}</div>
          {sub && (
            <div className="mt-0.5 truncate text-[11px] font-medium tracking-wide text-muted-foreground">
              {sub.toUpperCase()}
            </div>
          )}
        </div>
        {dot && <span className={cn('mt-1 size-2 shrink-0 rounded-full', DOT[dot])} />}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className={cn('text-[26px] font-bold leading-none tracking-tight', TEXT[tone])}
          data-testid={testid ? testid + '-value' : undefined}>
          {value}
        </div>
        {spark && <Spark data={spark} tone={tone} />}
      </div>

      {(delta !== undefined || deltaLabel) && (
        <div className="mt-3 flex items-center gap-2">
          {delta !== undefined && (
            <span className={cn(
              'rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
              tot ? 'bg-status-ok/12 text-status-ok' : 'bg-status-error/12 text-status-error',
            )}>
              {up ? '+' : ''}{delta}%
            </span>
          )}
          {deltaLabel && <span className="truncate text-[12px] text-muted-foreground">{deltaLabel}</span>}
        </div>
      )}
    </Card>
  );
}
