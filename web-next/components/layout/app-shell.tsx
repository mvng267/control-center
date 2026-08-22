'use client';

import {
  Terminal, MessageSquare, Settings2, PieChart, Sun, Moon,
  ChevronRight, MoreHorizontal, Lock, ShieldPlus, Container, Gauge, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NotifyToggle } from '@/components/notify-toggle';
import { useCauHinh, chuDau } from '@/lib/use-cauhinh';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export type TabId = 'cli' | 'hermes' | 'agy' | 'docker' | 'stats' | 'quota';

export const TABS: { id: TabId; label: string; short: string; icon: typeof Terminal }[] = [
  { id: 'cli', label: 'Claude', short: 'CLAUDE', icon: Terminal },
  { id: 'hermes', label: 'Hermes', short: 'HERMES', icon: MessageSquare },
  { id: 'agy', label: 'Agy Proxy', short: 'AGY', icon: Settings2 },
  { id: 'docker', label: 'Docker', short: 'DOCKER', icon: Container },
  { id: 'stats', label: 'Thống kê', short: 'STATS', icon: PieChart },
  // Hạn mức xếp cuối: thứ liếc thỉnh thoảng, không phải chỗ làm việc hằng ngày.
  // `short` hiện ở thanh tab dưới trên điện thoại — giữ tiếng Việt cho đồng bộ.
  { id: 'quota', label: 'Hạn mức', short: 'HẠN MỨC', icon: Gauge },
];

/* Chip hạn mức tuần ở header — liếc là thấy, bấm mở tab đầy đủ.

   Chỉ hiện khi ĐÃ ĐỌC ĐƯỢC số: `/usage` phải spawn `claude -p` (đo thật 8,4 giây) nên
   lần đầu vào trang chưa có gì. Hiện ô xám chờ sẵn thì header nhấp nháy mỗi lần tải —
   thà không có gì rồi xuất hiện một lần.

   GỌI ĐÚNG MỘT LẦN mỗi lần mở trang, KHÔNG hẹn giờ lặp. Bản đầu tự làm mới mỗi 5 phút
   và đó là sai lầm tốn kém: mỗi lần server bỏ cache là `claude -p /usage` chạy thật,
   mà CLI tạo hẳn một file .jsonl MỚI cho mỗi lần gọi. Đếm được 183 phiên rác chỉ từ
   lệnh này — danh sách phiên của Vinh 70% là rác do chính dashboard đẻ ra.
   Muốn số mới thì mở tab Hạn mức bấm Làm mới; hạn mức nhích theo giờ, không cần theo dõi
   từng phút. */
