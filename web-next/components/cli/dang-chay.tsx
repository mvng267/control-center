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
   chờ 2 giây với chờ 2 phút là hai chuyện khác hẳn. */
function chuTheoGiay(s: number) {
  if (s < 5) return 'Đang nghĩ';
  if (s < 20) return 'Đang làm';
  if (s < 60) return 'Vẫn đang chạy';
  if (s < 180) return 'Việc này hơi lâu';
  return 'Chạy khá lâu rồi';
}

export function DangChay({ onStop }: { onStop: () => void }) {
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
    <div className="flex shrink-0 items-center gap-2 px-4 pb-1 font-mono text-[13px]"
      data-testid="typing">
      {/* Bông hoa xoay — dấu hiệu Claude còn sống, thấy ngay không cần đọc chữ */}
      <span aria-hidden data-testid="hoa-xoay"
        className="w-[1ch] shrink-0 select-none text-center text-tool-accent">
        {HOA[pha]}
      </span>
      <span className="text-muted-foreground">{chuTheoGiay(giay)}…</span>
      <span className={cn('tabular-nums',
        giay >= 180 ? 'text-status-run' : 'text-muted-foreground/60')}
        data-testid="dem-giay">
        {thoiGian}
      </span>
      <Button size="sm" variant="ghost" onClick={onStop} data-testid="stop-btn"
        className="tap44 ml-auto h-7 px-2 font-mono text-[12px] text-status-error hover:text-status-error">
        <Square className="size-3" /> Dừng
        <span className="hidden text-muted-foreground/50 sm:inline">esc</span>
      </Button>
    </div>
  );
}
