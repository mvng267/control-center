'use client';

import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* Trạng thái "Claude đang làm" — kiểu Claude CLI.

   Bản cũ chỉ có ba chấm xám nhấp nháy: không biết Claude đang làm gì, đã chạy bao
   lâu, hay đã treo. Terminal thật in một BÔNG HOA xoay + động từ + số giây trôi,
   nên nhìn là biết nó còn sống.

   Bông hoa vẽ bằng ký tự chứ không dùng ảnh: khung chat dùng phông chữ đều nên ký
   tự nằm đúng ô, không lệch dòng như chèn <img>. */

// Các pha của bông hoa — đúng bộ ký tự Claude CLI xoay qua
const HOA = ['✻', '✼', '✽', '✾', '✿', '❀', '✿', '✾', '✽', '✼'];

/* Động từ đổi theo thời gian chờ. CLI cũng đổi chữ để biết nó không đứng im —
   chờ 2 giây với chờ 2 phút là hai chuyện khác hẳn.
   Giọng suồng sã có chủ đích: chờ lâu mà màn hình nói chuyện khô khan thì càng sốt
   ruột. Chữ vẫn nói ĐÚNG việc (đang chạy bao lâu), chỉ khác cách nói. */
function chuTheoGiay(s: number) {
  if (s < 5) return 'Để tao nghĩ tí';
  if (s < 20) return 'Đang cày đây';
  if (s < 60) return 'Cái này khó phết';
  if (s < 180) return 'Khó vcl, chờ tí';
  if (s < 600) return 'Đủ lâu để đi pha cà phê rồi';
  return 'Đang làm khó nhau rồi đấy';
}

/* Hoa Claude dùng riêng ở header — chỉ bông hoa, không chữ không nút.
   Xoay khi đang chạy, đứng yên và mờ khi nghỉ: nhìn một cái là biết phiên còn sống
   hay không, khỏi phải đọc nhãn trạng thái. */
export function HoaClaude({ chay }: { chay: boolean }) {
  const [pha, setPha] = useState(0);
  useEffect(() => {
    if (!chay) return;
    const t = setInterval(() => setPha((p) => (p + 1) % HOA.length), 120);
    return () => clearInterval(t);
  }, [chay]);
  return (
    <span aria-hidden data-testid="hoa-header" data-chay={chay}
      className={cn('w-[1ch] shrink-0 select-none text-center font-mono text-[15px]',
        chay ? 'text-status-ok' : 'text-muted-foreground/35')}>
      {chay ? HOA[pha] : HOA[0]}
    </span>
  );
}

export function DangChay({ onStop, lenh }: { onStop: () => void; lenh?: string }) {
  const [pha, setPha] = useState(0);
  const [giay, setGiay] = useState(0);

  useEffect(() => {
    const a = setInterval(() => setPha((p) => (p + 1) % HOA.length), 120);
    const b = setInterval(() => setGiay((g) => g + 1), 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  const phut = Math.floor(giay / 60);
  const thoiGian = phut > 0 ? `${phut}p ${giay % 60}s` : `${giay}s`;

  return (
    /* Dải NỔI ngay trên ô gõ, có khung riêng — không trộn vào dòng chat.
       Trước đây nó là một dòng trần lẫn giữa nội dung, cuộn đi là mất; mà lúc cần
       bấm Dừng nhất chính là lúc Claude chạy lâu và mình đã cuộn đi chỗ khác. */
    <div data-testid="typing"
      className="mx-3 mb-1.5 flex shrink-0 flex-col gap-0.5 rounded-lg border border-status-ok/30 bg-status-ok/[0.06] px-2.5 py-1.5 font-mono text-[12.5px]">
      <div className="flex items-center gap-2">
        {/* Bông hoa xoay — dấu hiệu Claude còn sống, thấy ngay không cần đọc chữ */}
        <span aria-hidden data-testid="hoa-xoay"
          className="w-[1ch] shrink-0 select-none text-center text-status-ok">
          {HOA[pha]}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground/80">{chuTheoGiay(giay)}…</span>
        <span className={cn('shrink-0 tabular-nums',
          giay >= 180 ? 'text-status-run' : 'text-muted-foreground/70')}
          data-testid="dem-giay">
          {thoiGian}
        </span>
        <Button size="sm" variant="ghost" onClick={onStop} data-testid="stop-btn"
          className="tap44 h-7 shrink-0 px-2 font-mono text-[12px] text-status-error hover:text-status-error">
          <Square className="size-3" /> Dừng
          <span className="hidden text-muted-foreground/50 sm:inline">esc</span>
        </Button>
      </div>
      {/* Lệnh đang chạy dở — biết Claude kẹt ở đâu mà không phải cuộn lên tìm */}
      {!!lenh && (
        <div className="truncate pl-[calc(1ch+0.5rem)] text-[11.5px] text-muted-foreground/75"
          data-testid="dang-chay-lenh" title={lenh}>
          {lenh}
        </div>
      )}
    </div>
  );
}
