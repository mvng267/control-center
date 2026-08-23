'use client';

import { useEffect, useRef } from 'react';
import {
  MessageSquare, Coins, CornerDownRight, ClipboardList, Cpu,
  Terminal, TriangleAlert, Zap, CircleHelp, Bot, Star,
} from 'lucide-react';
import type { Session } from '@/lib/types';
import { useCauHinh } from '@/lib/use-cauhinh';
import { cn } from '@/lib/utils';
import { ResumeButton } from './resume-button';

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

/* Đường nhịp token — SVG thuần, KHÔNG dùng recharts.
   recharts đã có trong dự án nhưng mỗi biểu đồ của nó dựng 30-50 node DOM cộng
   ResponsiveContainer theo dõi kích thước; nhân với 10 dòng mỗi trang là quá nặng
   cho một hình 40×14. Ở cỡ này một thẻ <polyline> là đủ và rẻ hơn hàng chục lần. */
function Nhip({ ds }: { ds: number[] }) {
  if (!ds || ds.length < 2) return null;
  const W = 40, H = 14;
  const max = Math.max(...ds, 1);
  const diem = ds.map((v, i) =>
    `${(i / (ds.length - 1)) * W},${H - (v / max) * (H - 2) - 1}`).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} data-testid="card-nhip"
      className="shrink-0 overflow-visible" aria-hidden>
      <polyline points={diem} fill="none" stroke="currentColor" strokeWidth="1.2"
        strokeLinejoin="round" strokeLinecap="round" className="text-status-ok" />
    </svg>
  );
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
  s, chon, onChon, onOpen, menu, truoc, anDuAn, cheDoChon, onGiuLau, onFav, dangMo,
}: {
  s: Session;
  chon: boolean;
  /** phiên này đang mở ở cột chat bên phải — tô sáng để không mất dấu khi cuộn */
  dangMo?: boolean;
  onChon: (v: boolean) => void;
  /** ghim / bỏ ghim phiên — không truyền thì nút sao vẫn vẽ nhưng bấm không làm gì */
  onFav?: (bat: boolean) => void;
  onOpen: (sid: string) => void;
  menu: React.ReactNode;
  truoc: (ms: number) => string;
  anDuAn?: boolean;      // đang gom nhóm -> tên dự án đã có ở đầu nhóm, khỏi lặp
  cheDoChon?: boolean;   // điện thoại: chỉ hiện ô chọn sau khi chạm giữ
  onGiuLau?: () => void; // chạm giữ để vào chế độ chọn (như ứng dụng Ảnh)
}) {
  const tt = TRANG_THAI[s.status] || TRANG_THAI.IDLE;
  /* Phiên CÓ VẺ TREO thì KHÔNG cho thở: nhịp thở là dấu hiệu "còn sống và đang làm",
     mà đây đúng là trường hợp ngược lại — tiến trình còn nhưng 15 phút không ghi thêm
     dòng nào. Thở tiếp thì nó trông y hệt phiên khoẻ, đúng cái vấn đề cần sửa. */
  const dangChay = ['RUNNING', 'ACTIVE'].includes(s.status) && !s.treo;
  const model = gonModel(s.model);
  const cauHinh = useCauHinh();

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
      /* Viền TRÁI dày + nền thở khi đang chạy: nhìn lướt cả danh sách là thấy ngay
         phiên nào còn sống, không phải soi từng chấm nhỏ trong hàng số liệu.
         `thoNhe` là keyframes riêng ở globals.css — animate-pulse của Tailwind nhấp
         nháy đều và gắt, dùng cho cả dòng thì rối mắt. */
      /* Hiệu ứng vào: thẻ hiện dần + trồi lên nhẹ. Trước đây đổi bộ lọc thì cả danh
         sách thay đột ngột, mắt không bám được cái gì vừa đổi. Giữ NGẮN (150ms) và
         chỉ khi VÀO — cuộn danh sách dài mà mỗi thẻ đều nhảy thì rối hơn là đẹp.
         `motion-safe:` để người bật "giảm chuyển động" trong iOS không phải chịu.

         CHỈ áp cho thẻ KHÔNG chạy: `animate-tho` (nhịp thở vô hạn) dùng chung thuộc
         tính `animation` với `animate-in`, hai cái đè nhau thì mất nhịp thở — mà nhịp
         thở mới là thứ cho biết phiên còn sống. */
      className={cn(
        'group relative flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-xl border border-l-[3px] bg-card px-3 py-2.5 transition-colors',
        dangChay
          ? 'border-l-status-ok border-border animate-tho'
          : 'border-l-border/60 border-border motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-150',
        /* `dangMo` = phiên đang hiện ở cột chat bên phải (bố cục hai cột kiểu Telegram).
           Khác hẳn `chon` — cái đó là chọn-nhiều-để-thao-tác. Cuộn danh sách một lúc mà
           không đánh dấu thì mất dấu mình đang đọc phiên nào. */
        /* Phiên đang mở MÀ đang chạy: `animate-tho` đặt `background-color` mỗi khung
           hình nên nó ĐÈ `bg-accent/50` — đo thật: thẻ có đủ class mà nền tính ra vẫn
           là màu nhịp thở, nhìn không ra thẻ nào đang đọc.
           Viền TRÁI dày là dấu duy nhất animation không đụng tới (nó chỉ đổi
           background-color), nên dùng nó làm dấu chính; nền giữ để lúc phiên đứng yên
           vẫn có mảng sáng. */
        dangMo && 'border-primary border-l-[5px] border-l-primary bg-accent/50',
        chon && 'border-primary',
        !chon && !dangMo && 'hover:border-primary/40 hover:bg-accent/30',
      )}>

      {/* DÒNG 1: chọn + trạng thái + tiêu đề + dự án + số liệu + thời gian */}
      <div className="flex items-center gap-2">
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

        {/* Chấm trạng thái ra ĐẦU DÒNG — trước đây nằm lẫn trong hàng số liệu ở dưới
            cùng nên phải soi mới thấy. */}
        <i data-testid="card-cham" title={tt.nhan}
          className={cn('size-2 shrink-0 rounded-full', tt.cham, dangChay && 'animate-pulse')} />

        {/* Sao ghim — CHỈ hiện khi đã ghim, hoặc khi rê chuột vào thẻ. Hiện thường
            trực trên mọi thẻ thì một danh sách 300 phiên có 300 ngôi sao xám, rối hơn
            là tiện. `stopPropagation` bắt buộc: cả thẻ là vùng bấm mở phiên.
            Trên điện thoại không có hover nên sao luôn hiện mờ — vẫn bấm được. */}
        <button type="button" data-testid="card-fav" data-fav={!!s.fav}
          title={s.fav ? 'Bỏ ghim' : 'Ghim lên đầu danh sách'}
          aria-label={s.fav ? 'Bỏ ghim phiên' : 'Ghim phiên'}
          onClick={(e) => { e.stopPropagation(); onFav?.(!s.fav); navigator.vibrate?.(10); }}
          className={cn('-m-1 shrink-0 p-1 transition-colors',
            s.fav
              ? 'text-status-run'
              : 'text-muted-foreground/35 hover:text-status-run sm:opacity-0 sm:group-hover:opacity-100')}>
          <Star className={cn('size-3.5', s.fav && 'fill-current')} />
        </button>

        {/* KHÔNG shrink-0: tiêu đề dài mà không co được thì nó đẩy dự án và thời gian
            tràn ra ngoài, chữ chồng lên nhau (đo trên iPhone 390px). Cho co + truncate,
            tiêu đề vẫn được ưu tiên chỗ vì các phần khác đều shrink-0. */}
        <span className="min-w-0 truncate text-[14px] font-medium" data-testid="session-title"
          title={s.title || s.sid}>
          {s.title || s.sid.slice(0, 8)}
        </span>

        {/* CÓ VẺ TREO — tiến trình còn sống mà .jsonl im quá 15 phút. Mọi đường chạy
            khác đều có hạn (oneshot 120s, hermes 30s, agy 10 phút), riêng đường chat
            chính thì không, nên Claude kẹt 40 phút vẫn hiện xanh y hệt phiên khoẻ.
            Nói rõ SỐ PHÚT: "treo" chung chung thì không biết có nên dừng hay chờ tiếp. */}
        {!!s.treo && (
          <span data-testid="chip-treo" title={`Không ghi thêm gì suốt ${s.treo} phút — có thể đã kẹt`}
            className="flex shrink-0 items-center gap-1 rounded-full border border-status-run/40 bg-status-run/10 px-1.5 text-[12px] text-status-run">
            <TriangleAlert className="size-3" />
            {s.treo}p
          </span>
        )}

        {s.unread > 0 && (
          <span className="shrink-0 rounded-full bg-destructive px-1.5 text-[12px] font-semibold text-white">
            {s.unread}
          </span>
        )}

        {/* Thư mục gốc đã xoá -> --resume trượt, tin nhắn RƠI VÀO HƯ KHÔNG. */}
        {s.duAn && !s.duAn.conTonTai && (
          <span data-testid="card-mat" title="Thư mục gốc đã bị xoá — nhắn vào phiên này sẽ không tới nơi"
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-status-error/12 px-1.5 py-px text-[12px] font-medium text-status-error">
            <TriangleAlert className="size-3" />đã xoá
          </span>
        )}

        {/* Auto-restart button when session hung >15 min */}
        {!!s.treo && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full"
          >
            <ResumeButton
              sid={s.sid}
              hungMinutes={s.treo}
              onResume={() => {
                /* Reload sẽ fetch lại history từ server với process mới */
                window.location.reload();
              }}
            />
          </div>
        )}

        <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">
          {truoc(s.mtimeMs)}
        </span>
        <div onClick={(e) => e.stopPropagation()}>{menu}</div>
      </div>

      {/* DÒNG 2: dự án — tách RIÊNG khỏi dòng tiêu đề để repo + nhánh không bị cắt.
          Trước đây nhét chung dòng 1 và chặn ở 7rem, nên tên miền dài
          hay "chu-repo/ten-repo · main" gần như luôn bị truncate. */}
      {!anDuAn && (
        <div className="flex min-w-0 items-center gap-1.5 pl-4 text-[12px] text-muted-foreground"
          data-testid="card-project">
          <Terminal className="size-3 shrink-0 opacity-50" />
          <span className="shrink-0 font-medium text-foreground/65">{s.duAn?.ten || s.project}</span>
          {!!(s.duAn?.repo || s.duAn?.duongDan) && (
            <span className="truncate opacity-65" title={s.duAn?.duongDan}>
              {s.duAn?.repo ? s.duAn.repo + (s.duAn.nhanh ? ' · ' + s.duAn.nhanh : '') : s.duAn?.duongDan}
            </span>
          )}
        </div>
      )}

      {/* DÒNG 3: đang dở việc gì. Ưu tiên LỆNH ĐANG CHẠY vì đó mới là thứ đang diễn
          ra ngay lúc này; không có thì mới hiện câu cuối. Dùng TRỌN bề rộng — số liệu
          đã tách xuống dòng 4 nên không phải giành chỗ nữa. */}
      <div className="flex min-w-0 items-center gap-2 pl-4">
        <div className="flex min-w-0 flex-1 items-center gap-1.5" data-testid="card-last">
          {s.dangChay ? (
            <>
              <Zap className="size-3 shrink-0 animate-pulse text-status-ok" />
              <span className="truncate text-[12px] text-status-ok" data-testid="card-lenh">
                đang chạy {s.dangChay}
              </span>
            </>
          ) : s.tinCuoi ? (
            <>
              <CornerDownRight className="size-3 shrink-0 text-muted-foreground/40" />
              <p className="truncate text-[12px] leading-snug text-muted-foreground">
                <span className={cn('font-medium', s.vaiCuoi === 'user' ? 'text-primary' : 'text-tool-accent')}>
                  {s.vaiCuoi === 'user' ? cauHinh.nguoiDung + ': ' : 'Claude: '}
                </span>
                {s.tinCuoi}
              </p>
            </>
          ) : (
            <span className={cn('text-[12px]', tt.chu)}>{tt.nhan}</span>
          )}
        </div>

      </div>

      {/* DÒNG 4: số liệu — dòng RIÊNG nên hiện đủ, không phải ẩn dần theo bề rộng
          như hồi còn chen chung với câu cuối. */}
      <div className="flex min-w-0 items-center gap-3 pl-4 text-[12px] tabular-nums text-muted-foreground">
        <span className="inline-flex items-center gap-1" title={s.msgs + ' tin nhắn'}>
          <MessageSquare className="size-3 opacity-60" />{s.luot || s.msgs} lượt
        </span>
        {!!s.tok && (
          <span className="inline-flex items-center gap-1"
            title={s.tok.toLocaleString('vi-VN') + ' token'}>
            <Coins className="size-3 opacity-60" />{gonSo(s.tok)}
          </span>
        )}
        {!!model && (
          <span className="inline-flex min-w-0 items-center gap-1" data-testid="card-model"
            title={(s.model || '') + (s.effort ? ' · mức nghĩ ' + s.effort : '')}>
            <Cpu className="size-3 shrink-0 opacity-60" />
            <span className="truncate">{model}{s.effort ? '·' + s.effort : ''}</span>
          </span>
        )}
        {/* Agent con đang chạy. Claude phóng subagent thì phiên vẫn nhìn như đang
            im — thanh "đang chạy" ở dòng 3 chỉ hiện tool của lượt chính, không thấy
            agent nào. Đo thật: agent chạy trung vị 3,9 phút, có cái 13,5 phút — cả
            quãng đó thẻ trông như phiên đã dừng. */}
        {!!s.agentChay && (
          <span className="inline-flex min-w-0 items-center gap-1 text-status-ok"
            data-testid="card-agent"
            title={s.agentTen?.length ? 'Agent đang chạy: ' + s.agentTen.join(', ') : undefined}>
            <Bot className="size-3 shrink-0 animate-pulse" />
            {s.agentChay} agent
          </span>
        )}
        {/* Nhịp token — server chỉ gửi cho phiên ĐANG CHẠY, phiên nghỉ thì đường
            phẳng lì nên không vẽ. Dồn về phải cho thẳng hàng giữa các dòng. */}
        {!!s.nhip?.length && <span className="ml-auto"><Nhip ds={s.nhip} /></span>}
      </div>

      {/* Phiên ĐỨNG IM CHỜ NGƯỜI BẤM — trước đây chỉ biết khi mở phiên ra.
          Hai loại khác nhau: duyệt kế hoạch, và Claude hỏi để chọn phương án. */}
      {s.choDuyet && (
        <div data-testid="card-plan" data-cho={s.cho || 'ke-hoach'}
          className="ml-4 flex items-center gap-1.5 rounded-md border border-primary/35 bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">
          {s.cho === 'cau-hoi'
            ? <><CircleHelp className="size-3 shrink-0" /> Claude đang hỏi — cần chọn</>
            : <><ClipboardList className="size-3 shrink-0" /> Đang chờ duyệt kế hoạch</>}
        </div>
      )}
    </div>
  );
}
