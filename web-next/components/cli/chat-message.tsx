'use client';

import { ChevronDown, ChevronRight, Circle, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TEXT_CAPTION } from './typography';

export interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system';
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  timestamp?: string | null;
  tuDong?: string; // tự động (auto-generated message like task-notification)
  toolCount?: number;
  summary?: string; // preview text when collapsed
  userName?: string;
  isSub?: boolean;
  children: React.ReactNode;
  onCopy?: () => void;
}

const NHAN_TU_DONG: Record<string, string> = {
  'tac-vu': 'Tác vụ nền',
  nhac: 'Nhắc hệ thống',
  lenh: 'Lệnh',
  'ket-qua': 'Kết quả lệnh',
  hook: 'Hook',
};

function clock(ts: string | null) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function ChatMessage({
  role,
  collapsed = false,
  onToggleCollapse,
  timestamp,
  tuDong,
  toolCount = 0,
  summary,
  userName = 'mvng',
  isSub = false,
  children,
  onCopy,
}: ChatMessageProps) {
  const isUser = role === 'user';
  const isSystem = role === 'system';

  // System messages: just render notes
  if (isSystem) {
    return (
      <div data-testid="msg-wrap" data-role="system" className="flex w-full flex-col">
        {children}
      </div>
    );
  }

  // User/Assistant messages with header + collapse
  return (
    <div
      data-testid="msg-wrap"
      data-role={role}
      data-collapsed={collapsed}
      className={cn(
        'flex w-full flex-col border-t border-border/50 pt-1.5',
        isUser && !tuDong && '-mx-2 rounded-lg bg-card px-2 pb-1.5'
      )}
    >
      {/* Message header with collapse button, time, tool count */}
      <div className={cn('flex items-center gap-1.5', TEXT_CAPTION, 'text-muted-foreground/70')}>
        <button
          type="button"
          data-testid="luot-gap"
          onClick={onToggleCollapse}
          title={collapsed ? 'Mở lượt này' : 'Gập lượt này'}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-2 text-left transition-colors hover:text-foreground"
        >
          <ChevronDown className={cn('size-3 shrink-0 transition-transform', collapsed && '-rotate-90')} />

          {/* Icon + Name (user/assistant/auto) */}
          <span
            className={cn(
              'flex shrink-0 items-center gap-1 font-medium',
              tuDong
                ? 'text-muted-foreground/60'
                : isUser
                  ? 'text-primary'
                  : 'text-tool-accent'
            )}
          >
            {tuDong ? (
              <Bot className="size-3" />
            ) : isUser ? (
              <ChevronRight className="size-3" />
            ) : (
              <Circle className="size-2.5 fill-current" />
            )}
            {tuDong ? NHAN_TU_DONG[tuDong] || 'Hệ thống' : isUser ? userName : 'Claude'}
          </span>

          {/* Time */}
          {timestamp && <span className="shrink-0 tabular-nums">{clock(timestamp)}</span>}

          {/* Tool count */}
          {toolCount > 0 && <span className="shrink-0">· {toolCount} thẻ</span>}

          {/* Preview when collapsed */}
          {collapsed && summary && (
            <span className="min-w-0 truncate opacity-70">· {summary.slice(0, 60)}</span>
          )}
        </button>

        {/* Sub badge */}
        {isSub && (
          <span data-testid="msg-sub" className="shrink-0 text-[12px] text-tool-accent">
            sub
          </span>
        )}

        {/* Copy button */}
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 opacity-45 transition-opacity hover:opacity-100"
            title="Chép lượt"
          >
            {/* Copy icon rendered by parent */}
          </button>
        )}
      </div>

      {/* Message content (collapsed or expanded) */}
      {!collapsed && <div className="w-full">{children}</div>}
    </div>
  );
}