function ChipQuota({ onMo }: { onMo: () => void }) {
  const [p, setP] = useState<number | null>(null);

  useEffect(() => {
    let song = true;
    api<{ ok: boolean; muc?: { ten: string; phanTram: number }[] }>('/api/quota')
      .then((q) => {
        if (!song || !q.ok) return;
        // ưu tiên mức TUẦN (all models): phiên hết thì chờ vài giờ, tuần hết mới là chặn thật
        const tuan = (q.muc || []).find((m) => /all models/i.test(m.ten)) || (q.muc || [])[0];
        if (tuan) setP(tuan.phanTram);
      })
      .catch(() => {});
    return () => { song = false; };
  }, []);

  if (p === null) return null;
  return (
    <button onClick={onMo} data-testid="chip-quota"
      title={'Hạn mức tuần đã dùng ' + p + '% — bấm để xem chi tiết'}
      aria-label={'Hạn mức tuần ' + p + '%'}
      className={cn('tap44 flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium tabular-nums transition-colors',
        p >= 90 ? 'bg-status-error/15 text-status-error'
          : p >= 75 ? 'bg-status-run/15 text-status-run'
            : 'bg-muted text-muted-foreground hover:text-foreground')}>
      <Gauge className="size-3.5 shrink-0" />
      {p}%
    </button>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []); // tránh lệch hydrate: server không biết theme

  if (!ready) return <div className="size-8" />;
  const dark = theme === 'dark';
  return (
    <Button variant="ghost" size="icon" className="tap44 size-8" data-testid="theme-toggle"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title={dark ? 'Chuyển sang sáng' : 'Chuyển sang tối'}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

export function AppShell({
  tab, onTab, badges, crumb, children, onQuick, daDatMa, onLock, anThanhTab, onCauHinh,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  badges?: Partial<Record<TabId, number>>;
  crumb?: string;
  children: React.ReactNode;
  onQuick?: (q: string) => void;   // ý định lọc kèm theo lối tắt "Xem nhanh"
  daDatMa?: boolean;               // đã đặt mã khoá chưa
  onLock?: () => void;
  /** ẩn thanh tab dưới (đang đọc chat trên điện thoại) */
  anThanhTab?: boolean;
  /** mở màn cấu hình (bấm vào ô tên ở chân sidebar) */
  onCauHinh?: () => void;
}) {
  const cauHinh = useCauHinh();
  /* Chỉ bày tab đang bật. 'cli' luôn có mặt — tắt nó thì mở dashboard ra không còn gì.
     Người cài từ npm thường không có Hermes/agy-proxy, server tự tắt hai tab đó nên
     họ không phải nhìn hai tab mở ra chỉ thấy lỗi. */
  const tabsHien = TABS.filter((t) => t.id === 'cli' || cauHinh.tabBat[t.id] !== false);
  const active = TABS.find((t) => t.id === tab);

  /* Thanh bên GẬP hay không. Khởi tạo `false` rồi mới đọc localStorage trong effect —
     đọc thẳng lúc dựng thì bản render ở server (static export) và bản ở trình duyệt ra
     khác nhau, React báo hydration mismatch. */
  const [gapSide, setGapSide] = useState(false);
  useEffect(() => {
    try { setGapSide(localStorage.getItem('side-gap') === '1'); } catch {}
  }, []);
  const doiGap = (v: boolean) => {
    setGapSide(v);
    try { localStorage.setItem('side-gap', v ? '1' : '0'); } catch {}
  };

  return (
    /* Chiều cao trừ đi phần bàn phím che (--kb do use-soft-keyboard bơm vào).
       Trên iOS layout viewport KHÔNG co khi bàn phím bật, kể cả dùng dvh — nên
       phải tự trừ, nếu không ô nhập nằm sau bàn phím. */
    <div className="flex overflow-hidden bg-background text-foreground"
      style={{ height: 'calc(100dvh - var(--kb, 0px))' }}>
      {/* ---- SIDEBAR — chỉ desktop, dựng theo Atlas. GẬP được xuống 56px ----
           Vì sao đáng gập: 256px là 18% màn 1440, mà khi đang đọc một phiên thì cả
           cột đó chỉ để đổi tab — thứ hiếm khi đụng. Gập lại vẫn thấy icon nên không
           mất đường đi, mà khung chat rộng thêm 200px.
           Nhớ lựa chọn qua localStorage: gập rồi mà mở lại trang nó bung ra thì phải
           gập lại mỗi lần, thành ra phiền hơn là tiện. */}
      <aside className={cn('hidden shrink-0 flex-col bg-sidebar w-64 overflow-hidden transition-transform duration-200 md:flex',
        gapSide ? '-translate-x-[200px]' : 'translate-x-0')}
        data-testid="sidebar" data-gap={gapSide}>
        {/* logo + nút gập. Trước đây chỗ này là icon ⋯ TRANG TRÍ, bấm không làm gì. */}
        <div className={cn('flex items-center py-3.5', gapSide ? 'justify-center px-1' : 'gap-2.5 px-4')}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={28} height={28} className={cn('size-7 shrink-0 rounded-lg', gapSide && 'size-6')} />
          {!gapSide && (
            <span className="flex-1 truncate text-[14px] font-semibold tracking-tight">Control</span>
          )}
          {!gapSide && (
            <button type="button" data-testid="gap-sidebar" onClick={() => doiGap(true)}
              title="Thu gọn thanh bên" aria-label="Thu gọn thanh bên"
              className="tap44 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
              <PanelLeftClose className="size-4" />
            </button>
          )}
        </div>
        {/* Gập rồi thì nút mở nằm riêng một hàng — nhét chung với logo ở 56px thì
            hai thứ chồng nhau. */}
        {gapSide && (
          <button type="button" data-testid="mo-sidebar" onClick={() => doiGap(false)}
            title="Mở rộng thanh bên" aria-label="Mở rộng thanh bên"
            className="tap44 mx-auto mb-1 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
            <PanelLeftOpen className="size-4" />
          </button>
        )}

        <nav className={cn('flex-1 overflow-y-auto pb-2', gapSide ? 'px-2' : 'px-2.5')}>
          {!gapSide && (
            <div className="px-2.5 pb-1.5 pt-2 text-[12px] font-medium text-muted-foreground">Menu</div>
          )}
          {tabsHien.map(({ id, label, icon: Icon }) => (
            /* Gập: chỉ icon, căn giữa, `title` làm tooltip — không có nhãn thì phải có
               cách khác để biết nút nào là gì. Badge chuyển thành chấm nhỏ góc trên vì
               con số không đủ chỗ trong ô 32px. */
            <button key={id} onClick={() => onTab(id)} data-testid={`nav-${id}`} data-active={tab === id}
              title={gapSide ? label : undefined}
              className={cn(
                'relative flex h-8 w-full items-center rounded-[8px] text-left text-[14px] transition-colors',
                gapSide ? 'justify-center px-0' : 'gap-2.5 px-2.5',
                tab === id
                  ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )}>
              <Icon className="size-4 shrink-0" />
              {gapSide && !!badges?.[id] && (
                <span className="absolute right-1 top-0.5 size-1.5 rounded-full bg-primary" />
              )}
              {!gapSide && <span className="flex-1 truncate">{label}</span>}
              {!gapSide && !!badges?.[id] && (
                <span className="shrink-0 rounded-md bg-muted px-1.5 text-[12px] font-medium tabular-nums">
                  {badges[id]! > 99 ? '99+' : badges[id]}
                </span>
              )}
            </button>
          ))}

          {/* Nhóm "Xem nhanh" ẨN khi gập: ba nút này phân biệt nhau bằng NHÃN, còn
              chấm màu chỉ là điểm nhấn — gập lại thì ba chấm nhỏ xíu giống hệt nhau,
              bấm nhầm nhiều hơn bấm đúng. */}
          {!gapSide && (
            <div className="flex items-center px-2.5 pb-1.5 pt-5 text-[12px] font-medium text-muted-foreground">
              <span className="flex-1">Xem nhanh</span>
            </div>
          )}
          {/* Chuyển tab THÔI thì nhãn nói dối: bấm "Phiên đang chạy" mà mở ra vẫn cả
              100 phiên. Gửi kèm ý định qua onQuick để màn đích tự lọc. */}
          {[
            { c: 'bg-status-ok', label: 'Phiên đang chạy', to: 'cli' as TabId, q: 'run' },
            { c: 'bg-status-run', label: 'Lỗi agy-proxy', to: 'agy' as TabId, q: '' },
            { c: 'bg-primary', label: 'Thống kê hôm nay', to: 'stats' as TabId, q: '' },
          ].filter(() => !gapSide).map((f) => (
            <button key={f.label} data-testid={'quick-' + f.to + (f.q ? '-' + f.q : '')}
              onClick={() => { onTab(f.to); if (f.q) onQuick?.(f.q); }}
              className="flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[14px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground">
              <i className={cn('size-1.5 shrink-0 rounded-full', f.c)} />
              <span className="truncate">{f.label}</span>
            </button>
          ))}
        </nav>

        {/* chân sidebar */}
        <div className={gapSide ? "px-2 pb-2" : "px-2.5 pb-2"}>
          {/* Trước đây chỗ này là hai dòng chữ CHẾT ("Phiên", "Trợ giúp") — có icon,
              trông như nút, bấm không ra gì. Thay bằng nút khoá dùng được thật. */}
          <button onClick={onLock} data-testid="lock-btn"
            title={daDatMa ? 'Khoá dashboard ngay' : 'Đặt mã khoá để bảo vệ dashboard'}
            className={cn("tap44 flex h-8 w-full items-center overflow-hidden rounded-[8px] text-left text-[14px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              gapSide ? "justify-center" : "gap-2.5 px-2.5")}>
            {daDatMa ? <Lock className="size-4 shrink-0" /> : <ShieldPlus className="size-4 shrink-0" />}
            {/* Ẩn hẳn nhãn khi gập. `truncate` không đủ: ở 56px nó vẫn cố vẽ ra "T…"
                cạnh icon, nhìn như chữ bị hỏng chứ không ra ý cố tình rút gọn. */}
            {!gapSide && <span className="truncate">{daDatMa ? 'Khoá ngay' : 'Tạo mã khoá'}</span>}
          </button>
        </div>
        {/* Tên lấy từ tài khoản đang chạy server (ghi đè bằng DASH_USER). Trước đây ghi
            cứng tên chủ máy dev nên ai cài về cũng thấy tên người lạ trên máy mình. */}
        {/* Gập: còn mỗi vòng tròn chữ đầu — vẫn bấm được vào cấu hình, `title` cho biết
            đó là gì. Giữ nguyên khung có viền thì ở 56px nó chật cứng, chữ tràn ra. */}
        <button onClick={onCauHinh} data-testid="mo-cau-hinh"
          title={gapSide ? cauHinh.nguoiDung + ' — cấu hình dashboard' : 'Cấu hình dashboard'}
          className={cn('flex items-center text-left transition-colors hover:bg-sidebar-accent/60',
            gapSide
              ? 'mx-auto mb-2.5 justify-center rounded-full p-1'
              : 'm-2.5 mt-0 gap-2.5 rounded-xl border border-border bg-card px-2.5 py-2')}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[12px] font-semibold text-primary">
            {chuDau(cauHinh.nguoiDung)}
          </span>
          {!gapSide && (
            <>
              <span className="flex-1 truncate text-[14px] font-medium">{cauHinh.nguoiDung}</span>
              <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
            </>
          )}
        </button>
      </aside>

      {/* ---- CỘT PHẢI ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header: breadcrumb (desktop) / logo (mobile) */}
        {/* Đang chat trên điện thoại: ẩn luôn header này. Nó cao 64px và chỉ lặp lại
            thứ thanh đầu khung chat đã có (tên phiên, nút quay lại, công cụ) — cộng
            với thanh tab 58px là mất 122px, gần 1/7 màn hình.
            Từ md trở lên giữ nguyên: màn rộng không thiếu chỗ, và breadcrumb ở đó
            là cách duy nhất biết mình đang ở tab nào. */}
        <header data-testid="app-header"
          className={cn('shrink-0 items-center gap-2 border-b border-border px-4 md:border-b-0',
            anThanhTab ? 'hidden md:flex' : 'flex')}
          style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(64px + env(safe-area-inset-top))' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={28} height={28} className="size-7 shrink-0 rounded-lg md:hidden" />
          <nav className="flex min-w-0 items-center gap-1.5 text-[14px]" data-testid="breadcrumb">
            <span className="hidden text-muted-foreground md:inline">Dashboard</span>
            <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground md:inline" />
            <span className="truncate font-medium">{crumb || active?.label}</span>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {/* Hạn mức tuần — thấy ngay không phải chuyển tab. Hết hạn mức là thứ CHẶN
                việc, mà trước đây chỉ biết khi Claude đột ngột trả lỗi giữa lượt. */}
            {cauHinh.tabBat.quota !== false && <ChipQuota onMo={() => onTab('quota')} />}
            <NotifyToggle />
            <ThemeToggle />
            {/* Điện thoại: đây là lối DUY NHẤT vào màn cấu hình — sidebar (nơi có ô
                tên bấm được) chỉ hiện từ md trở lên. Trước đây chỉ là chữ "V" chết. */}
            <button onClick={onCauHinh} data-testid="mo-cau-hinh-mobile"
              title="Cấu hình" aria-label="Cấu hình"
              className="tap44 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[12px] font-semibold text-primary md:hidden">
              {chuDau(cauHinh.nguoiDung)}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>

        {/* Tab bar mobile. Bàn phím bật (body.kb-open) thì ẨN hẳn: màn iPhone lúc đó chỉ
            còn ~300px, nhường chỗ cho tin nhắn và ô nhập. Legacy cũng chọn hy sinh tab
            bar — ô nhập quan trọng hơn. Xem lib/use-soft-keyboard.ts. */}
        <nav data-testid="tabbar"
          className={cn('tab-bar flex shrink-0 items-stretch border-t border-border bg-sidebar md:hidden [body.kb-open_&]:hidden',
            anThanhTab && 'hidden')}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {tabsHien.map(({ id, short, icon: Icon }) => (
            <button key={id} onClick={() => onTab(id)} data-testid={`tabbar-${id}`} data-active={tab === id}
              className={cn(
                'relative flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 text-[12px] transition-colors',
                tab === id ? 'text-primary' : 'text-muted-foreground',
              )}>
              <Icon className="size-[18px]" />
              <span className="font-medium tracking-wide">{short}</span>
              {!!badges?.[id] && (
                <span className="absolute right-[22%] top-2 rounded-full bg-destructive px-1.5 text-[12px] font-semibold text-white">
                  {badges[id]! > 99 ? '99+' : badges[id]}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

// Tiêu đề trang kiểu Atlas: tên lớn + số đếm + mô tả, nút hành động bên phải
export function PageHeader({
  title, count, desc, actions,
}: { title: string; count?: number; desc?: string; actions?: React.ReactNode }) {
  return (
    /* Trên màn hẹp: tiêu đề và các nút NẰM CÙNG HÀNG, câu mô tả ẩn đi.
       Đo trên iPhone 390px: bản cũ xếp dọc nên riêng phần đầu đã cao 133px, đẩy thẻ
       phiên đầu tiên xuống 439px — quá nửa màn hình chỉ để tới được nội dung.
       Từ md trở lên giữ nguyên bố cục cũ, màn rộng không thiếu chỗ. */
    <div className="flex flex-row items-center gap-2 px-4 pb-3 pt-3 md:items-start md:gap-3 md:px-6 md:pb-4 md:pt-4"
      data-testid="page-header">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[19px] font-bold leading-tight tracking-tight md:text-[24px]">{title}</h1>
          {count !== undefined && (
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[12px] font-medium tabular-nums">
              {count}
            </span>
          )}
        </div>
        {desc && <p className="mt-1 hidden text-[14px] text-muted-foreground md:block">{desc}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
