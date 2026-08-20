'use client';

import { CornerDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolPart } from './tool-card';

function loiQuyen(s: string): string {
  const t = s.trim();
  if (/^Contains command_substitution/i.test(t)) {
    return 'Lệnh có $(…) hoặc dấu backtick — cần bạn duyệt. Dashboard không hỏi quyền được, chạy tay hoặc đổi chế độ quyền sang "Tự sửa file".';
  }
  if (/requires approval/i.test(t)) {
    return 'Lệnh này cần bạn duyệt. Dashboard không hỏi quyền được — chạy tay trên máy, hoặc đổi chế độ quyền ở cuối khung chat.';
  }
  if (/have permission to use|not allowed/i.test(t)) {
    return 'Lệnh không nằm trong danh sách cho phép. Thêm vào `.claude/settings.local.json` hoặc chạy tay.';
  }
  return '';
}

/** Dòng tóm tắt kết quả — vài dòng đầu, phần còn lại đếm ra số. */
function tomTat(part: ToolPart): { dong: string[]; con: number } {
  if (part.status === 'running') return { dong: ['đang chạy…'], con: 0 };
  const dich = loiQuyen(String(part.result || ''));
  if (dich) return { dong: [dich], con: 0 };
  const raw = String(part.result || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim());
  if (!raw.length) {
    if (part.status === 'pending') return { dong: ['(bị ngắt, không có kết quả)'], con: 0 };
    return { dong: ['(trống)'], con: 0 };
  }
  return { dong: raw.slice(0, 2), con: Math.max(0, raw.length - 2) };
}

export function ToolCardResult({ part }: { part: ToolPart }) {
  const isErr = part.status === 'error';
  const tt = tomTat(part);
  const laLoiQuyen = !!loiQuyen(String(part.result || ''));
  const soTodo = part.todos?.length || 0;
  const xong = part.todos?.filter((t) => t.status === 'completed').length || 0;

  return (
    <div className="flex gap-2 pl-[18px]" data-testid="tool-ket-qua">
      <span className="mt-[3px] shrink-0 select-none text-muted-foreground/40">
        <CornerDownRight className="size-3" />
      </span>
      <div
        className={cn(
          'min-w-0 flex-1 font-mono',
          isErr ? 'text-status-error/90' : 'text-muted-foreground'
        )}
      >
        {soTodo ? (
          <span className="tabular-nums">
            {xong}/{soTodo} việc
          </span>
        ) : (
          <>
            {/* Lỗi quyền được XUỐNG DÒNG, không `truncate`: câu hướng dẫn dài hơn 80 ký tự */}
            {tt.dong.map((d, i) => (
              <div key={i} className={cn(!laLoiQuyen && 'truncate')}>
                {d}
              </div>
            ))}
            {tt.con > 0 && <div className="text-muted-foreground/50">… +{tt.con} dòng</div>}
          </>
        )}
      </div>
    </div>
  );
}
