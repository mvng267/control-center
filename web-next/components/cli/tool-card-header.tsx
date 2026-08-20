'use client';

import { ChevronDown, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolPart } from './tool-card';

const CHAM = {
  ok: 'text-tool-accent',
  error: 'text-status-error',
  running: 'text-status-run animate-pulse',
  pending: 'text-muted-foreground/50',
} as const;

export function ToolCardHeader({
  part,
  open,
  onToggle,
}: {
  part: ToolPart;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      data-testid="tool-card-head"
      onClick={() => {
        onToggle();
        navigator.vibrate?.(10);
      }}
      aria-expanded={open}
      className="tap44 flex w-full items-start gap-2 text-left transition-colors md:hover:bg-accent/25"
    >
      {/* Icon vector thay ký tự `⏺`. Giữ nguyên testid và bảng màu CHAM */}
      <span
        className={cn('mt-[3px] shrink-0 select-none', CHAM[part.status] || CHAM.pending)}
        data-testid="tool-card-status"
      >
        <Circle className="size-2.5 fill-current" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-mono font-medium">{part.disp || part.name}</span>
        {part.summary && <span className="text-muted-foreground">({part.summary})</span>}
      </span>
      <ChevronDown
        className={cn(
          'mt-1 size-3.5 shrink-0 text-muted-foreground/50 transition-transform',
          open && 'rotate-180'
        )}
      />
    </button>
  );
}
