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
  const [tab, setTab] = useState(0);

  const bam = (qi: number, oi: number, nhieu: boolean) => {
    if (daTraLoi || daGui) return;

    /* Tính state MỚI ở ngoài, KHÔNG gọi setTab bên trong hàm cập nhật của setChon.
       Hàm cập nhật phải thuần tuý — React được phép chạy nó nhiều lần rồi bỏ kết quả,
       nên đặt setState khác vào trong là mất cả hai. Đo được: bấm câu thứ ba làm
       sạch luôn cả ba lựa chọn (✓✓✓ -> trống trơn), nút Gửi khoá vĩnh viễn. */
    const cu = chon[qi] ? new Set(chon[qi]) : new Set<number>();
    if (nhieu) { cu.has(oi) ? cu.delete(oi) : cu.add(oi); }
    else { cu.clear(); cu.add(oi); }
    const moi = { ...chon, [qi]: cu };
    setChon(moi);

    /* Chọn xong -> tự nhảy sang câu CHƯA trả lời. Bắt bấm tay từng tab thì rất dễ
       tưởng đã xong rồi bấm Gửi, mà nút lại khoá vì còn câu bỏ trống ở tab khuất.
       Câu chọn-nhiều thì ở lại để còn tick tiếp. */
    if (!nhieu) {
      const con = hoi.findIndex((_, i) => (moi[i]?.size || 0) === 0);
      if (con >= 0) setTab(con);
    }
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
          <span className="ml-auto text-[12px] text-muted-foreground">
            {daGui ? 'đã gửi' : 'đã trả lời'}
          </span>
        )}
      </div>

      {/* TAB NGANG như Claude CLI: mỗi lúc chỉ hiện MỘT câu.
          Bản trước đổ hết câu hỏi xuống một cột dọc — đo với 3 câu (đúng bộ người dùng gửi
          ảnh) ra 623px, dài gần trọn màn điện thoại và không thấy được nút Gửi.
          Nhãn tab còn cho biết đang ở câu mấy trong bao nhiêu câu. */}
      {hoi.length > 1 && (
        <div className="flex items-stretch gap-1 overflow-x-auto border-b border-primary/15 px-2"
          style={{ scrollbarWidth: 'none' }} data-testid="ask-tabs">
          {hoi.map((q, i) => {
            const xong = (chon[i]?.size || 0) > 0;
            return (
              <button key={i} onClick={() => setTab(i)} data-testid="ask-tab" data-active={tab === i}
                className={cn('shrink-0 whitespace-nowrap border-b-2 px-2 py-1.5 text-[12px] transition-colors',
                  tab === i ? 'border-primary font-medium text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground')}>
                {q.nhan || `Câu ${i + 1}`}
                {/* dấu ✓ để biết câu nào đã chọn xong mà không phải bấm qua từng tab */}
                {xong && <Check className="ml-1 inline size-3 text-status-ok" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-3 px-3 py-2.5">
        {hoi.map((q, qi) => (
          <div key={qi} className={cn('flex-col gap-2', qi === tab ? 'flex' : 'hidden')}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-[14px] font-medium leading-snug">{q.hoi}</span>
              {q.nhieu && <span className="text-[12px] text-muted-foreground">(chọn nhiều được)</span>}
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
                      'mt-[2px] flex size-4 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground',
                    )}>
                      {on ? <Check className="size-2.5" /> : oi + 1}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[14px] font-medium leading-snug">{o.nhan}</span>
                      {o.mo && (
                        <span className="text-[12px] leading-relaxed text-muted-foreground">{o.mo}</span>
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
                'tap44 flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 py-2 text-[14px] font-medium transition-colors',
                dayDu ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}>
              <Send className="size-3.5" /> Gửi lựa chọn
            </button>
            {/* Còn câu bỏ trống thì NÓI RÕ còn mấy câu. Nút xám mà không giải thích
                thì tưởng hỏng — nhất là khi câu chưa trả lời nằm ở tab khác, khuất
                khỏi tầm mắt. */}
            <span className="text-[12px] leading-snug text-muted-foreground">
              {dayDu
                ? 'Gửi thành một tin nhắn mới — dashboard không nối được vào lượt đang chờ như terminal'
                : `Còn ${hoi.filter((_, i) => (chon[i]?.size || 0) === 0).length} câu chưa chọn`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
