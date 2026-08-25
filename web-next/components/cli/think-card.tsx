'use client';

import { useState } from 'react';
import { Markdown } from './markdown';

/* Khối "suy nghĩ" — trên terminal Claude in ra:

     ✻ Thinking…
       nội dung nghĩ, chữ mờ nghiêng

   Trước đây bản này vẽ thành thẻ viền nét đứt có nền, nhìn ra một widget của app
   quản trị. Giờ đúng kiểu terminal: một dấu ✻ và chữ mờ, mặc định gập chỉ ló 90 ký
   tự đầu (THINK_CAP ở src/server/tools.js cho tới 1500 ký tự, đổ hết ra thì câu trả
   lời thật bị đẩy xuống dưới màn). */

const PEEK = 90;

export function ThinkCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const flat = text.replace(/\s+/g, ' ').trim();
  const peek = flat.length > PEEK ? flat.slice(0, PEEK) + '…' : flat;

  return (
    <div data-testid="think-card" data-open={open} className="w-full text-[14px] leading-relaxed">
      <button onClick={() => setOpen((v) => !v)} data-testid="think-toggle"
        className="tap44 flex w-full items-start gap-2 text-left transition-colors md:hover:bg-accent/25">
        <span className="shrink-0 select-none text-muted-foreground/70">✻</span>
        <span className="min-w-0 flex-1 italic text-muted-foreground">
          <span className="not-italic">Đang nghĩ…</span>
          {!open && peek && <span className="text-muted-foreground/70"> {peek}</span>}
        </span>
        <span className="shrink-0 select-none text-[12px] text-muted-foreground/50">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="ml-[18px] border-l border-border pl-3 text-muted-foreground">
          <Markdown>{text}</Markdown>
        </div>
      )}
    </div>
  );
}
