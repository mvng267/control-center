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
  kind: 'hook-error' | 'compact' | 'api-error' | 'ngay' | 'hang-doi' | 'ke-hoach' | 'dinh-kem';
  title: string;
  body: string;
  lap?: number;   // cùng một lỗi lặp bao nhiêu lần trong phiên (server đã gộp)
}

const TONE: Record<string, string> = {
  'hook-error': 'text-amber-500',
  'api-error': 'text-status-error',
  'hang-doi': 'text-muted-foreground',
  'ke-hoach': 'text-primary',
  'dinh-kem': 'text-tool-accent',
  compact: 'text-muted-foreground',
  ngay: 'text-muted-foreground',
};

// Vẽ thành dải phân cách ngang giữa dòng: đây là MỐC của phiên, không phải sự cố
const LA_MOC = new Set(['compact', 'ngay', 'ke-hoach']);

export function NoteLine({ part }: { part: NotePart }) {
  const [open, setOpen] = useState(false);
  const tone = TONE[part.kind] || TONE.compact;

  if (LA_MOC.has(part.kind)) {
    return (
      <div className={cn('my-1.5 flex items-center gap-2 text-[11.5px]', tone)}
        data-testid="note-line" data-kind={part.kind}>
        <span className="h-px flex-1 bg-border" />
        <span className="shrink-0">{part.title}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  return (
    <div data-testid="note-line" data-kind={part.kind} className="text-[13px] leading-relaxed">
      {/* Thụt cùng mức với dòng ⎿ của tool: hook lỗi sinh ra TỪ một tool cụ thể nên
          nó là con của tool đó. Không thụt thì nó ngang hàng với ⏺ của cả lượt. */}
      <button onClick={() => setOpen((v) => !v)} data-testid="note-toggle"
        disabled={!part.body}
        title={part.body ? (open ? 'Thu gọn' : 'Xem chi tiết lỗi') : undefined}
        className="tap44 flex w-full items-start gap-2 pl-[18px] text-left">
        <span className={cn('shrink-0 select-none', tone)}>⎿</span>
        <span className={cn('min-w-0 flex-1 truncate', tone)}>{part.title}</span>
        {/* Cùng một lỗi lặp hàng nghìn lần thì server gộp thành một dòng (đo thật:
            4.220 -> 12 dòng trên phiên này). Số lần vẫn phải hiện, nếu không giấu
            mất mức độ nghiêm trọng: "lỗi 1 lần" và "lỗi 2.513 lần" khác hẳn nhau. */}
        {(part.lap || 1) > 1 && (
          <span data-testid="note-lap"
            className="shrink-0 rounded-md bg-muted px-1.5 text-[10.5px] font-medium tabular-nums text-muted-foreground">
            {part.lap}×
          </span>
        )}
        {/* "+" trơ trọi không ai đoán ra để làm gì -> nói thẳng bằng chữ */}
        {part.body && (
          <span className="shrink-0 select-none text-[11px] text-muted-foreground/60">
            {open ? 'thu gọn' : 'chi tiết'}
          </span>
        )}
      </button>
      {/* ml-36px = 18px thụt của nút + 18px cho ký tự ⎿, để thân thẳng hàng với
          tiêu đề ghi chú ở trên chứ không thò ra trái */}
      {open && part.body && (
        <pre className="ml-[36px] max-h-[180px] overflow-auto whitespace-pre-wrap break-words border-l border-border pl-3 text-[12px] leading-relaxed text-muted-foreground">
          {part.body}
        </pre>
      )}
    </div>
  );
}
