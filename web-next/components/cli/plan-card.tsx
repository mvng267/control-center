'use client';

import { useState } from 'react';
import { ClipboardList, ChevronDown, Check, Pencil } from 'lucide-react';
import { Markdown } from './markdown';
import { cn } from '@/lib/utils';

/* Kế hoạch Claude trình ra (ExitPlanMode).

   Trước đây rơi vào thẻ tool chung: cả bản kế hoạch markdown 7.000 ký tự bị đổ vào
   khối <pre> cuộn ngang, đọc như đọc log. Giờ render markdown tử tế, gập lại khi
   dài, và có nút Duyệt ngay tại chỗ.

   Nút Duyệt dùng lại /api/approve/:sid — endpoint sẵn có, ép acceptEdits cho lượt
   duyệt bất kể công tắc quyền đang ở đâu. */

const DAI = 900;   // dài hơn thì gập lại, mở ra khi cần

export function PlanCard({
  ke, daDuyet, onDuyet, onSua,
}: {
  ke: string;
  /** đã bấm duyệt / đã có lượt sau -> chỉ xem lại */
  daDuyet?: boolean;
  onDuyet?: () => void;
  onSua?: () => void;
}) {
  const dai = ke.length > DAI;
  const [mo, setMo] = useState(!dai);

  return (
    <div data-testid="plan-card" data-open={mo}
      className="w-full overflow-hidden rounded-xl border border-tool-accent/35 bg-tool-accent/[0.04]">
      <button onClick={() => dai && setMo((v) => !v)} data-testid="plan-toggle"
        disabled={!dai}
        className={cn('flex w-full items-center gap-2 px-3 py-2 text-left',
          dai && 'tap44 transition-colors hover:bg-accent/30')}>
        <ClipboardList className="size-3.5 shrink-0 text-tool-accent" />
        <span className="text-[12px] font-semibold text-tool-accent">Kế hoạch</span>
        <span className="text-[11px] text-muted-foreground">
          {ke.split('\n').length} dòng
        </span>
        {daDuyet && <span className="text-[11px] text-status-ok">đã duyệt</span>}
        {dai && (
          <ChevronDown className={cn('ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform',
            mo && 'rotate-180')} />
        )}
      </button>

      {mo && (
        <div className="border-t border-tool-accent/20 px-3 py-2.5">
          <div className="max-h-[52dvh] overflow-y-auto text-[13px] leading-relaxed">
            <Markdown>{ke}</Markdown>
          </div>
        </div>
      )}

      {!daDuyet && (onDuyet || onSua) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-tool-accent/20 px-3 py-2">
          {onDuyet && (
            <button onClick={onDuyet} data-testid="plan-approve"
              className="tap44 flex items-center gap-1.5 rounded-[10px] bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground">
              <Check className="size-3.5" /> Duyệt &amp; làm
            </button>
          )}
          {onSua && (
            <button onClick={onSua} data-testid="plan-edit"
              className="tap44 flex items-center gap-1.5 rounded-[10px] border border-border px-3 py-1.5 text-[12.5px]">
              <Pencil className="size-3.5" /> Góp ý
            </button>
          )}
          <span className="text-[11px] text-muted-foreground">
            Duyệt sẽ cho Claude tự sửa file ở lượt này
          </span>
        </div>
      )}
    </div>
  );
}
