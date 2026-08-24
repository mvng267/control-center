'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/app-shell';
import { RefreshCw, Loader2, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/* Tab Hạn mức — đọc từ `claude -p /usage`.

   Vì sao đáng một tab riêng: hết hạn mức là thứ CHẶN việc, mà trước đây chỉ biết khi
   Claude đột ngột trả lỗi giữa lượt. Trên iPhone lại càng khó đoán vì không thấy
   terminal.

   Server đã parse thành số và cache 60 giây (`/usage` spawn CLI, đo thật 8,4 giây —
   không thể gọi theo nhịp SSE). Ở đây chỉ vẽ. */

interface Muc { ten: string; phanTram: number; datLai: string }
interface Quota {
  ok: boolean; muc?: Muc[]; kieu?: string; tho?: string; error?: string; luc?: number; cache?: boolean;
}

/* Tên tiếng Anh của CLI -> nhãn tiếng Việt. Không khớp thì giữ nguyên tên gốc còn hơn
   đoán sai: CLI có thể thêm mức mới (theo model, theo tổ chức) bất cứ lúc nào. */
const NHAN: Record<string, string> = {
  'Current session': 'Phiên hiện tại',
  'Current week (all models)': 'Tuần này — tất cả model',
};
function nhanVi(ten: string) {
  if (NHAN[ten]) return NHAN[ten];
  const m = ten.match(/^Current week \((.+)\)$/);
  if (m) return 'Tuần này — ' + m[1];
  return ten;
}

/* Dòng đầu của `/usage` cho biết đang tính tiền kiểu nào. Chỉ dịch hai câu CLI thật sự
   in ra; câu lạ thì giữ nguyên văn còn hơn dịch sai — đây là thông tin về tiền. */
function kieuVi(s: string) {
  if (/subscription/i.test(s)) return 'Đang dùng gói thuê bao cho Claude Code';
  if (/API|credit/i.test(s)) return 'Đang tính theo API credit';
  return s;
}

/* Màu theo mức đã dùng. Ngưỡng 75/90 chứ không phải 50/80: hạn mức tuần dùng 43% giữa
   tuần là bình thường, tô vàng ở đó thì cảnh báo mất nghĩa. */
function mauTheoMuc(p: number) {
  if (p >= 90) return 'bg-status-error';
  if (p >= 75) return 'bg-status-run';
  return 'bg-status-ok';
}

function ThanhMuc({ m }: { m: Muc }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid="quota-muc">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{nhanVi(m.ten)}</span>
        <span className={cn('shrink-0 text-[14px] font-semibold tabular-nums',
          m.phanTram >= 90 ? 'text-status-error' : m.phanTram >= 75 ? 'text-status-run' : 'text-foreground')}
          data-testid="quota-phantram">
          {m.phanTram}%
        </span>
      </div>
      {/* Thanh tiến độ vẽ tay, không kéo thêm component: chỉ là một div nền + một div
          phủ, thêm cả một thư viện cho việc này là thừa. */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar"
        aria-valuenow={m.phanTram} aria-valuemin={0} aria-valuemax={100} aria-label={nhanVi(m.ten)}>
        <div className={cn('h-full rounded-full transition-[width] duration-500', mauTheoMuc(m.phanTram))}
          style={{ width: Math.min(100, Math.max(0, m.phanTram)) + '%' }} />
      </div>
      {!!m.datLai && (
        <span className="text-[12px] text-muted-foreground">Đặt lại {m.datLai}</span>
      )}
    </div>
  );
}

export function QuotaTab() {
  const [q, setQ] = useState<Quota | null>(null);
  const [dangTai, setDangTai] = useState(false);

  const tai = useCallback(async (moi?: boolean) => {
    setDangTai(true);
    try { setQ(await api<Quota>('/api/quota' + (moi ? '?moi=1' : ''))); }
    catch { setQ({ ok: false, error: 'Không gọi được server' }); }
    finally { setDangTai(false); }
  }, []);

  useEffect(() => { tai(); }, [tai]);

  /* Phần "gì đang ăn hạn mức" giữ nguyên văn bản gốc: đó là văn xuôi tự do (top skills,
     top subagents, % theo hành vi), parse ra cấu trúc thì vừa mong manh vừa mất chữ.
     Cắt bỏ phần đầu vì ba dòng số đã vẽ thành thanh ở trên rồi. */
  const phanTich = (() => {
    const t = q?.tho || '';
    const i = t.indexOf("What's contributing");
    return i >= 0 ? t.slice(i) : '';
  })();

  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="quota-tab">
      {/* Dùng PageHeader như MỌI tab khác. Trước đây tab này tự vẽ `h2` 14px trong khi
          các tab kia có tiêu đề 19-24px — nhìn như lạc sang giao diện khác. Lọt được
          vì `quota` không nằm trong mảng TABS mà bài test duyệt qua. */}
      <PageHeader title="Hạn mức" desc="Còn bao nhiêu hạn mức Claude, và gì đang ăn nhiều nhất."
        actions={(
          <button onClick={() => tai(true)} disabled={dangTai} data-testid="quota-lam-moi"
            title="Hỏi lại CLI (bỏ qua cache 60 giây)" aria-label="Làm mới hạn mức"
            className="tap44 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            {dangTai ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </button>
        )} />

      <div className="flex flex-col gap-3 px-4 pb-4 md:px-6">

      {!!q?.kieu && (
        <p className="text-[12px] text-muted-foreground" data-testid="quota-kieu">{kieuVi(q.kieu)}</p>
      )}

      {q && !q.ok && (
        <div className="flex items-start gap-2 rounded-lg border border-status-error/30 bg-status-error/[0.06] p-3 text-[14px] text-status-error"
          data-testid="quota-loi">
          <TriangleAlert className="mt-[2px] size-4 shrink-0" />
          <div className="min-w-0">
            <p>{q.error || 'Không đọc được hạn mức'}</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Lệnh <code className="font-mono">claude -p /usage</code> phải chạy được trên máy đặt dashboard.
            </p>
          </div>
        </div>
      )}

      {!q && (
        <div className="flex items-center gap-2 p-4 text-[14px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Đang hỏi Claude CLI…
        </div>
      )}

      {q?.ok && (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4" data-testid="quota-list">
          {(q.muc || []).map((m) => <ThanhMuc key={m.ten} m={m} />)}
        </div>
      )}

      {!!phanTich && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4" data-testid="quota-phan-tich">
          <h3 className="text-[14px] font-medium">Gì đang ăn hạn mức</h3>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Ước lượng từ các phiên trên chính máy này — không tính thiết bị khác hay claude.ai.
          </p>
          {/* Giữ NGUYÊN VĂN phần còn lại: đây là văn xuôi tự do (top skills, top
              subagents, % theo hành vi) mà CLI có thể đổi cách viết bất cứ lúc nào.
              Dịch máy móc thì vừa sai vừa mất chữ khi CLI thêm mục mới.
              whitespace-pre-wrap + overflow-x-auto: nội dung thụt lề theo cột mà màn
              iPhone chỉ 390px — cho cuộn trong khối thay vì để tràn cả trang. */}
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-muted-foreground">
            {phanTich.replace(/^What's contributing[^\n]*\n/, '')
              .replace(/^Approximate[\s\S]*?breakdown\.\s*\n/, '')
              .replace(/^Last 24h/m, 'Trong 24 giờ')
              .replace(/^Last 7d/m, 'Trong 7 ngày')
              .replace(/(\d+) requests · (\d+) sessions/g, '$1 lượt gọi · $2 phiên')
              .trim()}
          </pre>
        </div>
      )}

      {!!q?.luc && (
        <p className="text-[12px] text-muted-foreground/70">
          Số liệu lúc {new Date(q.luc).toLocaleTimeString('vi-VN')}
          {q.cache ? ' (từ bộ nhớ đệm 60 giây)' : ''}
        </p>
      )}
    </div>
      </div>
  );
}
