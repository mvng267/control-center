'use client';

import { useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { Markdown } from './markdown';
import { cn } from '@/lib/utils';

/* Thẻ "Suy nghĩ" gập được — port từ renderThinkCard (web/legacy/js/chat.js:293-329).
   Bản mới trước đây vẽ nó thành bong bóng viền nét đứt LUÔN MỞ, đổ hết 1500 ký tự
   (THINK_CAP ở src/server/tools.js) ra giữa dòng chat, đẩy câu trả lời thật xuống
   dưới màn. Giờ mặc định gập, chỉ ló 90 ký tự đầu như bản cũ. */

const PEEK = 90;

export function ThinkCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const flat = text.replace(/\s+/g, ' ').trim();
  const peek = flat.length > PEEK ? flat.slice(0, PEEK) + '…' : flat;

  return (
    <div data-testid="think-card" data-open={open}
      className="w-full overflow-hidden rounded-xl border border-dashed border-border bg-card/50">
      <button onClick={() => setOpen((v) => !v)} data-testid="think-toggle"
        className="tap44 flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/30">
        <Brain className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-[12px] font-medium text-muted-foreground">Suy nghĩ</span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-[12px] italic text-muted-foreground/70">{peek}</span>
        )}
        <ChevronDown className={cn('ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform',
          open && 'rotate-180')} />
      </button>

      <div className={cn('grid transition-[grid-template-rows] duration-200',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="min-h-0 overflow-hidden">
          {open && (
            <div className="border-t border-dashed border-border px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
              <Markdown>{text}</Markdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
