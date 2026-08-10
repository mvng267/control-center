'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/* Dòng ghi chú giữa hội thoại: hook lỗi, mốc /compact, lỗi từ máy chủ Claude.
   Server vốn VỨT hết những dòng này (một câu `continue` trong parseSessionFile) —
   đếm trên 180 file .jsonl thật: 11.881 hook chạy lỗi, 16 lỗi API (có cả 401 hết
   hạn đăng nhập), 7 mốc /compact. Không hiện thì phiên tự dưng đứt đoạn hoặc im
   lặng hỏng mà không biết vì sao.

   Vẽ như terminal: một dòng ⎿ thụt vào, không khung không nền. */

export interface NotePart {
  t: 'note';
  kind: 'hook-error' | 'compact' | 'api-error';
  title: string;
  body: string;
}

const TONE = {
  'hook-error': 'text-amber-500',
  'api-error': 'text-status-error',
  compact: 'text-muted-foreground',
} as const;

export function NoteLine({ part }: { part: NotePart }) {
  const [open, setOpen] = useState(false);
  const tone = TONE[part.kind] || TONE.compact;

  // Mốc /compact là ranh giới của phiên -> vẽ thành dải phân cách như CLI
  if (part.kind === 'compact') {
    return (
      <div className="my-1.5 flex items-center gap-2 text-[11.5px] text-muted-foreground/70"
        data-testid="note-line" data-kind="compact">
        <span className="h-px flex-1 bg-border" />
        <span className="shrink-0">{part.title}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  return (
    <div data-testid="note-line" data-kind={part.kind} className="text-[13px] leading-relaxed">
      <button onClick={() => setOpen((v) => !v)} data-testid="note-toggle"
        disabled={!part.body}
        className="tap44 flex w-full items-start gap-2 text-left">
        <span className={cn('shrink-0 select-none', tone)}>⎿</span>
        <span className={cn('min-w-0 flex-1 truncate', tone)}>{part.title}</span>
        {part.body && (
          <span className="shrink-0 select-none text-[11px] text-muted-foreground/50">
            {open ? '−' : '+'}
          </span>
        )}
      </button>
      {open && part.body && (
        <pre className="ml-[18px] max-h-[180px] overflow-auto whitespace-pre-wrap break-words border-l border-border pl-3 text-[12px] leading-relaxed text-muted-foreground">
          {part.body}
        </pre>
      )}
    </div>
  );
}
