'use client';

import { useEffect, useRef } from 'react';
import { MessageSquare, Coins, CornerDownRight, ClipboardList, Cpu } from 'lucide-react';
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

/** claude-fable-5 -> Fable, claude-opus-5 -> Opus. Tên đầy đủ dài gấp ba mà không
    thêm thông tin nào ở mức xem lướt. */
function gonModel(m?: string | null) {
  if (!m) return '';
  const x = String(m).replace(/^claude-/, '').replace(/-\d[\d-]*$/, '');
  if (x === '<synthetic>') return '';   // dòng lỗi API, không phải model thật
  return x.charAt(0).toUpperCase() + x.slice(1);
}

export function SessionCard({
  s, chon, onChon, onOpen, menu, truoc, anDuAn, cheDoChon, onGiuLau,
}: {
  s: Session;
  chon: boolean;
  onChon: (v: boolean) => void;
  onOpen: (sid: string) => void;
  menu: React.ReactNode;
  truoc: (ms: number) => string;
  anDuAn?: boolean;      // đang gom nhóm -> tên dự án đã có ở đầu nhóm, khỏi lặp
  cheDoChon?: boolean;   // điện thoại: chỉ hiện ô chọn sau khi chạm giữ
  onGiuLau?: () => void; // chạm giữ để vào chế độ chọn (như ứng dụng Ảnh)
}) {
  const tt = TRANG_THAI[s.status] || TRANG_THAI.IDLE;
  const dangChay = ['RUNNING', 'ACTIVE'].includes(s.status);
  const model = gonModel(s.model);

  /* Chạm giữ 500ms = vào chế độ chọn. Phải huỷ hẹn giờ khi nhấc tay hoặc khi ngón
     trượt đi (người dùng đang cuộn danh sách, không phải muốn chọn). */
  const hen = useRef<ReturnType<typeof setTimeout> | null>(null);
  const huy = () => { if (hen.current) { clearTimeout(hen.current); hen.current = null; } };
  const batDauGiu = () => {
    huy();
    hen.current = setTimeout(() => { hen.current = null; onGiuLau?.(); navigator.vibrate?.(15); }, 500);
  };
  useEffect(() => huy, []);

  return (
    <div data-testid="session-row" data-sid={s.sid} data-status={s.status}
      onClick={() => { if (hen.current) return; onOpen(s.sid); }}
      onTouchStart={onGiuLau ? batDauGiu : undefined}
      onTouchEnd={huy} onTouchMove={huy} onTouchCancel={huy}
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
        {/* Trên điện thoại ô chọn ẨN cho tới khi chạm giữ một thẻ: hàng "Chọn cả
            trang" đã bỏ đi, để lại ô vuông trên từng thẻ thì vẫn là ô vuông không
            giải thích được. Desktop (sm:flex) luôn hiện vì có chỗ. */}
        <label data-testid="sel-row-wrap"
          className={cn('-m-2.5 min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center sm:flex',
            cheDoChon ? 'flex' : 'hidden')}
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
          {/* Đang gom nhóm thì tên dự án đã nằm ở đầu nhóm — lặp lại trên từng thẻ chỉ
              tốn thêm một dòng, mà trên iPhone mỗi dòng là một thẻ ít đi. */}
          {!anDuAn && (
            <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground"
              data-testid="card-project">
              <span className="shrink-0 font-medium text-foreground/75">{s.duAn?.ten || s.project}</span>
              {/* Repo GitHub khi có git, không thì đường dẫn rút gọn — trả lời câu
                  "dự án này nằm ở đâu" ngay trên thẻ, khỏi mở phiên ra xem. */}
              {!!(s.duAn?.repo || s.duAn?.duongDan) && (
                <span className="truncate" title={s.duAn?.duongDan}>
                  {s.duAn?.repo
                    ? s.duAn.repo + (s.duAn.nhanh ? ' · ' + s.duAn.nhanh : '')
                    : s.duAn?.duongDan}
                </span>
              )}
              {/* Thư mục gốc đã bị xoá -> --resume trượt và tin nhắn RƠI VÀO HƯ KHÔNG.
                  Trước đây chỉ biết sau khi đã gửi. 24 phiên trên máy này dính. */}
              {s.duAn && !s.duAn.conTonTai && (
                <span data-testid="card-mat" title="Thư mục gốc đã bị xoá — nhắn vào phiên này sẽ không tới nơi"
                  className="shrink-0 rounded-md bg-status-error/12 px-1.5 py-px text-[10.5px] font-medium text-status-error">
                  thư mục đã xoá
                </span>
              )}
            </div>
          )}
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
        {/* Model + mức nghĩ: đọc thẳng từ .jsonl của phiên, nên đúng cả với phiên
            chạy từ terminal chứ không riêng phiên do dashboard tạo. */}
        {!!model && (
          <span className="inline-flex items-center gap-1" data-testid="card-model"
            title={(s.model || '') + (s.effort ? ' · mức nghĩ ' + s.effort : '')}>
            <Cpu className="size-3" />{model}{s.effort ? ' · ' + s.effort : ''}
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
