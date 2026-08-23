'use client';

import { ToolCardHeader } from './tool-card-header';
import { ToolCardResult } from './tool-card-result';
import { ToolCardContent } from './tool-card-content';

/* Thẻ tool vẽ ĐÚNG như Claude CLI in ra terminal:

     ⏺ Bash(npm test)
       ⎿  5 tests passed
          … +12 dòng

   Không khung bo tròn, không nền, không icon riêng cho từng loại tool — terminal
   chỉ có một dấu chấm ⏺ và một dấu ngoặc ⎿. Trước đây mỗi tool là một thẻ có viền,
   nền và icon, xếp chồng nhau nhìn ra bảng log của một app quản trị chứ không phải
   bản chép lại phiên terminal.

   REFACTORED (Phase 1): Split ToolCard → Header + Result + Content
   - ToolCardHeader: Button, icon, name, chevron (~60 line)
   - ToolCardResult: Preview 2 line + con số (~70 line)
   - ToolCardContent: Full body khi open (~280 line)
   - ToolCard: Wrapper, state management (~50 line)
 */

export interface ToolPart {
  t: 'tool';
  id: string;
  name: string;
  disp: string;
  summary: string;
  input: string;
  status: 'ok' | 'error' | 'running' | 'pending';
  result: string;
  images: { i: number; mt: string; bytes: number }[];
  // Server gửi {text, status} (extractTodos ở src/server/tools.js) — trước đây khai
  // là `content` nên checklist hiện ra TRỐNG TRƠN, chỉ thấy dấu ○ không có chữ.
  todos?: { text: string; status: string }[];
  // AskUserQuestion / ExitPlanMode — client vẽ thẻ riêng thay vì đổ JSON thô
  hoi?: { hoi: string; nhan: string; nhieu: boolean; chon: { nhan: string; mo: string }[] }[];
  ke?: string;
  /** đường dẫn bản .md của kế hoạch, lấy từ planFilePath của chính tool */
  keFile?: string;
}



/* Trạng thái mở/đóng do CHA giữ, khoá theo tool_use_id.
   Trước đây để useState ở đây: cứ 700ms poll một lần là React dựng lại cây, state cục
   bộ mất theo -> đang đọc kết quả lệnh thì thẻ TỰ ĐÓNG sau ~3 giây. */
export function ToolCard({ part, sid, open, onToggle }: {
  part: ToolPart; sid: string;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      data-testid="tool-card"
      data-status={part.status}
      data-tid={part.id}
      data-open={open}
      className="w-full text-[14px] leading-relaxed"
    >
      <ToolCardHeader part={part} open={open} onToggle={() => onToggle(part.id)} />
      <ToolCardResult part={part} />
      <ToolCardContent part={part} sid={sid} open={open} />
    </div>
  );
}
