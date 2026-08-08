'use client';

import { useEffect, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
import { COMMANDS, type Cmd } from '@/lib/commands';
import { cn } from '@/lib/utils';

/* Gõ "/" ở đầu ô chat -> hiện ngay danh sách lệnh, đúng như Claude CLI trên terminal.
   Khác bảng lệnh ⌘K ở chỗ: cái này nằm NGAY TRÊN ô nhập, không che màn hình, và
   chọn xong thì chữ được điền vào ô để gửi như một tin nhắn bình thường.

   Chỉ gợi ý lệnh gửi được vào phiên (claude-chat) và lệnh đọc thông tin (claude-run).
   Lệnh của Hermes và của dashboard không thuộc về ô chat này. */

export const SLASH_CMDS: Cmd[] = COMMANDS.filter(
  (c) => c.group === 'Claude' && (c.kind === 'claude-chat' || c.kind === 'claude-run'),
);

export function matchSlash(text: string): Cmd[] {
  if (!text.startsWith('/')) return [];
  const q = text.slice(1).toLowerCase();
  // Đã gõ đủ tên lệnh rồi thì thôi không gợi ý nữa (tránh che khi đang viết tham số)
  if (text.includes(' ')) return [];
  return SLASH_CMDS.filter((c) => c.label.slice(1).toLowerCase().startsWith(q));
}

export function SlashHint({
  items, active, onPick,
}: {
  items: Cmd[];
  active: number;
  onPick: (c: Cmd) => void;
}) {
  if (!items.length) return null;
  return (
    <div data-testid="slash-hint"
      className="mb-2 max-h-[42dvh] overflow-y-auto rounded-[12px] border border-border bg-popover p-1 shadow-lg">
      {items.map((c, i) => (
        <button key={c.id} data-testid="slash-item" data-cmd={c.id}
          onMouseDown={(e) => { e.preventDefault(); onPick(c); }}   // giữ focus ở ô nhập
          className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
            i === active ? 'bg-accent' : 'hover:bg-accent/50')}>
          <span className="shrink-0 font-mono text-[13px] font-medium">{c.label}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{c.desc}</span>
          {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
        </button>
      ))}
    </div>
  );
}

// Điều hướng bằng phím: ↑ ↓ chọn, Tab/Enter điền, Esc đóng
export function useSlash(text: string, onFill: (s: string) => void) {
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  const items = closed ? [] : matchSlash(text);

  useEffect(() => { setActive(0); }, [text]);
  useEffect(() => { if (!text.startsWith('/')) setClosed(false); }, [text]);

  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!items.length) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % items.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); return true; }
    if (e.key === 'Escape') { e.preventDefault(); setClosed(true); return true; }
    // Enter/Tab: điền lệnh vào ô. Nếu người dùng đã gõ TRỌN tên lệnh rồi thì để Enter
    // gửi luôn như bình thường, không chặn.
    if (e.key === 'Tab' || e.key === 'Enter') {
      const exact = items.length === 1 && items[0].label === text.trim();
      if (e.key === 'Enter' && exact) return false;
      e.preventDefault();
      onFill(items[active].label + ' ');
      return true;
    }
    return false;
  };

  return { items, active, onKeyDown, pick: (c: Cmd) => onFill(c.label + ' ') };
}
