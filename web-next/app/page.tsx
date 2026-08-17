'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppShell, TABS, type TabId } from '@/components/layout/app-shell';
import { ManCauHinh } from '@/components/layout/man-cau-hinh';
import { usePullToRefresh, useSwipeTabs } from '@/lib/use-gestures';
import { TokenGate } from '@/components/token-gate';
import { AgyTab } from '@/components/agy/agy-tab';
import { DockerTab } from '@/components/docker/docker-tab';
import { StatsTab } from '@/components/stats/stats-tab';
import { HermesTab } from '@/components/hermes/hermes-tab';
import { SessionList } from '@/components/cli/session-list';
import { ChatView } from '@/components/cli/chat-view';
import { initToken, donDepUrl, api } from '@/lib/api';
import { useStream } from '@/lib/use-stream';
import { usePwa } from '@/lib/use-pwa';
import { useSoftKeyboard } from '@/lib/use-soft-keyboard';
import { CommandPalette } from '@/components/command-palette';
import { CompareView } from '@/components/cli/compare-view';
import { PasscodeGate, usePasscode } from '@/components/passcode-gate';
import { toast } from 'sonner';

export default function Page() {
  const [tab, setTab] = useState<TabId>('cli');
  const [openSid, setOpenSid] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [taoMa, setTaoMa] = useState(false);
  const [moCauHinh, setMoCauHinh] = useState(false);
  // n tăng mỗi lần bấm để bấm LẠI cùng một lối tắt vẫn áp lại được bộ lọc
  const [quick, setQuick] = useState<{ q: string; n: number }>({ q: '', n: 0 });

  // ⌘K / Ctrl+K mở bảng lệnh; ⌘1-4 chuyển tab; Esc thoát chat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName || "");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); return; }
      if ((e.metaKey || e.ctrlKey) && "12345".includes(e.key)) {
        e.preventDefault();
        setTab((["cli","hermes","agy","docker","stats"] as TabId[])[+e.key - 1]);
        return;
      }
      if (e.key === "Escape" && !inField && openSid) setOpenSid(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSid]);

  // Lệnh nhóm Dashboard — dashboard tự làm, gồm cả 4 lệnh CLI chặn ở chế độ -p
  const onUi = (id: string) => {
    /* Nói rõ vì sao không làm gì được. Trước đây các nhánh dùng `?.click()` rồi return
       vô điều kiện: bấm lúc đang ở DANH SÁCH phiên thì querySelector trả null,
       optional-chaining nuốt im lặng — không mở gì, cũng không báo gì. */
    const canMoPhien = () => {
      setTab("cli");
      toast("Mở một phiên trước rồi dùng lệnh này");
    };
    // bấm chính nút toggle trong AppShell — nó nằm TRONG ThemeProvider nên chắc chắn có context
    if (id === "ui:theme") { document.querySelector<HTMLButtonElement>("[data-testid=theme-toggle]")?.click(); return; }
    if (id === "ui:perm") { document.querySelector<HTMLButtonElement>("[data-testid=perm-btn]")?.click(); return; }
    /* Bấm chính công tắc đang hiển thị, thay vì dựng bản sao. Trong khung chat nó là
       `chat-perm`/`chat-model-btn` (đã gắn sid nên chỉ đổi phiên đang mở); ngoài danh
       sách là `perm-btn`. Mức nghĩ nằm trong menu ⋯ nên mở menu trước. */
    if (id === "ui:model") {
      const nut = document.querySelector<HTMLButtonElement>("[data-testid=chat-model-btn]");
      if (nut) nut.click(); else canMoPhien();
      return;
    }
    /* Ba mục này nằm trong menu ⋯ của khung chat: mở menu rồi bấm mục tương ứng.
       `cost` và `rename` VỐN ĐÃ có trong bảng lệnh mà KHÔNG có nhánh nào ở đây — bấm
       vào rơi xuống toast mặc định "Mở phiên rồi dùng nút tương ứng", đúng loại lỗi đã
       sửa cho `ui:compare` trước đó. */
    const trongMenu: Record<string, string> = {
      "ui:effort": "m-effort", "ui:cost": "m-cost", "ui:rename": "m-rename",
    };
    if (trongMenu[id]) {
      const menu = document.querySelector<HTMLButtonElement>("[data-testid=chat-more]");
      if (!menu) { canMoPhien(); return; }
      menu.click();
      // menu là dropdown, mục con chỉ tồn tại sau khi mở — 150ms đủ cho animation
      setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-testid=${trongMenu[id]}]`)?.click(), 150);
      return;
    }
    if (id === "ui:export" && openSid) { location.href = "/api/export/" + openSid + "?fmt=md"; return; }
    // Lệnh này VỐN ĐÃ có trong bảng lệnh nhưng không có nhánh xử lý -> bấm ra toast
    // lạc đề "Mở phiên rồi dùng nút tương ứng…". Giờ mở thật.
    if (id === "ui:compare") { setComparing(true); return; }
    if (id === "ui:stop" && openSid) {
      api("/api/kill/" + openSid, { method: "POST" }).then(() => toast("Đã dừng Claude")).catch(() => {});
      return;
    }
    // các mục còn lại nằm trong khung chat -> chuyển về tab CLI rồi báo
    setTab("cli");
    toast("Mở phiên rồi dùng nút tương ứng ở đầu khung chat");
  };
  /* initToken PHẢI chạy TRƯỚC useStream. Trước đây nó nằm trong một useEffect ở dưới
     (dòng ~86), mà useStream lại gọi ngay ở đây — hook chạy trước effect, nên
     streamUrl() lấy token rỗng và EventSource mở /stream KHÔNG có token -> 401.
     Hậu quả: vào bằng link ?t=… thì màn hình trống trơn ("Không có phiên nào khớp"),
     KHÔNG hiện màn nhập mã và cũng KHÔNG báo lỗi — nhìn ra "mất kết nối, dữ liệu là
     bản cũ". Đo được: EventSource -> 401, còn fetch cùng URL từ trong trang -> 423,
     chênh nhau đúng vì fetch chạy sau khi effect đã nạp token.
     useState(initializer) chạy MỘT LẦN lúc dựng component, trước mọi hook phía dưới. */
  const [ready, setReady] = useState(() => { initToken(); return true; });
  const { data, offline, unauthorized } = useStream();
  const pass = usePasscode();
  usePwa();
  useSoftKeyboard();   // bàn phím ảo iPhone che ô nhập — xem lib/use-soft-keyboard.ts

  // Kéo-để-làm-mới: dữ liệu vốn tự về qua SSE mỗi 2s, nên đây là để yên tâm khi
  // mạng Tailscale chập chờn — tải lại trang là cách chắc chắn nhất nối lại luồng.
  const { pull, busy: refreshing } = usePullToRefresh(() => { location.reload(); });

  // Vuốt ngang chuyển tab. Đang mở một phiên thì KHÔNG chuyển: lúc đó vuốt ngang
  // thường là thao tác trên nội dung (bảng, code) chứ không phải muốn đổi tab.
  useSwipeTabs((dir) => {
    if (openSid) return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[i + dir];
    if (next) setTab(next.id);
  });

  // Dọn ?t= khỏi URL SAU hydrate. Làm lúc render thì Next.js ghi đè lại, token vẫn
  // phơi trong thanh địa chỉ và lịch sử duyệt.
  useEffect(() => { donDepUrl(); }, []);

  // ready luôn true (initToken đã chạy trong useState initializer ở trên). Giữ lại
  // chốt này để lần render đầu trên server không cố vẽ khi chưa có localStorage.
  if (!ready) return null;

  const unread = (data?.sessions || []).reduce((n, s) => n + (s.unread || 0), 0);

  return (
    <>
      {/* Chỉ báo kéo-để-làm-mới: đi theo ngón tay, quay tròn khi đang tải lại */}
      {(pull > 0 || refreshing) && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[120] flex justify-center md:hidden"
          style={{ transform: `translateY(${refreshing ? 46 : pull}px)`, opacity: refreshing ? 1 : Math.min(1, pull / 45) }}
          data-testid="pull-indicator">
          <div className="mt-2 rounded-full border border-border bg-card p-2 shadow-lg">
            <RefreshCw className={cn('size-4 text-primary', refreshing && 'animate-spin')}
              style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
          </div>
        </div>
      )}

      {/* Đang mở khung chat trên điện thoại -> ẩn thanh tab dưới. Nó cao 58px, chiếm
          chỗ vĩnh viễn trong khi đọc hội thoại; terminal thật dùng trọn màn hình.
          Muốn đổi tab thì bấm mũi tên quay lại danh sách trước. */}
      <AppShell tab={tab} onTab={setTab} badges={{ cli: unread }}
        anThanhTab={tab === 'cli' && !!openSid}
        onQuick={(q) => { setOpenSid(null); setQuick({ q, n: quick.n + 1 }); }}
        daDatMa={!!pass.st?.daDat}
        onCauHinh={() => setMoCauHinh(true)}
        onLock={async () => {
          if (!pass.st?.daDat) { setTaoMa(true); return; }
          try { await api('/api/passcode/lock', { method: 'POST', body: '{}' }); } catch {}
          location.reload();
        }}>
        {tab === 'cli' && (openSid
          ? <ChatView sid={openSid} onBack={() => setOpenSid(null)} perm={data?.perm} effort={data?.effort} />
          : <SessionList sessions={data?.sessions || []} jobs={data?.jobs || []} perm={data?.perm} effort={data?.effort} model={data?.model}
              onOpen={setOpenSid} quick={quick} />)}
        {tab === 'hermes' && <HermesTab />}
        {tab === 'agy' && <AgyTab />}
        {tab === 'docker' && <DockerTab />}
        {tab === 'stats' && <StatsTab sessions={data?.sessions || []} />}
      </AppShell>

      {/* Màn phủ toàn màn, nằm NGOÀI AppShell để thanh tab dưới không đè lên */}
      {moCauHinh && <ManCauHinh onDong={() => setMoCauHinh(false)} />}

      {offline && (
        <div
          className="fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-[95] border-t border-amber-500/30 bg-amber-950/90 py-1.5 text-center text-[12px] text-amber-400 backdrop-blur md:bottom-0"
          data-testid="offline-bar"
        >
          Mất kết nối — dữ liệu đang hiển thị là bản cũ
        </div>
      )}
      {comparing && (
        <CompareView sessions={data?.sessions || []} initial={openSid}
          onClose={() => setComparing(false)} />
      )}
      {/* Đã đặt mã mà chưa mở khoá -> phủ màn khoá lên trên tất cả. Đặt TRƯỚC
          TokenGate vì mã khoá là lớp trong cùng (chặn cả người cầm máy). */}
      {pass.st?.daDat && !pass.st.daMo && (
        <PasscodeGate daDat onDone={() => { pass.reload(); location.reload(); }} />
      )}
      {taoMa && !pass.st?.daDat && (
        <PasscodeGate daDat={false} onDone={() => { setTaoMa(false); pass.reload(); }} />
      )}
      {unauthorized && <TokenGate />}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} sid={openSid} onUi={onUi} />
    </>
  );
}

function Placeholder({ name }: { name: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {name} — đang chuyển sang giao diện mới
    </div>
  );
}
