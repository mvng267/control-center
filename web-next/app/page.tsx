'use client';

import { useEffect, useState } from 'react';
import { AppShell, type TabId } from '@/components/layout/app-shell';
import { TokenGate } from '@/components/token-gate';
import { AgyTab } from '@/components/agy/agy-tab';
import { StatsTab } from '@/components/stats/stats-tab';
import { HermesTab } from '@/components/hermes/hermes-tab';
import { SessionList } from '@/components/cli/session-list';
import { ChatView } from '@/components/cli/chat-view';
import { initToken, api } from '@/lib/api';
import { useStream } from '@/lib/use-stream';
import { usePwa } from '@/lib/use-pwa';
import { CommandPalette } from '@/components/command-palette';
import { toast } from 'sonner';

export default function Page() {
  const [tab, setTab] = useState<TabId>('cli');
  const [openSid, setOpenSid] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // ⌘K / Ctrl+K mở bảng lệnh; ⌘1-4 chuyển tab; Esc thoát chat
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName || "");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); return; }
      if ((e.metaKey || e.ctrlKey) && "1234".includes(e.key)) {
        e.preventDefault();
        setTab((["cli","hermes","agy","stats"] as TabId[])[+e.key - 1]);
        return;
      }
      if (e.key === "Escape" && !inField && openSid) setOpenSid(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSid]);

  // Lệnh nhóm Dashboard — dashboard tự làm, gồm cả 4 lệnh CLI chặn ở chế độ -p
  const onUi = (id: string) => {
    // bấm chính nút toggle trong AppShell — nó nằm TRONG ThemeProvider nên chắc chắn có context
    if (id === "ui:theme") { document.querySelector<HTMLButtonElement>("[data-testid=theme-toggle]")?.click(); return; }
    if (id === "ui:perm") { document.querySelector<HTMLButtonElement>("[data-testid=perm-btn]")?.click(); return; }
    if (id === "ui:export" && openSid) { location.href = "/api/export/" + openSid + "?fmt=md"; return; }
    if (id === "ui:stop" && openSid) {
      api("/api/kill/" + openSid, { method: "POST" }).then(() => toast("Đã dừng Claude")).catch(() => {});
      return;
    }
    // các mục còn lại nằm trong khung chat -> chuyển về tab CLI rồi báo
    setTab("cli");
    toast("Mở phiên rồi dùng nút tương ứng ở đầu khung chat");
  };
  const [ready, setReady] = useState(false);
  const { data, offline, unauthorized } = useStream();
  usePwa();

  useEffect(() => {
    initToken();
    setReady(true);
  }, []);

  if (!ready) return null;

  const unread = (data?.sessions || []).reduce((n, s) => n + (s.unread || 0), 0);

  return (
    <>
      <AppShell tab={tab} onTab={setTab} badges={{ cli: unread }}>
        {tab === 'cli' && (openSid
          ? <ChatView sid={openSid} onBack={() => setOpenSid(null)} />
          : <SessionList sessions={data?.sessions || []} jobs={data?.jobs || []} perm={data?.perm} onOpen={setOpenSid} />)}
        {tab === 'hermes' && <HermesTab />}
        {tab === 'agy' && <AgyTab />}
        {tab === 'stats' && <StatsTab sessions={data?.sessions || []} />}
      </AppShell>

      {offline && (
        <div
          className="fixed inset-x-0 bottom-[calc(58px+env(safe-area-inset-bottom))] z-[95] border-t border-amber-500/30 bg-amber-950/90 py-1.5 text-center text-[12px] text-amber-400 backdrop-blur md:bottom-0"
          data-testid="offline-bar"
        >
          Mất kết nối — dữ liệu đang hiển thị là bản cũ
        </div>
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
