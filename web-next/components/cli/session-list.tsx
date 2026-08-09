'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Search, ChevronsUpDown, ChevronLeft, ChevronRight, Plus, SlidersHorizontal,
  MoreHorizontal, MessageSquare, Download, Square,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Session, Job } from '@/lib/types';
import { PageHeader } from '@/components/layout/app-shell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TaskBar } from './task-bar';
import { JobsPanel } from './jobs-panel';

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
  sessions, jobs, perm, onOpen, quick,
}: {
  sessions: Session[]; jobs: Job[]; perm?: string;
  onOpen: (sid: string) => void;
  quick?: { q: string; n: number };   // lối tắt "Xem nhanh" ở sidebar
}) {
  const [q, setQ] = useState('');
  const [proj, setProj] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'mtimeMs', dir: -1 });
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [perPage, setPerPage] = useState(PAGE);
  const [stat, setStat] = useState('');       // lọc theo trạng thái ('' = tất cả)

  // Bấm "Phiên đang chạy" ở sidebar -> áp bộ lọc luôn. Phụ thuộc quick.n (không phải
  // quick.q) để bấm lại lần nữa vẫn chạy dù giá trị không đổi.
  useEffect(() => {
    if (quick?.q) { setStat(quick.q); setPage(0); setQ(''); }
  }, [quick?.n]);   // eslint-disable-line react-hooks/exhaustive-deps

  const projects = useMemo(() => [...new Set(sessions.map((s) => s.project))].sort(), [sessions]);

  // Đếm theo trạng thái cho dải tóm tắt. RUNNING/ACTIVE đều là "đang chạy" dưới góc
  // nhìn người dùng; chỉ server mới phân biệt tiến trình còn sống hay file vừa đổi.
  const tally = useMemo(() => {
    let run = 0, idle = 0;
    for (const s of sessions) (['RUNNING', 'ACTIVE'].includes(s.status) ? run++ : idle++);
    return { run, idle, all: sessions.length };
  }, [sessions]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = sessions.filter((s) => {
      if (proj && s.project !== proj) return false;
      if (stat === 'run' && !['RUNNING', 'ACTIVE'].includes(s.status)) return false;
      if (stat === 'idle' && ['RUNNING', 'ACTIVE'].includes(s.status)) return false;
      if (needle && !(s.sid + ' ' + s.project + ' ' + (s.title || '')).toLowerCase().includes(needle)) return false;
      return true;
    });
    out.sort((a, b) => {
      const A = a[sort.k] ?? '', B = b[sort.k] ?? '';
      if (typeof A === 'number' && typeof B === 'number') return (A - B) * sort.dir;
      return String(A).localeCompare(String(B)) * sort.dir;
    });
    return out;
  }, [sessions, q, proj, stat, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const cur = Math.min(page, pages - 1);
  const view = rows.slice(cur * perPage, cur * perPage + perPage);

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
            {/* Nút này trước đây KHÔNG có onClick — bấm không xảy ra gì. Giờ mở/đóng
                hàng lọc theo trạng thái. */}
            <Button variant={stat ? 'default' : 'outline'} size="sm" className="tap44 h-9 gap-1.5"
              data-testid="filter-btn"  onClick={() => setStat((v) => (v ? '' : 'run'))}>
              <SlidersHorizontal className="size-3.5" />
              {stat === 'run' ? 'Đang chạy' : stat === 'idle' ? 'Đã nghỉ' : 'Lọc'}
            </Button>
            {/* Trước đây focus vào Ô TÌM — sai chỗ. Giao việc mới nằm ở ô task dưới đáy. */}
            <Button size="sm" className="tap44 h-9 gap-1.5" data-testid="new-session"
              onClick={() => document.querySelector<HTMLInputElement>('[data-testid=task-input]')?.focus()}>
              <Plus className="size-3.5" /> Phiên mới
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 md:px-6">
        {/* Dải tóm tắt kiểu Atlas: một con số lớn bên trái, phần chia nhỏ + thanh tỉ lệ
            bên phải. Bấm vào từng mảng để lọc luôn — đỡ phải mò trong bảng. */}
        <div className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center md:gap-6"
          data-testid="cli-summary">
          <div className="shrink-0">
            <div className="text-[12px] uppercase tracking-wide text-muted-foreground">Tổng số phiên</div>
            <div className="text-[26px] font-bold leading-tight tabular-nums">{tally.all}</div>
          </div>
          <div className="min-w-0 flex-1 md:border-l md:border-border md:pl-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
              <button onClick={() => { setStat(stat === 'run' ? '' : 'run'); setPage(0); }}
                data-testid="sum-run" title="Chỉ hiện phiên đang chạy"
                className="tap44 flex items-center gap-1.5 transition-opacity hover:opacity-75">
                <span className="size-2 rounded-full bg-status-ok" />
                Đang chạy: <b className="tabular-nums">{tally.run}</b>
              </button>
              <button onClick={() => { setStat(stat === 'idle' ? '' : 'idle'); setPage(0); }}
                data-testid="sum-idle" title="Chỉ hiện phiên đã nghỉ"
                className="tap44 flex items-center gap-1.5 transition-opacity hover:opacity-75">
                <span className="size-2 rounded-full bg-muted-foreground/60" />
                Đã nghỉ: <b className="tabular-nums">{tally.idle}</b>
              </button>
              {stat && (
                <button onClick={() => { setStat(''); setPage(0); }} data-testid="sum-clear"
                  className="text-muted-foreground underline-offset-2 hover:underline">bỏ lọc</button>
              )}
            </div>
            <div className="mt-2 flex h-2 gap-[2px] overflow-hidden rounded-full bg-muted/40">
              <span className="bg-status-ok transition-[width] duration-500"
                style={{ width: (tally.all ? (tally.run / tally.all) * 100 : 0) + '%' }} />
              <span className="flex-1 bg-muted-foreground/35" />
            </div>
          </div>
        </div>

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
          </div>

          {/* Việc nền: tạo/xem/huỷ ngay tại đây. Trước chỉ có một nhãn đếm số job,
              bấm không được và không có cách nào huỷ. */}
          <JobsPanel jobs={jobs} onOpen={onOpen} />

          {/* bảng — desktop */}
          {/* Chọn xong phải LÀM ĐƯỢC gì đó, không thì checkbox chỉ để trang trí.
              Dừng hàng loạt các phiên đang chạy — việc duy nhất hợp lý ở đây, vì
              dashboard KHÔNG được xoá .jsonl (đó là dữ liệu gốc của Claude CLI). */}
          {sel.size > 0 && (
            <div className="flex items-center gap-2 border-b border-border bg-accent/30 px-3 py-2"
              data-testid="bulk-bar">
              <span className="text-[13px] font-medium">Đã chọn {sel.size}</span>
              <Button variant="outline" size="sm" className="ml-auto h-8 text-[12px]"
                data-testid="bulk-clear" onClick={() => setSel(new Set())}>
                Bỏ chọn
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-[12px] text-status-error"
                data-testid="bulk-stop"
                onClick={async () => {
                  const ids = [...sel];
                  const rs = await Promise.all(ids.map((id) =>
                    api('/api/kill/' + id, { method: 'POST' }).then(() => true).catch(() => false)));
                  const n = rs.filter(Boolean).length;
                  setSel(new Set());
                  toast(n ? `Đã dừng ${n} phiên` : 'Không phiên nào đang chạy');
                }}>
                <Square className="size-3.5" /> Dừng
              </Button>
            </div>
          )}

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-[14px]">
              <thead className="border-b border-border">
                <tr>
                  {/* Chọn hàng loạt như Atlas — bấm ô đầu chọn/bỏ cả trang hiện tại */}
                  <th className="h-11 w-10 px-3 align-middle">
                    <input type="checkbox" data-testid="sel-all"
                      className="size-4 cursor-pointer accent-primary align-middle"
                      checked={view.length > 0 && view.every((s) => sel.has(s.sid))}
                      onChange={(e) => {
                        const next = new Set(sel);
                        view.forEach((s) => (e.target.checked ? next.add(s.sid) : next.delete(s.sid)));
                        setSel(next);
                      }} />
                  </th>
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
                      <td className="w-10 px-3 align-middle" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" data-testid="sel-row"
                          className="size-4 cursor-pointer accent-primary align-middle"
                          checked={sel.has(s.sid)}
                          onChange={(e) => {
                            const next = new Set(sel);
                            e.target.checked ? next.add(s.sid) : next.delete(s.sid);
                            setSel(next);
                          }} />
                      </td>
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
                        <RowMenu s={s} onOpen={onOpen} />
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
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-muted-foreground">Dòng mỗi trang</span>
              <select value={perPage} data-testid="per-page"
                onChange={(e) => { setPerPage(+e.target.value); setPage(0); }}
                className="h-8 rounded-lg border border-border bg-card px-2 text-[13px]">
                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <span className="text-[13px] text-muted-foreground" data-testid="pagination-info">
              {rows.length ? `${cur * PAGE + 1} – ${Math.min((cur + 1) * PAGE, rows.length)} / ${rows.length}` : '0'}
            </span>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="tap44 size-8" disabled={cur === 0}
                onClick={() => setPage(cur - 1)} data-testid="page-prev"
                title="Trang trước" aria-label="Trang trước">
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2 text-[13px] tabular-nums">{cur + 1} / {pages}</span>
              <Button variant="outline" size="icon" className="tap44 size-8" disabled={cur >= pages - 1}
                onClick={() => setPage(cur + 1)} data-testid="page-next"
                title="Trang sau" aria-label="Trang sau">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      <TaskBar perm={perm} onOpen={onOpen} />
    </div>
  );
}

