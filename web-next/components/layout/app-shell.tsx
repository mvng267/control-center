'use client';

import {
  Terminal, MessageSquare, Settings2, PieChart, Sun, Moon,
  ChevronRight, MoreHorizontal, LifeBuoy, Users,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type TabId = 'cli' | 'hermes' | 'agy' | 'stats';

export const TABS: { id: TabId; label: string; short: string; icon: typeof Terminal }[] = [
  { id: 'cli', label: 'Claude', short: 'CLAUDE', icon: Terminal },
  { id: 'hermes', label: 'Hermes', short: 'HERMES', icon: MessageSquare },
  { id: 'agy', label: 'Agy Proxy', short: 'AGY', icon: Settings2 },
  { id: 'stats', label: 'Thống kê', short: 'STATS', icon: PieChart },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []); // tránh lệch hydrate: server không biết theme

  if (!ready) return <div className="size-8" />;
  const dark = theme === 'dark';
  return (
    <Button variant="ghost" size="icon" className="size-8" data-testid="theme-toggle"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title={dark ? 'Chuyển sang sáng' : 'Chuyển sang tối'}>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

export function AppShell({
  tab, onTab, badges, crumb, children,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  badges?: Partial<Record<TabId, number>>;
  crumb?: string;
  children: React.ReactNode;
}) {
  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background text-foreground">
      {/* ---- SIDEBAR 256px — chỉ desktop, dựng theo Atlas ---- */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-sidebar md:flex"
        data-testid="sidebar">
        {/* logo */}
        <div className="flex items-center gap-2.5 px-4 py-3.5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Terminal className="size-4" />
          </span>
          <span className="flex-1 truncate text-[15px] font-semibold tracking-tight">Control</span>
          <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 pb-2">
          <div className="px-2.5 pb-1.5 pt-2 text-[12px] font-medium text-muted-foreground">Menu</div>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => onTab(id)} data-testid={`nav-${id}`} data-active={tab === id}
              className={cn(
                'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] transition-colors',
                tab === id
                  ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )}>
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 truncate">{label}</span>
              {!!badges?.[id] && (
                <span className="shrink-0 rounded-md bg-muted px-1.5 text-[11px] font-medium tabular-nums">
                  {badges[id]! > 99 ? '99+' : badges[id]}
                </span>
              )}
            </button>
          ))}

          {/* nhóm Favorites — chấm màu như Atlas, dẫn tới các chỗ hay dùng */}
          <div className="flex items-center px-2.5 pb-1.5 pt-5 text-[12px] font-medium text-muted-foreground">
            <span className="flex-1">Xem nhanh</span>
          </div>
          {[
            { c: 'bg-status-ok', label: 'Phiên đang chạy', to: 'cli' as TabId },
            { c: 'bg-status-run', label: 'Lỗi agy-proxy', to: 'agy' as TabId },
            { c: 'bg-primary', label: 'Thống kê hôm nay', to: 'stats' as TabId },
          ].map((f) => (
            <button key={f.label} onClick={() => onTab(f.to)}
              className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[14px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground">
              <i className={cn('size-1.5 shrink-0 rounded-full', f.c)} />
              <span className="truncate">{f.label}</span>
            </button>
          ))}
        </nav>

        {/* chân sidebar */}
        <div className="px-2.5 pb-2">
          {[{ Icon: Users, label: 'Phiên' }, { Icon: LifeBuoy, label: 'Trợ giúp' }].map(({ Icon, label }) => (
            <div key={label}
              className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[14px] text-muted-foreground">
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{label}</span>
            </div>
          ))}
        </div>
        <div className="m-2.5 mt-0 flex items-center gap-2.5 rounded-xl border border-border bg-card px-2.5 py-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
            V
          </span>
          <span className="flex-1 truncate text-[13px] font-medium">Vinh</span>
          <MoreHorizontal className="size-4 shrink-0 text-muted-foreground" />
        </div>
      </aside>

      {/* ---- CỘT PHẢI ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header: breadcrumb (desktop) / logo (mobile) */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 md:border-b-0"
          style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(56px + env(safe-area-inset-top))' }}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground md:hidden">
            <Terminal className="size-4" />
          </span>
          <nav className="flex min-w-0 items-center gap-1.5 text-[14px]" data-testid="breadcrumb">
            <span className="hidden text-muted-foreground md:inline">Dashboard</span>
            <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground md:inline" />
            <span className="truncate font-medium">{crumb || active?.label}</span>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary md:hidden">
              V
            </span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>

        {/* tab bar mobile — position sticky vì iPhone thật vẫn che dù đã có safe-area */}
        <nav className="flex shrink-0 items-stretch border-t border-border bg-sidebar md:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {TABS.map(({ id, short, icon: Icon }) => (
            <button key={id} onClick={() => onTab(id)} data-testid={`tabbar-${id}`} data-active={tab === id}
              className={cn(
                'relative flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 text-[10px] transition-colors',
                tab === id ? 'text-primary' : 'text-muted-foreground',
              )}>
              <Icon className="size-[18px]" />
              <span className="font-medium tracking-wide">{short}</span>
              {!!badges?.[id] && (
                <span className="absolute right-[22%] top-2 rounded-full bg-destructive px-1.5 text-[9px] font-semibold text-white">
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
    <div className="flex flex-col gap-3 px-4 pb-4 pt-4 md:flex-row md:items-start md:px-6"
      data-testid="page-header">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {/* không truncate: màn hẹp cho tiêu đề xuống dòng còn hơn cắt cụt */}
          <h1 className="text-[22px] font-bold leading-tight tracking-tight md:truncate md:text-[24px]">{title}</h1>
          {count !== undefined && (
            <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[12px] font-medium tabular-nums">
              {count}
            </span>
          )}
        </div>
        {desc && <p className="mt-1 text-[14px] text-muted-foreground">{desc}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
