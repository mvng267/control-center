'use client';

import { useState } from 'react';
import { Check, Pencil, FileText, X, Circle, CornerDownRight } from 'lucide-react';
import { Markdown } from './markdown';
import { cn } from '@/lib/utils';

/* Kế hoạch Claude trình ra (ExitPlanMode).

   Vẽ như terminal, KHÔNG khung bo góc có nền: khung chat đã đổi sang kiểu CLI
   (dấu ⏺ / ⌐, phông chữ đều, không bong bóng) nên một cái thẻ bo tròn nền tím nằm
   giữa dòng chảy terminal là lạc hẳn — đúng lỗi mà bản trước mắc.

   Kế hoạch thật RẤT dài: đo hai mẫu trong phiên 58MB được 15.371 và 6.754 ký tự.
   Nên mặc định GẬP, mở ra khi cần, và chặn chiều cao khi mở để nó không đẩy ô nhập
   ra khỏi màn hình. */

const DAI = 900;   // dài hơn thì gập lại

export function PlanCard({
  ke, keFile, daDuyet, onDuyet,
}: {
  ke: string;
  /** đường dẫn ~/.claude/plans/*.md — lấy từ chính tool, không dò chuỗi */
  keFile?: string;
  /** đã bấm duyệt / đã có lượt sau -> chỉ xem lại */
  daDuyet?: boolean;
  /** nhận ghi chú góp ý; server ghép vào prompt duyệt (index.js: body.note) */
  onDuyet?: (gopY: string) => void;
}) {
  const dai = ke.length > DAI;
  const [mo, setMo] = useState(!dai);
  const [moGopY, setMoGopY] = useState(false);
  const [gopY, setGopY] = useState('');
  const [moDayDu, setMoDayDu] = useState(false);
  const soDong = ke.split('\n').length;

  // Tiêu đề kế hoạch = dòng "# ..." đầu tiên. Gập lại mà chỉ hiện "Kế hoạch" thì
  // không biết kế hoạch về cái gì, phải mở ra mới đọc được.
  const tieuDe = (ke.match(/^#\s+(.+)$/m) || [, ''])[1].trim();

  return (
    <div data-testid="plan-card" data-open={mo} className="w-full text-[13px] leading-relaxed">
      <button onClick={() => dai && setMo((v) => !v)} data-testid="plan-toggle"
        disabled={!dai}
        className={cn('flex w-full items-start gap-2 text-left',
          dai && 'tap44 transition-colors md:hover:bg-accent/25')}>
        <span aria-hidden className="mt-[3px] shrink-0 select-none text-tool-accent"><Circle className="size-2.5 fill-current" /></span>
        <span className="min-w-0 flex-1">
          <span className="font-medium text-tool-accent">Kế hoạch</span>
          {tieuDe && <span className="text-muted-foreground">({tieuDe})</span>}
        </span>
        {daDuyet && <span className="shrink-0 text-[11px] text-status-ok">đã duyệt</span>}
        {dai && (
          <span className="shrink-0 select-none text-[11px] text-muted-foreground/60">
            {mo ? '−' : '+'}
          </span>
        )}
      </button>

      {/* Dòng ⌐ tóm tắt — luôn hiện, đúng như terminal in kết quả tool */}
      <div className="flex gap-2 pl-[3px] text-muted-foreground">
        <span aria-hidden className="mt-[3px] shrink-0 select-none text-muted-foreground/40"><CornerDownRight className="size-3" /></span>
        <span className="min-w-0 flex-1 truncate text-[12px]">
          {soDong} dòng
          {keFile && <> · <span className="font-mono">{keFile.split('/').pop()}</span></>}
        </span>
      </div>

      {mo && (
        <div className="ml-[18px] mt-1 max-h-[52dvh] overflow-y-auto border-l border-border pl-3">
          <Markdown>{ke}</Markdown>
        </div>
      )}

      {!daDuyet && onDuyet && (
        <div className="ml-[18px] mt-2 flex flex-col gap-2 pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => onDuyet(gopY.trim())} data-testid="plan-approve"
              className="tap44 flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground">
              <Check className="size-3.5" /> Duyệt &amp; làm
            </button>

            {/* Trước đây nút này chỉ gọi .focus() vào ô nhập chính, KHÔNG nói gì cả —
                người dùng phải tự đoán rằng gõ vào đó rồi bấm Duyệt thì chữ đó thành
                ghi chú. Server vốn ĐÃ nhận `note` và ghép vào prompt, chỉ giao diện
                không nói ra. Giờ mở hẳn ô soạn ngay tại đây, có nhãn rõ. */}
            <button onClick={() => setMoGopY((v) => !v)} data-testid="plan-edit"
              data-open={moGopY}
              className={cn('tap44 flex items-center gap-1.5 rounded-[8px] border px-3 py-1.5 text-[12.5px]',
                moGopY ? 'border-primary text-primary' : 'border-border')}>
              <Pencil className="size-3.5" /> Góp ý
            </button>

            {/* Đọc bản đầy đủ NGAY TRONG APP. Trước đây là thẻ <a target="_blank">
                mở /api/plan — endpoint đó trả text/plain, nên kế hoạch 15.000 ký tự
                hiện ra dạng chữ thô không xuống dòng, không tiêu đề. */}
            {keFile && (
              <button onClick={() => setMoDayDu(true)} data-testid="plan-file"
                className="tap44 flex items-center gap-1.5 rounded-[8px] border border-border px-3 py-1.5 text-[12.5px]">
                <FileText className="size-3.5" /> Xem đầy đủ
              </button>
            )}
            {!moGopY && (
              <span className="text-[11px] text-muted-foreground">
                Duyệt sẽ cho Claude tự sửa file ở lượt này
              </span>
            )}
          </div>

          {moGopY && (
            <div className="flex flex-col gap-1.5">
              <textarea value={gopY} onChange={(e) => setGopY(e.target.value)} autoFocus
                data-testid="plan-note" rows={3}
                placeholder="Viết thêm ý rồi bấm Duyệt — Claude sẽ làm theo kế hoạch kèm lưu ý này…"
                className="w-full resize-y rounded-[8px] border border-border bg-card px-2.5 py-2 text-[16px] outline-none focus:border-primary md:text-[13px]" />
              <span className="text-[11px] text-muted-foreground">
                Để trống cũng được — khi đó Claude làm đúng kế hoạch đã trình bày.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Màn phủ đọc bản .md đầy đủ, cùng lối XemFile: toàn màn trên điện thoại, có
          nút đóng rõ ràng. Dùng Markdown nên tiêu đề, danh sách, bảng hiện đúng. */}
      {moDayDu && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-background" data-testid="plan-full">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2"
            style={{ paddingTop: 'calc(8px + env(safe-area-inset-top))' }}>
            <FileText className="size-4 shrink-0 text-tool-accent" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">
                {tieuDe || 'Kế hoạch'}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {soDong} dòng{keFile ? ` · ${keFile.split('/').pop()}` : ''}
              </span>
            </span>
            <button onClick={() => setMoDayDu(false)} data-testid="plan-full-dong"
              title="Đóng" className="tap44 flex size-8 items-center justify-center rounded-lg hover:bg-accent">
              <X className="size-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <Markdown>{ke}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}
