'use client';

import { MessageSquare, Coins, CornerDownRight, ClipboardList } from 'lucide-react';
import type { Session } from '@/lib/types';
import { cn } from '@/lib/utils';

/* Thẻ phiên — thay cho bảng ngang.

   Bảng cũ ép mỗi phiên vào một hàng cao 57px với 6 cột, nên thứ quan trọng nhất
   ("phiên này đang dở việc gì") không có chỗ mà hiện. Trên iPhone bảng còn bị ẩn hẳn,
   thay bằng một dòng gọn hơn nữa — muốn biết phiên nào đáng mở thì phải mở từng cái.

   Thẻ hiện đủ trong một lần nhìn: tiêu đề, dự án, trạng thái, câu cuối, số lượt,
   token, thời gian. Mọi trường đều có thật từ server, không bịa. */

const TRANG_THAI: Record<string, { cham: string; chu: string; nhan: string }> = {
  RUNNING: { cham: 'bg-status-ok', chu: 'text-status-ok', nhan: 'Đang chạy' },
  ACTIVE: { cham: 'bg-primary', chu: 'text-primary', nhan: 'Vừa hoạt động' },
  IDLE: { cham: 'bg-status-idle', chu: 'text-muted-foreground', nhan: 'Nghỉ' },
};

/** 2.870.410 -> "2,9M" — số token thô dài quá, đọc lướt không kịp. */
function gonSo(n: number) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}

export function SessionCard({
  s, chon, onChon, onOpen, menu, truoc,
}: {
  s: Session;
  chon: boolean;
  onChon: (v: boolean) => void;
  onOpen: (sid: string) => void;
  menu: React.ReactNode;
  truoc: (ms: number) => string;
}) {
  const tt = TRANG_THAI[s.status] || TRANG_THAI.IDLE;
  const dangChay = ['RUNNING', 'ACTIVE'].includes(s.status);

  return (
    <div data-testid="session-row" data-sid={s.sid} data-status={s.status}
      onClick={() => onOpen(s.sid)}
      /* min-w-0 là BẮT BUỘC: ô lưới mặc định min-width:auto, nên câu cuối dài đẩy
         thẻ phình ra 455px trong khung 356px — chữ bị cắt mất bên phải (đo trên
         iPhone 390px). Không có nó thì line-clamp/truncate bên trong đều vô nghĩa. */
      className={cn(
        'group relative flex min-w-0 cursor-pointer flex-col gap-2 rounded-xl border bg-card p-3 transition-colors',
        chon ? 'border-primary' : 'border-border hover:border-primary/40 hover:bg-accent/30',
      )}>

      {/* hàng 1: chọn + tiêu đề + menu */}
      <div className="flex items-start gap-2">
        {/* Bọc <label> để nới VÙNG CHẠM lên 44px mà không phóng to ô vuông.
            Đo trên iPhone: ô chỉ 16×16, ngón tay lệch 18px là trượt — mà trượt thì
            rơi vào thẻ và MỞ NHẦM PHIÊN, chứ không phải không ăn gì.
            -m-3 p-3 giữ bố cục y nguyên: phần nới ra chồng lên khoảng trống sẵn có. */}
        {/* min-w/h 44px ÉP vùng chạm, không dựa vào đệm: thu ô vuông từ 16px xuống
            14px làm vùng chạm tụt còn 34px, dưới ngưỡng ngón tay. -m-2.5 kéo phần
            nới ra chồng lên khoảng trống sẵn có nên thẻ không cao thêm. */}
        <label className="-m-2.5 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center"
          onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" data-testid="sel-row"
            className="size-3.5 cursor-pointer accent-primary"
            checked={chon}
            onChange={(e) => onChon(e.target.checked)} />
        </label>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-medium" data-testid="session-title" title={s.sid}>
              {s.title || s.sid.slice(0, 8)}
            </span>
            {s.unread > 0 && (
              <span className="shrink-0 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
                {s.unread}
              </span>
            )}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">{s.project}</div>
        </div>

        <div onClick={(e) => e.stopPropagation()}>{menu}</div>
      </div>

      {/* hàng 2: đang dở việc gì — thứ bảng cũ KHÔNG hiện được chỗ nào */}
      {s.tinCuoi && (
        <div className="flex gap-1.5 pl-6" data-testid="card-last">
          <CornerDownRight className="mt-[3px] size-3 shrink-0 text-muted-foreground/50" />
          <p className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground">
            <span className={cn('font-medium', s.vaiCuoi === 'user' ? 'text-primary' : 'text-tool-accent')}>
              {s.vaiCuoi === 'user' ? 'Vinh: ' : 'Claude: '}
            </span>
            {s.tinCuoi}
          </p>
        </div>
      )}

      {/* hàng 3: các số liệu + trạng thái */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-[11.5px] text-muted-foreground">
        <span className={cn('inline-flex items-center gap-1.5', tt.chu)}>
          <i className={cn('size-1.5 rounded-full', tt.cham, dangChay && 'animate-pulse')} />
          {tt.nhan}
        </span>
        <span className="inline-flex items-center gap-1 tabular-nums" title={s.msgs + ' tin nhắn'}>
          <MessageSquare className="size-3" />{s.luot ? s.luot + ' lượt' : s.msgs + ' tin'}
        </span>
        {!!s.tok && (
          <span className="inline-flex items-center gap-1 tabular-nums" title={s.tok.toLocaleString('vi-VN') + ' token'}>
            <Coins className="size-3" />{gonSo(s.tok)}
          </span>
        )}
        <span className="ml-auto shrink-0 tabular-nums">{truoc(s.mtimeMs)}</span>
      </div>

      {/* Chờ duyệt kế hoạch: phải đập vào mắt ngay ở danh sách, vì phiên đang ĐỨNG
          IM chờ người bấm — trước đây chỉ biết khi mở phiên ra. */}
      {s.choDuyet && (
        <div data-testid="card-plan"
          className="ml-6 flex items-center gap-1.5 rounded-lg border border-primary/35 bg-primary/10 px-2 py-1 text-[11.5px] font-medium text-primary">
          <ClipboardList className="size-3.5 shrink-0" /> Đang chờ duyệt kế hoạch
        </div>
      )}
    </div>
  );
}
