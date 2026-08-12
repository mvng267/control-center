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
import { SessionCard } from './session-card';

function ago(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return s + ' giây';
  if (s < 3600) return Math.floor(s / 60) + ' phút';
  if (s < 86400) return Math.floor(s / 3600) + ' giờ';
  return Math.floor(s / 86400) + ' ngày';
}

// Bảng màu trạng thái đã chuyển sang session-card.tsx cùng với thẻ.

type SortKey = 'title' | 'project' | 'msgs' | 'mtimeMs';
const PAGE = 10;

export function SessionList({
  sessions, jobs, perm, effort, onOpen, quick,
}: {
  sessions: Session[]; jobs: Job[]; perm?: string; effort?: string;
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
    return { run, idle };   // tổng đã có ở huy hiệu cạnh tiêu đề, không đếm lại
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

  /* Nút sắp xếp — bảng cũ để việc này ở tiêu đề cột, bỏ bảng thì phải có chỗ khác.
     Bấm lại vào nút đang chọn để đảo chiều tăng/giảm. */
  const sapXep = (k: SortKey, nhan: string) => (
    <button data-testid={'sort-' + k} data-active={sort.k === k}
      onClick={() => setSort((s) => ({ k, dir: s.k === k && s.dir === -1 ? 1 : -1 }))}
      className={cn('tap44 flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] transition-colors',
        sort.k === k ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/50')}>
      {nhan}
      {sort.k === k && <ChevronsUpDown className="size-3 opacity-60" />}
    </button>
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
        {/* Tóm tắt gọn thành MỘT HÀNG. Bản cũ là một thẻ cao 4 dòng có số 100 cỡ lớn
            và thanh tỉ lệ — đo trên iPhone 390px: nó cùng phần đầu trang đẩy lưới
            xuống tới mức chỉ còn thấy ĐÚNG MỘT thẻ phiên. Con số đó đã có sẵn ở
            huy hiệu cạnh tiêu đề, in to lần nữa là thừa. */}
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]"
          data-testid="cli-summary">
          <button onClick={() => { setStat(stat === 'run' ? '' : 'run'); setPage(0); }}
            data-testid="sum-run" title="Chỉ hiện phiên đang chạy"
            data-active={stat === 'run'}
            className={cn('tap44 flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors',
              stat === 'run' ? 'bg-status-ok/15 text-status-ok' : 'hover:bg-accent/50')}>
            <span className="size-2 rounded-full bg-status-ok" />
            Đang chạy <b className="tabular-nums">{tally.run}</b>
          </button>
          <button onClick={() => { setStat(stat === 'idle' ? '' : 'idle'); setPage(0); }}
            data-testid="sum-idle" title="Chỉ hiện phiên đã nghỉ"
            data-active={stat === 'idle'}
            className={cn('tap44 flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors',
              stat === 'idle' ? 'bg-muted text-foreground' : 'hover:bg-accent/50')}>
            <span className="size-2 rounded-full bg-muted-foreground/60" />
            Đã nghỉ <b className="tabular-nums">{tally.idle}</b>
          </button>
          {stat && (
            <button onClick={() => { setStat(''); setPage(0); }} data-testid="sum-clear"
              className="tap44 px-1 text-muted-foreground underline-offset-2 hover:underline">bỏ lọc</button>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {/* Thanh công cụ — MỘT hàng, không cho xuống dòng.
              Bản cũ dùng flex-wrap + min-w-[160px] nên trên iPhone 390px ô tìm và bộ
              lọc dự án tách thành hai dòng, ăn 105px. Cộng cả phần đầu trang thì thẻ
              phiên đầu tiên nằm ở 439px — quá nửa màn hình chỉ để tới được nó. */}
          <div className="flex items-center gap-2 border-b border-border p-2.5">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} data-testid="search-box"
                placeholder="Tìm phiên…" className="h-11 pl-8 text-[16px] md:h-9 md:text-[14px]" />
            </div>
            <select value={proj} onChange={(e) => { setProj(e.target.value); setPage(0); }} data-testid="project-filter"
              className="h-11 w-[104px] shrink-0 rounded-lg border border-border bg-card px-2 text-[13px] outline-none sm:h-9 sm:w-auto sm:px-2.5 sm:text-[14px]">
              <option value="">Mọi dự án</option>
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
              <Button variant="outline" size="sm" className="tap44 ml-auto h-8 text-[12px]"
                data-testid="bulk-clear" onClick={() => setSel(new Set())}>
                Bỏ chọn
              </Button>
              <Button variant="outline" size="sm" className="tap44 h-8 text-[12px] text-status-error"
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

          {/* Thanh điều khiển của lưới — giữ lại hai thứ vốn nằm trong đầu bảng:
              ô chọn-tất-cả và nút sắp xếp. Bỏ bảng mà quên chúng là mất tính năng. */}
          {/* MỘT hàng, cuộn ngang nếu chật — không cho xuống dòng.
              Chữ "Sắp xếp" bỏ trên điện thoại: ba nút bên cạnh đã tự nói lên điều đó,
              giữ lại chỉ tổ đẩy hàng thành hai dòng. */}
          <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-2.5 py-1.5"
            style={{ scrollbarWidth: 'none' }}>
            {/* -my-1.5 py-1.5 px-2: nới vùng chạm cho ô 16px. Trên mobile chữ "Chọn
                cả trang" bị ẩn nên label co lại đúng bằng ô vuông — không đủ để bấm
                bằng ngón tay. Phần nới ra chồng lên đệm sẵn có nên hàng không cao thêm. */}
            <label className="-my-1.5 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-2 px-2 text-[12.5px] text-muted-foreground sm:min-h-0 sm:min-w-0 sm:justify-start sm:px-0">
              <input type="checkbox" data-testid="sel-all"
                className="size-4 cursor-pointer accent-primary"
                checked={view.length > 0 && view.every((s) => sel.has(s.sid))}
                onChange={(e) => {
                  const next = new Set(sel);
                  view.forEach((s) => (e.target.checked ? next.add(s.sid) : next.delete(s.sid)));
                  setSel(next);
                }} />
              <span className="hidden sm:inline">Chọn cả trang</span>
            </label>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <span className="hidden text-[12.5px] text-muted-foreground sm:inline">Sắp xếp</span>
              {sapXep('mtimeMs', 'Mới nhất')}
              {sapXep('title', 'Tên')}
              {sapXep('msgs', 'Tin nhắn')}
            </div>
          </div>

          {/* LƯỚI THẺ — dùng CHUNG cho điện thoại và máy tính.
              Trước đây có hai bản riêng: bảng 6 cột cho desktop, dòng gọn cho mobile.
              Hai bản lệch nhau (mobile thiếu hẳn menu ⋯ và ô chọn), và cả hai đều
              không có chỗ hiện "phiên đang dở việc gì". Một lưới co giãn là đủ. */}
          <div data-testid="session-grid"
            className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {view.map((s) => (
              <SessionCard key={s.sid} s={s} truoc={ago}
                chon={sel.has(s.sid)}
                onChon={(v) => {
                  const next = new Set(sel);
                  v ? next.add(s.sid) : next.delete(s.sid);
                  setSel(next);
                }}
                onOpen={onOpen}
                menu={<RowMenu s={s} onOpen={onOpen} />} />
            ))}
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
      <TaskBar perm={perm} effort={effort} onOpen={onOpen} />
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
          <Button variant="ghost" size="icon" className="tap44 size-7" title="Thêm"
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
