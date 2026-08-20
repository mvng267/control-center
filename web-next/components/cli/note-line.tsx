/* Dòng ghi chú giữa hội thoại: hook lỗi, mốc /compact, lỗi từ máy chủ Claude.
   Server vốn VỨT hết những dòng này (một câu `continue` trong parseSessionFile) —
   đếm trên 180 file .jsonl thật: 11.881 hook chạy lỗi, 16 lỗi API (có cả 401 hết
   hạn đăng nhập), 7 mốc /compact. Không hiện thì phiên tự dưng đứt đoạn hoặc im
   lặng hỏng mà không biết vì sao.

   Vẽ như terminal: một dòng ⎿ thụt vào, không khung không nền.

   REFACTORED (Phase 1): Split NoteLine → NoteMilestone + NoteLineCollapsible
   - NoteMilestone: dòng phân cách mốc (compact, ngay, kế hoạch) — không bấm
   - NoteLineCollapsible: ghi chú mở rộng (hook error, api error, etc.)
   - NoteLine: wrapper auto-select loại
 */

export interface NotePart {
  t: 'note';
  kind: 'hook-error' | 'compact' | 'api-error' | 'ngay' | 'hang-doi' | 'ke-hoach' | 'dinh-kem';
  title: string;
  body: string;
  lap?: number; // cùng một lỗi lặp bao nhiêu lần trong phiên (server đã gộp)
}

export { NoteMilestone, NoteLineCollapsible, NoteLine } from './note-line-variants';
