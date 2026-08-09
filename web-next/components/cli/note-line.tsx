'use client';

import { useState } from 'react';
import { AlertTriangle, Scissors, CloudOff, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/* Dòng ghi chú giữa hội thoại: hook lỗi, mốc /compact, lỗi từ máy chủ Claude.
   Server vốn VỨT hết những dòng này (một câu `continue` trong parseSessionFile) —
   đếm trên 180 file .jsonl thật: 11.881 hook chạy lỗi, 16 lỗi API (có cả 401 hết
   hạn đăng nhập), 7 mốc /compact. Không hiện thì phiên tự dưng đứt đoạn hoặc im
   lặng hỏng mà không biết vì sao. */

export interface NotePart {
  t: 'note';
  kind: 'hook-error' | 'compact' | 'api-error';
  title: string;
  body: string;
}

const STYLE = {
  'hook-error': { Icon: AlertTriangle, tone: 'text-amber-500', ring: 'border-amber-500/30 bg-amber-500/[0.07]' },
  'api-error': { Icon: CloudOff, tone: 'text-status-error', ring: 'border-status-error/30 bg-status-error/[0.07]' },
  compact: { Icon: Scissors, tone: 'text-muted-foreground', ring: 'border-border bg-card/60' },
} as const;

export function NoteLine({ part }: { part: NotePart }) {
  const [open, setOpen] = useState(false);
  const st = STYLE[part.kind] || STYLE.compact;

  // Mốc /compact không có nội dung phụ -> vẽ thành dải phân cách cho gọn
  if (part.kind === 'compact') {
    return (
      <div className="my-1.5 flex items-center gap-2.5" data-testid="note-line" data-kind="compact">
        <span className="h-px flex-1 bg-border" />
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-[3px] text-[10.5px] text-muted-foreground">
          <Scissors className="size-3" /> {part.title}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  return (
    <div data-testid="note-line" data-kind={part.kind}
      className={cn('overflow-hidden rounded-[10px] border', st.ring)}>
      <button onClick={() => setOpen((v) => !v)} data-testid="note-toggle"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left">
        <st.Icon className={cn('size-3.5 shrink-0', st.tone)} />
        <span className={cn('min-w-0 flex-1 truncate text-[12px] font-medium', st.tone)}>{part.title}</span>
        {part.body && (
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180')} />
        )}
      </button>
      {open && part.body && (
        <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-words border-t border-border/60 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
          {part.body}
        </pre>
      )}
    </div>
  );
}