/* Menu ⋯ cuối mỗi dòng — Atlas có ở mọi bảng. Việc hay làm nhất với một phiên là
   dừng nó hoặc lấy bản ghi ra, mà trước đây phải MỞ phiên rồi mới thấy nút. Ở đây
   làm được ngay từ danh sách. */
function RowMenu({ s, onOpen }: { s: Session; onOpen: (sid: string) => void }) {
  const running = ['RUNNING', 'ACTIVE'].includes(s.status);
  const stop = () => {
    api('/api/kill/' + s.sid, { method: 'POST' })
      .then(() => toast('Đã dừng phiên'))
      .catch(() => toast.error('Không dừng được'));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="size-7" title="Thêm"
            data-testid="row-menu" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal className="size-4" />
          </Button>
        } />
      <DropdownMenuContent align="end" className="w-48"
        onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onOpen(s.sid)} data-testid="row-open">
          <MessageSquare className="size-4" /> Mở phiên
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="row-export"
          onClick={() => { location.href = '/api/export/' + s.sid + '?fmt=md'; }}>
          <Download className="size-4" /> Tải bản ghi (.md)
        </DropdownMenuItem>
        {running && (
          <DropdownMenuItem onClick={stop} data-testid="row-stop" className="text-status-error">
            <Square className="size-4" /> Dừng phiên
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
