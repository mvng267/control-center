'use client';

import { useState } from 'react';
import { CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NotePart } from './note-line';

const TONE: Record<string, string> = {
  'hook-error': 'text-status-run',
  'api-error': 'text-status-error',
  'hang-doi': 'text-muted-foreground',
  'ke-hoach': 'text-primary',
  'dinh-kem': 'text-tool-accent',
  compact: 'text-muted-foreground',
  ngay: 'text-muted-foreground',
};

const LA_MOC = new Set(['compact', 'ngay', 'ke-hoach']);

/** Dòng phân cách mốc (compact, ngay, kế hoạch) — không bấm được, không chi tiết */
export function NoteMilestone({ part }: { part: NotePart }) {
  const tone = TONE[part.kind] || TONE.compact;

  return (
    <div data-testid="note-line" data-kind={part.kind} className={cn('my-1.5 flex items-center gap-2 text-[12px]', tone)}>
      <span className="h-px flex-1 bg-border" />
      <span className="shrink-0">{part.title}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Dòng ghi chú có thể mở rộng (hook error, api error, hang-doi, định kèm) */
export function NoteLineCollapsible({ part }: { part: NotePart }) {
  const [open, setOpen] = useState(false);
  const tone = TONE[part.kind] || TONE.compact;

  return (
    <div data-testid="note-line" data-kind={part.kind} className="text-[14px] leading-relaxed">
      <button
        onClick={() => setOpen((v) => !v)}
        data-testid="note-toggle"
        disabled={!part.body}
        title={part.body ? (open ? 'Thu gọn' : 'Xem chi tiết lỗi') : undefined}
        className={cn(
          'flex w-full items-start gap-2 pl-[18px] text-left',
          part.body && 'py-2'
        )}
      >
        <span className={cn('mt-[3px] shrink-0 select-none', tone)}>
          <CornerDownRight className="size-3" />
        </span>
        <span className={cn('min-w-0 flex-1 truncate', tone)}>{part.title}</span>
        {(part.lap || 1) > 1 && (
          <span
            data-testid="note-lap"
            className="shrink-0 rounded-md bg-muted px-1.5 text-[12px] font-medium tabular-nums text-muted-foreground"
          >
            {part.lap}×
          </span>
        )}
        {part.body && (
          <span className="shrink-0 select-none text-[12px] text-muted-foreground/60">
            {open ? 'thu gọn' : 'chi tiết'}
          </span>
        )}
      </button>
      {open && part.body && (
        <pre className="ml-[36px] max-h-[180px] overflow-auto whitespace-pre-wrap break-words border-l border-border pl-3 text-[12px] leading-relaxed text-muted-foreground">
          {part.body}
        </pre>
      )}
    </div>
  );
}

/** Wrapper — auto-select type based on kind */
export function NoteLine({ part }: { part: NotePart }) {
  return LA_MOC.has(part.kind) ? (
    <NoteMilestone part={part} />
  ) : (
    <NoteLineCollapsible part={part} />
  );
}
