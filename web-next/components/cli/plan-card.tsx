'use client';

import { useState } from 'react';
import { Check, Pencil, FileText } from 'lucide-react';
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
  ke, keFile, daDuyet, onDuyet, onSua,
}: {
  ke: string;
  /** đường dẫn ~/.claude/plans/*.md — lấy từ chính tool, không dò chuỗi */
  keFile?: string;
  /** đã bấm duyệt / đã có lượt sau -> chỉ xem lại */
  daDuyet?: boolean;
  onDuyet?: () => void;
  onSua?: () => void;
}) {
  const dai = ke.length > DAI;
  const [mo, setMo] = useState(!dai);
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
        <span aria-hidden className="shrink-0 select-none text-tool-accent">⏺</span>
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
        <span aria-hidden className="shrink-0 select-none text-muted-foreground/40">⌐</span>
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

      {!daDuyet && (onDuyet || onSua) && (
        <div className="ml-[18px] mt-2 flex flex-wrap items-center gap-2 pl-3">
          {onDuyet && (
            <button onClick={onDuyet} data-testid="plan-approve"
              className="tap44 flex items-center gap-1.5 rounded-[8px] bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground">
              <Check className="size-3.5" /> Duyệt &amp; làm
            </button>
          )}
          {onSua && (
            <button onClick={onSua} data-testid="plan-edit"
              className="tap44 flex items-center gap-1.5 rounded-[8px] border border-border px-3 py-1.5 text-[12.5px]">
              <Pencil className="size-3.5" /> Góp ý
            </button>
          )}
          {/* Bản .md đầy đủ trên đĩa — kế hoạch dài hàng chục nghìn ký tự thì đọc
              trong khung chat rất mệt, mở bằng trình xem tử tế dễ hơn nhiều. */}
          {keFile && (
            <a href={'/api/plan?path=' + encodeURIComponent(keFile)} target="_blank"
              rel="noreferrer" data-testid="plan-file"
              className="tap44 flex items-center gap-1.5 rounded-[8px] border border-border px-3 py-1.5 text-[12.5px]">
              <FileText className="size-3.5" /> Mở bản .md
            </a>
          )}
          <span className="text-[11px] text-muted-foreground">
            Duyệt sẽ cho Claude tự sửa file ở lượt này
          </span>
        </div>
      )}
    </div>
  );
}
