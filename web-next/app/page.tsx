'use client';

import { useEffect, useState } from 'react';
import { AppShell, type TabId } from '@/components/layout/app-shell';
import { TokenGate } from '@/components/token-gate';
import { AgyTab } from '@/components/agy/agy-tab';
import { StatsTab } from '@/components/stats/stats-tab';
import { HermesTab } from '@/components/hermes/hermes-tab';
import { SessionList } from '@/components/cli/session-list';
import { ChatView } from '@/components/cli/chat-view';
import { initToken } from '@/lib/api';
import { useStream } from '@/lib/use-stream';
import { usePwa } from '@/lib/use-pwa';

export default function Page() {
  const [tab, setTab] = useState<TabId>('cli');
  const [openSid, setOpenSid] = useState<string | null>(null);
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
