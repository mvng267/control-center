'use client';

import { useState } from 'react';
import { CircleHelp, Check, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

/* Bảng chọn khi Claude hỏi (AskUserQuestion).

   Trên terminal đây là danh sách đánh số để bấm phím. Ở dashboard trước đây nó rơi
   vào thẻ tool chung nên hiện ra JSON THÔ với dấu ngoặc thoát chồng chất — không
   đọc nổi câu hỏi là gì, nói gì đến trả lời.

   Giới hạn cần biết: dashboard chạy `claude -p`, mỗi lượt một tiến trình rời, KHÔNG
   phải phiên tương tác. Nên không có kênh để "bấm chọn số 2" như terminal — bấm ở
   đây sẽ gửi lựa chọn thành một TIN NHẮN mới vào phiên, Claude đọc rồi làm tiếp. */

export interface CauHoi {
  hoi: string;
  nhan: string;
  nhieu: boolean;
  chon: { nhan: string; mo: string }[];
}

export function AskCard({
  hoi, daTraLoi, onGui,
}: {
  hoi: CauHoi[];
  /** đã có tin trả lời sau đó rồi -> chỉ xem lại, không cho bấm nữa */
  daTraLoi?: boolean;
  onGui?: (text: string) => void;
}) {
  const [chon, setChon] = useState<Record<number, Set<number>>>({});
  const [daGui, setDaGui] = useState(false);

  const bam = (qi: number, oi: number, nhieu: boolean) => {
    if (daTraLoi || daGui) return;
    setChon((c) => {
      const cu = c[qi] ? new Set(c[qi]) : new Set<number>();
      if (nhieu) { cu.has(oi) ? cu.delete(oi) : cu.add(oi); }
      else { cu.clear(); cu.add(oi); }
      return { ...c, [qi]: cu };
    });
  };

  const dayDu = hoi.every((_, i) => (chon[i]?.size || 0) > 0);

  const gui = () => {
    if (!onGui || !dayDu) return;
    // Ghép thành câu trả lời đọc được — Claude nhận nó như tin nhắn bình thường
    const dong = hoi.map((q, i) => {
      const ten = [...(chon[i] || [])].map((oi) => q.chon[oi]?.nhan).filter(Boolean);
      return `${q.nhan || q.hoi}: ${ten.join(', ')}`;
    });
    setDaGui(true);
    onGui(dong.join('\n'));
  };

  const khoa = daTraLoi || daGui;

  return (
    <div data-testid="ask-card"
      className="w-full overflow-hidden rounded-xl border border-primary/30 bg-primary/[0.04]">
      <div className="flex items-center gap-2 border-b border-primary/20 px-3 py-2">
        <CircleHelp className="size-3.5 shrink-0 text-primary" />
        <span className="text-[12px] font-semibold text-primary">Claude hỏi</span>
        {khoa && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {daGui ? 'đã gửi' : 'đã trả lời'}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 px-3 py-2.5">
        {hoi.map((q, qi) => (
          <div key={qi} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-2">
              {q.nhan && (
                <span className="rounded bg-primary/15 px-1.5 py-px text-[10.5px] font-medium text-primary">
                  {q.nhan}
                </span>
              )}
              <span className="text-[13px] font-medium leading-snug">{q.hoi}</span>
              {q.nhieu && <span className="text-[11px] text-muted-foreground">(chọn nhiều được)</span>}
            </div>

            <div className="flex flex-col gap-1.5">
              {q.chon.map((o, oi) => {
                const on = chon[qi]?.has(oi);
                return (
                  <button key={oi} onClick={() => bam(qi, oi, q.nhieu)} disabled={khoa}
                    data-testid="ask-option" data-active={!!on}
                    className={cn(
                      'tap44 flex items-start gap-2 rounded-[10px] border px-2.5 py-2 text-left transition-colors',
                      on ? 'border-primary bg-primary/10' : 'border-border bg-card',
                      khoa ? 'cursor-default opacity-70' : 'hover:bg-accent/50',
                    )}>
                    <span className={cn(
                      'mt-[2px] flex size-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground',
                    )}>
                      {on ? <Check className="size-2.5" /> : oi + 1}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[12.5px] font-medium leading-snug">{o.nhan}</span>
                      {o.mo && (
                        <span className="text-[11.5px] leading-relaxed text-muted-foreground">{o.mo}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {!khoa && onGui && (
          /* Xếp DỌC trên điện thoại: để ngang thì câu giải thích dài bóp nút "Gửi
             lựa chọn" xuống còn 3 dòng chữ chồng lên nhau (đo trên iPhone 390px). */
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button onClick={gui} disabled={!dayDu} data-testid="ask-send"
              className={cn(
                'tap44 flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-[12.5px] font-medium transition-colors',
                dayDu ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}>
              <Send className="size-3.5" /> Gửi lựa chọn
            </button>
            <span className="text-[11px] leading-snug text-muted-foreground">
              Gửi thành một tin nhắn mới — dashboard không nối được vào lượt đang chờ như terminal
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
