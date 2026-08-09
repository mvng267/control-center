'use client';

import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/* Thẻ số liệu dựng theo Atlas /reports, đo bằng Playwright chứ không phỏng đoán:
     số        24px / 700
     badge %   12px, bo 6px, nền cùng màu chữ ở 10% đục
     sparkline TÔ NỀN gradient, chạy hết chiều ngang thẻ (không phải đường kẻ trần)
     bố cục    ô icon vuông bo góc ở trái · badge % ở phải · nhãn · số · sparkline
   Dùng chung cho tab Thống kê và khối lưu lượng AGY để hai nơi trông như một hệ. */

export type Tone = 'ok' | 'warn' | 'error' | 'idle' | 'primary';

const DOT: Record<Tone, string> = {
  ok: 'bg-status-ok', warn: 'bg-status-run', error: 'bg-status-error',
  idle: 'bg-status-idle', primary: 'bg-primary',
};
const TEXT: Record<Tone, string> = {
  ok: 'text-status-ok', warn: 'text-status-run', error: 'text-status-error',
  idle: 'text-muted-foreground', primary: 'text-primary',
};
const STROKE: Record<Tone, string> = {
  ok: 'var(--status-ok)', warn: 'var(--status-run)', error: 'var(--status-error)',
  idle: 'var(--status-idle)', primary: 'var(--primary)',
};

/* Sparkline có TÔ NỀN. Vẽ tay bằng SVG cho nhẹ — kéo Recharts vào một ô 84px là
   thừa. preserveAspectRatio="none" để đường giãn hết bề ngang thẻ như Atlas. */
function Spark({ data, tone, id }: { data: number[]; tone: Tone; id: string }) {
  if (!data || data.length < 2) return null;
  const w = 100, h = 34;
  const max = Math.max(...data), min = Math.min(...data);
  const span = max - min || 1;
  const xy = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - ((v - min) / span) * (h - 6) - 3,
  ] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const c = STROKE[tone];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden
      className="h-[34px] w-full" data-testid="spark">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity="0.28" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={c} strokeWidth="1.6"
        vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatCard({
  title, sub, value, delta, deltaLabel, spark, tone = 'primary', dot, testid,
  icon: Icon, tangLaTot = true,
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
  icon?: LucideIcon;         // ô icon vuông góc trái như Atlas
  testid?: string;
}) {
  // Tăng KHÔNG phải lúc nào cũng tốt. Thẻ "Lỗi" tăng 55% mà tô xanh lá thì đọc thành
  // tin mừng — ngược hẳn ý nghĩa. `tangLaTot=false` để loại thẻ đó tô đỏ khi tăng.
  const up = (delta ?? 0) >= 0;
  const tot = tangLaTot ? up : !up;
  const gid = 'sp-' + (testid || title).replace(/[^a-z0-9]/gi, '');

  return (
    <Card className="gap-0 overflow-hidden p-4 pb-0" data-testid={testid}>
      <div className="flex items-center gap-2">
        {Icon && (
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-[10px]',
            tone === 'error' ? 'bg-status-error/12' : tone === 'ok' ? 'bg-status-ok/12'
              : tone === 'warn' ? 'bg-status-run/12' : 'bg-primary/12')}>
            <Icon className={cn('size-4', TEXT[tone])} />
          </span>
        )}
        {dot && !Icon && <span className={cn('size-2 shrink-0 rounded-full', DOT[dot])} />}

        {delta !== undefined && (
          <span data-testid={testid ? testid + '-delta' : undefined}
            className={cn(
              'ml-auto flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium tabular-nums',
              tot ? 'bg-status-ok/10 text-status-ok' : 'bg-status-error/10 text-status-error',
            )}>
            {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            {up ? '+' : ''}{delta}%
          </span>
        )}
        {delta === undefined && dot && Icon && (
          <span className={cn('ml-auto size-2 shrink-0 rounded-full', DOT[dot])} />
        )}
      </div>

      <div className="mt-3 truncate text-[12px] font-medium tracking-wide text-muted-foreground">
        {(sub || title).toUpperCase()}
      </div>
      <div className={cn('mt-1 text-[24px] font-bold leading-none tracking-tight', TEXT[tone])}
        data-testid={testid ? testid + '-value' : undefined}>
        {value}
      </div>
      {deltaLabel && (
        <div className="mt-1.5 truncate text-[12px] text-muted-foreground">{deltaLabel}</div>
      )}

      {/* Sparkline chạm mép dưới thẻ như Atlas — nên Card để pb-0 và -mx-4 ở đây */}
      <div className={cn('-mx-4 mt-3', !spark && 'h-0')}>
        {spark && <Spark data={spark} tone={tone} id={gid} />}
      </div>
    </Card>
  );
}
