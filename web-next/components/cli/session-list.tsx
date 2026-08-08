'use client';

import { useMemo, useState } from 'react';
import { Mail, Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { Session, Job } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function ago(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

const DOT: Record<string, string> = {
  RUNNING: 'bg-status-ok', ACTIVE: 'bg-primary', IDLE: 'bg-status-idle',
};

export function SessionList({
  sessions, jobs, onOpen,
}: { sessions: Session[]; jobs: Job[]; onOpen: (sid: string) => void }) {
  const [q, setQ] = useState('');
  const [proj, setProj] = useState('');

  const projects = useMemo(
    () => [...new Set(sessions.map((s) => s.project))].sort(),
    [sessions],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sessions.filter((s) => {
      if (proj && s.project !== proj) return false;
      if (needle && !(s.sid + ' ' + s.project + ' ' + (s.title || '')).toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [sessions, q, proj]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="cli-list">
      {/* thanh lọc */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative min-w-[160px] flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} data-testid="search-box"
            placeholder="Tìm phiên hoặc dự án…" className="h-9 pl-8 text-[16px] md:text-[13px]" />
        </div>
        <select value={proj} onChange={(e) => setProj(e.target.value)} data-testid="project-filter"
          className="h-9 shrink-0 rounded-md border border-border bg-card px-2.5 text-[13px] outline-none">
          <option value="">Tất cả dự án</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* jobs đang chạy */}
      {jobs.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-border px-4 py-2" data-testid="jobs-bar">
          {jobs.map((j) => (
            <span key={j.id} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px]">
              <b className="text-primary">{j.kind}</b> {j.spec} · {j.runs} lần
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-24 md:pb-3">
        <div className="mx-auto flex max-w-[1000px] flex-col gap-1.5">
          {rows.length === 0 && (
            <div className="py-10 text-center text-[13px] text-muted-foreground">Không có phiên nào khớp</div>
          )}
          {rows.map((s) => (
            <Card key={s.sid} data-testid="session-row" data-sid={s.sid} data-status={s.status}
              onClick={() => onOpen(s.sid)}
              className="cursor-pointer gap-0 p-3 transition-colors hover:bg-accent/50">
              <div className="flex items-center gap-3">
                <span className={cn('size-2 shrink-0 rounded-full', DOT[s.status] || DOT.IDLE)} />
                <span className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-[11px]',
                  s.status === 'RUNNING' ? 'bg-status-ok/15 text-status-ok' : 'bg-primary/10 text-primary',
                )}>
                  <Mail className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold leading-tight" data-testid="session-title"
                      title={s.sid}>
                      {s.title || s.sid.slice(0, 8)}
                    </span>
                    {s.unread > 0 && (
                      <span className="shrink-0 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
                        {s.unread}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[11.5px] leading-tight text-muted-foreground">{s.project}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="whitespace-nowrap text-[10.5px] tabular-nums text-muted-foreground">
                    {ago(s.mtimeMs)}
                  </span>
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">{s.msgs} msgs</span>
                </span>
                {s.status === 'RUNNING' && (
                  <Button variant="ghost" size="icon" className="size-7 shrink-0 text-status-error"
                    title="Dừng phiên"
                    onClick={(e) => { e.stopPropagation(); api('/api/kill/' + s.sid, { method: 'POST' }).catch(() => {}); }}>
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
