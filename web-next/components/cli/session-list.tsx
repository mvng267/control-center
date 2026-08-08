'use client';

import { useMemo, useState } from 'react';
import { Search, Trash2, ChevronsUpDown, ChevronLeft, ChevronRight, Plus, SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/api';
import type { Session, Job } from '@/lib/types';
import { PageHeader } from '@/components/layout/app-shell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function ago(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return s + ' giây';
  if (s < 3600) return Math.floor(s / 60) + ' phút';
  if (s < 86400) return Math.floor(s / 3600) + ' giờ';
  return Math.floor(s / 86400) + ' ngày';
}

const STATUS_UI: Record<string, { dot: string; text: string; label: string }> = {
  RUNNING: { dot: 'bg-status-ok', text: 'text-status-ok', label: 'Đang chạy' },
  ACTIVE: { dot: 'bg-primary', text: 'text-primary', label: 'Vừa hoạt động' },
  IDLE: { dot: 'bg-status-idle', text: 'text-muted-foreground', label: 'Nghỉ' },
};

type SortKey = 'title' | 'project' | 'msgs' | 'mtimeMs';
const PAGE = 10;

export function SessionList({
  sessions, jobs, onOpen,
}: { sessions: Session[]; jobs: Job[]; onOpen: (sid: string) => void }) {
  const [q, setQ] = useState('');
  const [proj, setProj] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'mtimeMs', dir: -1 });
  const [page, setPage] = useState(0);

  const projects = useMemo(() => [...new Set(sessions.map((s) => s.project))].sort(), [sessions]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = sessions.filter((s) => {
      if (proj && s.project !== proj) return false;
      if (needle && !(s.sid + ' ' + s.project + ' ' + (s.title || '')).toLowerCase().includes(needle)) return false;
      return true;
    });
    out.sort((a, b) => {
      const A = a[sort.k] ?? '', B = b[sort.k] ?? '';
      if (typeof A === 'number' && typeof B === 'number') return (A - B) * sort.dir;
      return String(A).localeCompare(String(B)) * sort.dir;
    });
    return out;
  }, [sessions, q, proj, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const view = rows.slice(cur * PAGE, cur * PAGE + PAGE);

  const th = (k: SortKey, label: string, cls?: string) => (
    <th className={cn('h-11 px-3 text-left align-middle font-medium text-muted-foreground', cls)}>
      <button className="flex items-center gap-1 text-[14px] transition-colors hover:text-foreground"
        onClick={() => setSort((s) => ({ k, dir: s.k === k && s.dir === -1 ? 1 : -1 }))}>
        {label}
        <ChevronsUpDown className="size-3.5 opacity-50" />
      </button>
    </th>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="cli-list">
      <PageHeader
        title="Phiên Claude"
        count={rows.length}
        desc="Quản lý các phiên Claude CLI đang có trên máy."
        actions={
          <>
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <SlidersHorizontal className="size-3.5" /> Lọc
            </Button>
            <Button size="sm" className="h-9 gap-1.5"
              onClick={() => document.querySelector<HTMLInputElement>('[data-testid=search-box]')?.focus()}>
              <Plus className="size-3.5" /> Phiên mới
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 md:px-6 md:pb-6">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {/* thanh công cụ trên bảng */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-[160px] flex-1">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} data-testid="search-box"
                placeholder="Tìm phiên…" className="h-9 pl-8 text-[16px] md:text-[14px]" />
            </div>
            <select value={proj} onChange={(e) => { setProj(e.target.value); setPage(0); }} data-testid="project-filter"
              className="h-9 shrink-0 rounded-lg border border-border bg-card px-2.5 text-[14px] outline-none">
              <option value="">Tất cả dự án</option>
              {projects.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {jobs.length > 0 && (
              <span className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-[12px]"
                data-testid="jobs-bar">
                <b className="text-primary">{jobs.length}</b> job đang chạy
              </span>
            )}
          </div>

          {/* bảng — desktop */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[14px]">
              <thead className="border-b border-border">
                <tr>
                  {th('title', 'Phiên')}
                  {th('project', 'Dự án')}
                  <th className="h-11 px-3 text-left align-middle text-[14px] font-medium text-muted-foreground">
                    Trạng thái
                  </th>
                  {th('msgs', 'Tin nhắn', 'text-right')}
                  {th('mtimeMs', 'Cập nhật')}
                  <th className="h-11 w-10 px-3" />
                </tr>
              </thead>
              <tbody>
                {view.map((s) => {
                  const ui = STATUS_UI[s.status] || STATUS_UI.IDLE;
                  return (
                    <tr key={s.sid} data-testid="session-row" data-sid={s.sid} data-status={s.status}
                      onClick={() => onOpen(s.sid)}
                      className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-accent/40">
                      <td className="h-[57px] px-3 align-middle">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium" data-testid="session-title" title={s.sid}>
                            {s.title || s.sid.slice(0, 8)}
                          </span>
                          {s.unread > 0 && (
                            <span className="shrink-0 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
                              {s.unread}
                            </span>
                          )}
                        </div>
                        <div className="truncate font-mono text-[12px] text-muted-foreground">{s.sid.slice(0, 8)}</div>
                      </td>
                      <td className="px-3 align-middle text-muted-foreground">{s.project}</td>
                      <td className="px-3 align-middle">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[12px]', ui.text)}>
                          <i className={cn('size-1.5 rounded-full', ui.dot)} /> {ui.label}
                        </span>
                      </td>
                      <td className="px-3 text-right align-middle tabular-nums">{s.msgs}</td>
                      <td className="px-3 align-middle text-muted-foreground">{ago(s.mtimeMs)}</td>
                      <td className="px-3 align-middle">
                        {s.status === 'RUNNING' && (
                          <Button variant="ghost" size="icon" className="size-7 text-status-error" title="Dừng phiên"
                            onClick={(e) => { e.stopPropagation(); api('/api/kill/' + s.sid, { method: 'POST' }).catch(() => {}); }}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* danh sách — mobile (bảng ngang không dùng được trên 390px) */}
          <div className="md:hidden">
            {view.map((s) => {
              const ui = STATUS_UI[s.status] || STATUS_UI.IDLE;
              return (
                <div key={s.sid} data-testid="session-row" data-sid={s.sid} data-status={s.status}
                  onClick={() => onOpen(s.sid)}
                  className="flex min-h-[64px] cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-0 active:bg-accent/40">
                  <i className={cn('size-2 shrink-0 rounded-full', ui.dot)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium" data-testid="session-title" title={s.sid}>
                        {s.title || s.sid.slice(0, 8)}
                      </span>
                      {s.unread > 0 && (
                        <span className="shrink-0 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-white">
                          {s.unread}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[12px] text-muted-foreground">
                      {s.project} · {s.msgs} tin
                    </div>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                    {ago(s.mtimeMs)}
                  </span>
                </div>
              );
            })}
          </div>

          {view.length === 0 && (
            <div className="py-12 text-center text-[14px] text-muted-foreground">Không có phiên nào khớp</div>
          )}

          {/* phân trang */}
          <div className="flex items-center justify-between gap-2 border-t border-border p-3">
            <span className="text-[13px] text-muted-foreground" data-testid="pagination-info">
              {rows.length ? `${cur * PAGE + 1} – ${Math.min((cur + 1) * PAGE, rows.length)} / ${rows.length}` : '0'}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="size-8" disabled={cur === 0}
                onClick={() => setPage(cur - 1)} data-testid="page-prev">
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2 text-[13px] tabular-nums">{cur + 1} / {pages}</span>
              <Button variant="outline" size="icon" className="size-8" disabled={cur >= pages - 1}
                onClick={() => setPage(cur + 1)} data-testid="page-next">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
