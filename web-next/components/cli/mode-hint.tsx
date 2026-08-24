'use client';

import { Terminal, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

/* Dải báo CHẾ ĐỘ khi dòng nhập bắt đầu bằng "!" hoặc "#".

   Claude CLI đổi hẳn màu dòng nhập khi gõ hai ký tự này — nhìn là biết câu sắp gửi
   sẽ KHÔNG đi tới Claude như tin nhắn thường:
     !lệnh  -> chạy thẳng bash, trả kết quả ngay, không tốn lượt hỏi Claude
     #ghi   -> cất vào bộ nhớ để các phiên sau vẫn nhớ

   `!lệnh` giờ CHẠY THẲNG ở server, không qua Claude nữa. Đo thật: qua `claude -p`
   mất 6,4 giây cho `!echo`; chạy thẳng thì `!ls` 29ms, `!node -v` 44ms,
   `!git status` 770ms. Bảng tra cứng ở server (LENH_NHANH) chỉ mở nhóm ĐỌC —
   dashboard mở ra mạng nên không nhận lệnh tự do; `!rm -rf /` bị chặn.

   `#` vẫn qua `claude -p`: nó ghi vào bộ nhớ tự động của CLI, KHÔNG đụng
   ~/.claude/CLAUDE.md và không bẩn repo — không có cách nào làm việc đó ở server. */

export type Che = 'bash' | 'nho' | null;

/** Dòng nhập đang ở chế độ nào. Phải có chữ SAU dấu, gõ mỗi "!" thì chưa tính. */
export function docChe(text: string): Che {
  if (/^!\S/.test(text)) return 'bash';
  if (/^#\S/.test(text)) return 'nho';
  return null;
}

const KIEU = {
  bash: {
    Icon: Terminal,
    nhan: 'Chạy lệnh bash',
    mo: 'chạy thẳng trên máy, không hỏi Claude',
    mau: 'border-tool-accent/40 bg-tool-accent/10 text-tool-accent',
  },
  nho: {
    Icon: Brain,
    nhan: 'Ghi vào bộ nhớ',
    mo: 'các phiên sau vẫn nhớ điều này',
    mau: 'border-primary/40 bg-primary/10 text-primary',
  },
} as const;

export function ModeHint({ che }: { che: Che }) {
  if (!che) return null;
  const k = KIEU[che];
  return (
    <div data-testid="mode-hint" data-che={che}
      className={cn('mb-2 flex items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-[12px]', k.mau)}>
      <k.Icon className="size-3.5 shrink-0" />
      <span className="font-medium">{k.nhan}</span>
      <span className="min-w-0 truncate opacity-70">— {k.mo}</span>
    </div>
  );
}
