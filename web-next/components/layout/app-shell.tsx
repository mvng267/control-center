'use client';

import { Terminal, MessageSquare, Settings2, PieChart, Sun, Moon } from 'lucide-react';
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

  if (!ready) return <div className="size-9" />;
  const dark = theme === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-9"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      title={dark ? 'Chuyển sang sáng' : 'Chuyển sang tối'}
      data-testid="theme-toggle"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

export function AppShell({
  tab,
  onTab,
  badges,
  children,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  badges?: Partial<Record<TabId, number>>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      {/* header — dính trên, chừa notch iPhone */}
      <header
        className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary/15 text-primary">
          <Terminal className="size-4" />
        </div>
        <h1 className="text-[15px] font-semibold tracking-tight">Claude Control Center</h1>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* sidebar — chỉ desktop, kiểu Atlas */}
        <nav className="hidden w-[190px] shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-3 md:flex">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onTab(id)}
              data-testid={`nav-${id}`}
              data-active={tab === id}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                tab === id
                  ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{label}</span>
              {!!badges?.[id] && (
                <span className="rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
                  {badges[id]! > 99 ? '99+' : badges[id]}
                </span>
              )}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* tab bar mobile — position:fixed vì iPhone thật vẫn che dù đã có safe-area */}
      <nav
        className="flex shrink-0 items-stretch border-t border-border bg-sidebar md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {TABS.map(({ id, short, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            data-testid={`tabbar-${id}`}
            data-active={tab === id}
            className={cn(
              'relative flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1 text-[10px] transition-colors',
              tab === id ? 'text-primary' : 'text-muted-foreground',
            )}
          >
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
  );
}
