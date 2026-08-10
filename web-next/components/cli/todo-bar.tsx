'use client';

import { useState } from 'react';
import { ListChecks, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Server trả {text, status} — xem extractTodos trong src/server/tools.js
export interface Todo { text: string; status: string }

/* Thanh việc-đang-làm. Todo vốn nằm trong thẻ TodoWrite giữa dòng chat, phải cuộn
   ngược lên và bấm mở mới thấy — trong khi đây là thứ hay cần nhất: "Claude đang
   làm bước nào rồi?". Lấy TodoWrite MỚI NHẤT của phiên và ghim ngay dưới header. */

const TONE: Record<string, string> = {
  completed: 'text-status-ok',
  in_progress: 'text-primary',
  pending: 'text-muted-foreground',
};

export function TodoBar({ todos }: { todos: Todo[] }) {
  const [open, setOpen] = useState(false);
  if (!todos?.length) return null;

  const done = todos.filter((t) => t.status === 'completed').length;
  const doing = todos.find((t) => t.status === 'in_progress');
  // Xong hết rồi thì không ghim nữa — hết việc mà vẫn chiếm chỗ thì thành nhiễu.
  if (done === todos.length) return null;

  const pct = Math.round((done / todos.length) * 100);
  const now = doing ? doing.text : 'Chờ bước tiếp theo';

  return (
    <div className="mx-auto w-full max-w-[920px] shrink-0 px-4 pt-2" data-testid="todo-bar">
      <button onClick={() => setOpen((v) => !v)} data-testid="todo-toggle"
        className="flex w-full items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent/40">
        <ListChecks className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium">{now}</span>
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: pct + '%' }} />
          </span>
        </span>
        <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{done}/{todos.length}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        /* ☒ / ☐ — đúng ký tự Claude CLI in danh sách việc, không dùng icon vector */
        <div className="mt-1.5 flex flex-col gap-0.5 rounded-[10px] border border-border bg-card px-3 py-2.5 font-mono"
          data-testid="todo-list">
          {todos.map((t, i) => (
            <div key={i} className="flex items-start gap-2 text-[12.5px]">
              <span className={cn('shrink-0 select-none', TONE[t.status])}>
                {t.status === 'completed' ? '☒' : '☐'}
              </span>
              <span className={cn('min-w-0 leading-snug',
                t.status === 'completed' && 'text-muted-foreground line-through',
                t.status === 'in_progress' && 'text-foreground')}>
                {t.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
