'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Search, ChevronsUpDown, ChevronLeft, ChevronRight, Plus,
  MoreHorizontal, MessageSquare, Download, Square,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Session, Job } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ManTaoTask } from './man-tao-task';
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

function gonSo(n: number) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}

type SortKey = 'title' | 'project' | 'msgs' | 'mtimeMs';
// Tên cũ là PAGE, và đúng cái tên đó gây ra lỗi phân trang: chỗ hiện "1 – 10 / 133"
// dùng hằng PAGE thay vì biến perPage, nên chọn 50 dòng/trang vẫn nói "1 – 10".
// Đổi tên để không ai lặp lại nhầm lẫn.
const PAGE_MAC_DINH = 10;
const KHOA_NHAP = '__nhap__';

interface Nhom {
  khoa: string;
  ten: string;
  repo: string;
  nhanh: string;
  duongDan: string;
  conTonTai: boolean;
  laNhap: boolean;
  ss: Session[];
  tok: number;
}

/* Gom phiên theo dự án, giữ NGUYÊN thứ tự đã sắp xếp: nhóm nào có phiên đứng trước
   thì nhóm đó lên trước. Mọi phiên nháp dồn vào MỘT nhóm "Nháp" đặt cuối cùng —
   28 phiên nháp nằm xen giữa các dự án thật làm danh sách rối mà không ai cần đọc. */
function gomNhom(ss: Session[]): Nhom[] {
  const m = new Map<string, Nhom>();
  for (const s of ss) {
    const d = s.duAn;
    const nhap = !!d?.laNhap;
    const khoa = nhap ? KHOA_NHAP : (d?.khoa || s.project || '?');
    let g = m.get(khoa);
    if (!g) {
      g = nhap
        ? { khoa, ten: 'Nháp', repo: '', nhanh: '', duongDan: 'Phiên tạm trong /tmp', conTonTai: true, laNhap: true, ss: [], tok: 0 }
        : {
          khoa, ten: d?.ten || s.project || '?', repo: d?.repo || '', nhanh: d?.nhanh || '',
          duongDan: d?.duongDan || '', conTonTai: d?.conTonTai !== false, laNhap: false, ss: [], tok: 0,
        };
      m.set(khoa, g);
    }
    g.ss.push(s);
    g.tok += s.tok || 0;
  }
  const ds = [...m.values()];
  // Nháp luôn xuống cuối, kể cả khi có phiên nháp vừa chạy xong
  return ds.filter((g) => !g.laNhap).concat(ds.filter((g) => g.laNhap));
}

export function SessionList({
  sessions, jobs, perm, effort, model, onOpen, quick,
}: {
  sessions: Session[]; jobs: Job[]; perm?: string; effort?: string;
  model?: string | null;   // model toàn cục — chuyển tiếp cho màn giao task
  onOpen: (sid: string) => void;
  quick?: { q: string; n: number };   // lối tắt "Xem nhanh" ở sidebar
}) {
  const [q, setQ] = useState('');
  const [proj, setProj] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'mtimeMs', dir: -1 });
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [perPage, setPerPage] = useState(PAGE_MAC_DINH);
  const [stat, setStat] = useState('');       // lọc theo trạng thái ('' = tất cả)
  // Nhóm Nháp mặc định GẬP: 28/133 phiên là rác test, hiện ra chỉ tổ loãng danh sách.
  // Nhớ lựa chọn qua localStorage để không phải gập lại mỗi lần mở.
  const [moNhap, setMoNhap] = useState(false);
  // Chế độ chọn trên điện thoại: chạm giữ một thẻ mới bật (như ứng dụng Ảnh).
  // Trên desktop luôn bật vì có chỗ.
  const [cheDoChon, setCheDoChon] = useState(false);
  const [gapNhom, setGapNhom] = useState<Set<string>>(new Set());
  const [taoTask, setTaoTask] = useState(false);   // màn giao việc (toàn màn hình)

  useEffect(() => {
    try { setMoNhap(localStorage.getItem('cli-mo-nhap') === '1'); } catch {}
  }, []);
  const doiMoNhap = (v: boolean) => {
    setMoNhap(v); setPage(0);
    try { localStorage.setItem('cli-mo-nhap', v ? '1' : '0'); } catch {}
  };

  // Bấm "Phiên đang chạy" ở sidebar -> áp bộ lọc luôn. Phụ thuộc quick.n (không phải
  // quick.q) để bấm lại lần nữa vẫn chạy dù giá trị không đổi.
  useEffect(() => {
    if (quick?.q) { setStat(quick.q); setPage(0); setQ(''); }
  }, [quick?.n]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Danh sách lọc: value = duAn.khoa (cwd), KHÔNG phải chuỗi hiển thị. Hai dự án có
     thể trùng basename ("web" là con của agy-proxy), lọc theo tên sẽ trộn lẫn chúng.
     Nhãn kèm repo khi tên bị trùng để phân biệt được bằng mắt. */
  const projects = useMemo(() => {
    const m = new Map<string, { khoa: string; ten: string; repo: string }>();
    for (const s of sessions) {
      const d = s.duAn;
      if (!d || d.laNhap) continue;
      if (!m.has(d.khoa)) m.set(d.khoa, { khoa: d.khoa, ten: d.ten, repo: d.repo });
    }
    const ds = [...m.values()].sort((a, b) => a.ten.localeCompare(b.ten));
    const dem = new Map<string, number>();
    for (const p of ds) dem.set(p.ten, (dem.get(p.ten) || 0) + 1);
    return ds.map((p) => ({
      ...p,
      nhan: (dem.get(p.ten) || 0) > 1 && p.repo ? `${p.ten} (${p.repo})` : p.ten,
    }));
  }, [sessions]);

  // Đếm theo trạng thái cho dải tóm tắt. RUNNING/ACTIVE đều là "đang chạy" dưới góc
  // nhìn người dùng; chỉ server mới phân biệt tiến trình còn sống hay file vừa đổi.
  const tally = useMemo(() => {
    let run = 0, idle = 0;
    for (const s of sessions) (['RUNNING', 'ACTIVE'].includes(s.status) ? run++ : idle++);
    return { run, idle };   // tổng đã có ở huy hiệu cạnh tiêu đề, không đếm lại
  }, [sessions]);

  // Lọc theo tìm kiếm / dự án / trạng thái — CHƯA trừ nháp, để còn biết kết quả tìm
  // có rơi vào nhóm Nháp đang gập hay không.
  const hop = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = sessions.filter((s) => {
      const d = s.duAn;
      if (proj && (d?.khoa || s.project) !== proj) return false;
      if (stat === 'run' && !['RUNNING', 'ACTIVE'].includes(s.status)) return false;
      if (stat === 'idle' && ['RUNNING', 'ACTIVE'].includes(s.status)) return false;
      // Tab "Việc nền" hiện JobsPanel, không hiện phiên nào
      if (stat === 'jobs') return false;
      /* Ô tìm trước đây chỉ quét sid + project + title: gõ nội dung câu cuối hay tên
         repo đều ra 0 kết quả dù chữ đó đang hiện ngay trên thẻ.
         `dangChay` cũng phải có mặt: dòng 3 của thẻ hiện dangChay ĐÈ LÊN tinCuoi khi
         phiên đang chạy, nên thiếu nó thì gõ đúng chữ đang đọc được trên thẻ
         ("Bash(npm test)") lại ra 0 kết quả — đúng lỗi mà bài này bọc. */
      if (needle) {
        const kho = [s.sid, s.project, s.title, s.tinCuoi, s.dangChay, d?.ten, d?.repo, d?.duongDan]
          .filter(Boolean).join(' ').toLowerCase();
        if (!kho.includes(needle)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      // 'project' không còn là trường so sánh được trực tiếp cho mọi trường hợp:
      // phải so theo tên dự án thật, nếu không phiên thiếu duAn sẽ nhảy lung tung.
      if (sort.k === 'project') {
        const A = a.duAn?.ten || a.project || '', B = b.duAn?.ten || b.project || '';
        return A.localeCompare(B) * sort.dir;
      }
      const A = a[sort.k] ?? '', B = b[sort.k] ?? '';
      if (typeof A === 'number' && typeof B === 'number') return (A - B) * sort.dir;
      return String(A).localeCompare(String(B)) * sort.dir;
    });
    return out;
  }, [sessions, q, proj, stat, sort]);

  // Có kết quả tìm nằm trong nhóm Nháp đang gập -> TỰ BUNG. Gõ tìm mà ra 0 kết quả
  // trong khi phiên đó có thật thì khó hiểu hơn nhiều so với việc lộ mấy phiên nháp.
  const nhapTrungTim = useMemo(
    () => !!q.trim() && hop.some((s) => s.duAn?.laNhap),
    [q, hop],
  );
  const hienNhap = moNhap || nhapTrungTim;

  /* rows = thứ THỰC SỰ đếm và phân trang. Nhóm Nháp đang gập thì 28 phiên đó không
     nằm trong đây: ẩn mà vẫn đếm thì đầu trang nói "133" nhưng đếm tay ra 105 —
     đúng loại lỗi đang đi sửa. */
  const rows = useMemo(
    () => (hienNhap ? hop : hop.filter((s) => !s.duAn?.laNhap)),
    [hop, hienNhap],
  );
  const soNhap = hop.length - hop.filter((s) => !s.duAn?.laNhap).length;

  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const cur = Math.min(page, pages - 1);
  const view = rows.slice(cur * perPage, cur * perPage + perPage);

  /* Gom nhóm CHỈ khi đang sắp xếp theo dự án. Đã thử gom cả khi sắp "Mới nhất":
     10 phiên mới nhất rơi vào 6 dự án khác nhau, nên đầu nhóm ăn chỗ mà mỗi nhóm chỉ
     có 1 thẻ — trên iPhone tụt từ 3 thẻ xuống 2. Thứ tự thời gian và gom nhóm là hai
     ý định loại trừ nhau; ép cả hai thì hỏng cả hai.
     Lọc về một dự án cũng không gom: cả trang cùng một nhóm thì đầu nhóm là thừa. */
  const gomTheoNhom = !proj && sort.k === 'project';
  const nhomView = useMemo(() => (gomTheoNhom ? gomNhom(view) : []), [view, gomTheoNhom]);

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
      {/* HÀNG TAB thay cho tiêu đề "Phiên Claude" + mô tả + dải tóm tắt.
          Đo trên iPhone 390px: ba khối đó đẩy thẻ phiên đầu tiên xuống 296px — 35%
          màn hình chỉ để tới được danh sách. Tab vừa gọn hơn vừa nói đúng việc:
          mỗi mục là một BỘ LỌC có số đếm, không phải nhãn trang trí. */}
      {/* px-2 + gap-0 trên điện thoại: với px-3/gap-1 thì tab thứ tư ("Việc nền") tràn
          khỏi mép 390px — cuộn ngang được nhưng nhìn vào tưởng chỉ có ba tab, mà tab
          nào cũng phải thấy mới biết là bấm được. */}
      <div className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-border px-2 pt-2 sm:gap-1 sm:px-3"
        style={{ scrollbarWidth: 'none' }} data-testid="tab-loc">
        {[
          { id: '', nhan: 'Tất cả', so: sessions.length, cham: '' },
          { id: 'run', nhan: 'Đang chạy', so: tally.run, cham: 'bg-status-ok' },
          { id: 'idle', nhan: 'Đã nghỉ', so: tally.idle, cham: 'bg-muted-foreground/50' },
          { id: 'jobs', nhan: 'Việc nền', so: jobs.length, cham: '' },
        ].map((t) => (
          <button key={t.id || 'all'} data-testid={'tab-' + (t.id || 'all')} data-active={stat === t.id}
            onClick={() => { setStat(t.id); setPage(0); }}
            className={cn('relative flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-2 text-[12px] transition-colors sm:gap-1.5 sm:px-2.5 sm:text-[12.5px]',
              stat === t.id
                ? 'font-medium text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted-foreground hover:text-foreground')}>
            {!!t.cham && <span className={cn('size-1.5 rounded-full', t.cham)} />}
            {t.nhan}
            <b className="tabular-nums opacity-60">{t.so}</b>
          </button>
        ))}
      </div>

      {/* pb-24 trên điện thoại: nút tròn nổi cao 56px neo cách đáy 74px, mà thẻ thì
          CUỘN QUA DƯỚI nó — thẻ nào trôi tới đó là nút `⋯` của nó bị nút nổi che.
          Đo thật trên iPhone 390px: thẻ ở top=715px có nút ⋯ nằm gọn dưới nút nổi
          (x 318–374), bấm vào là mở màn giao việc chứ không ra menu thẻ.
          Chừa chỗ ở cuối vùng cuộn để cuộn hết vẫn đẩy được thẻ cuối lên khỏi nút. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-2 md:px-6 md:pb-4">

        {/* KHÔNG bọc khung bảng. Bản cũ nhốt tất cả trong một hộp `rounded-xl border
            bg-card`, thành ra hai lớp viền lồng nhau: viền hộp rồi tới viền từng thẻ.
            Trên iPhone 390px lớp ngoài còn ăn thêm 2px mỗi bên và cắt bóng đổ của thẻ.
            Bỏ hộp, để thẻ nổi thẳng trên nền — ngăn cách bằng khoảng trắng, không phải
            đường kẻ. */}
        <div className="flex flex-col gap-2">
          {/* Thanh công cụ — MỘT hàng, không cho xuống dòng.
              Bản cũ dùng flex-wrap + min-w-[160px] nên trên iPhone 390px ô tìm và bộ
              lọc dự án tách thành hai dòng, ăn 105px. Cộng cả phần đầu trang thì thẻ
              phiên đầu tiên nằm ở 439px — quá nửa màn hình chỉ để tới được nó. */}
          {/* Tab "Việc nền" không có phiên nào để tìm hay lọc — ẩn cả thanh công cụ,
              nếu không nó gợi ý sai rằng đang lọc danh sách phiên. */}
          <div className={cn('items-center gap-2',
            stat === 'jobs' ? 'hidden' : 'flex')}>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} data-testid="search-box"
                placeholder="Tìm phiên…" className="h-11 pl-8 text-[16px] md:h-9 md:text-[14px]" />
            </div>
            <select value={proj} onChange={(e) => { setProj(e.target.value); setPage(0); }} data-testid="project-filter"
              className="h-11 w-[104px] shrink-0 rounded-lg border border-border bg-card px-2 text-[13px] outline-none sm:h-9 sm:w-auto sm:px-2.5 sm:text-[14px]">
              <option value="">Mọi dự án</option>
              {projects.map((p) => <option key={p.khoa} value={p.khoa}>{p.nhan}</option>)}
            </select>
          </div>

          {/* Việc nền giờ là MỘT TAB riêng, không còn là dải nhét giữa danh sách.
              Dải cũ ăn 20px vĩnh viễn trên mọi màn dù hầu hết lúc không có việc nào. */}
          {stat === 'jobs' && <JobsPanel jobs={jobs} onOpen={onOpen} moSan />}

          {/* bảng — desktop */}
          {/* Chọn xong phải LÀM ĐƯỢC gì đó, không thì checkbox chỉ để trang trí.
              Dừng hàng loạt các phiên đang chạy — việc duy nhất hợp lý ở đây, vì
              dashboard KHÔNG được xoá .jsonl (đó là dữ liệu gốc của Claude CLI). */}
          {sel.size > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-accent/30 px-3 py-2"
              data-testid="bulk-bar">
              <span className="text-[13px] font-medium">Đã chọn {sel.size}</span>
              <Button variant="outline" size="sm" className="tap44 ml-auto h-8 text-[12px]"
                data-testid="bulk-clear" onClick={() => { setSel(new Set()); setCheDoChon(false); }}>
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
                  setCheDoChon(false);
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
          <div className="flex items-center gap-2 overflow-x-auto"
            style={{ scrollbarWidth: 'none' }}>
            {/* "Chọn cả trang" ẨN HẲN trên điện thoại. Đo trên iPhone 390px: hàng này
                ăn 45px nhưng chữ bị ẩn, nên chỉ còn MỘT Ô VUÔNG TRƠ TRỌI không ai hiểu
                để làm gì. Trên điện thoại thay bằng chạm giữ một thẻ để vào chế độ
                chọn (giống ứng dụng Ảnh); desktop giữ nguyên vì có chỗ. */}
            <label className="hidden shrink-0 cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground sm:flex">
              <input type="checkbox" data-testid="sel-all"
                className="size-4 cursor-pointer accent-primary"
                checked={view.length > 0 && view.every((s) => sel.has(s.sid))}
                onChange={(e) => {
                  const next = new Set(sel);
                  view.forEach((s) => (e.target.checked ? next.add(s.sid) : next.delete(s.sid)));
                  setSel(next);
                }} />
              <span>Chọn cả trang</span>
            </label>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <span className="hidden text-[12.5px] text-muted-foreground sm:inline">Sắp xếp</span>
              {sapXep('mtimeMs', 'Mới nhất')}
              {/* Nút này TRƯỚC ĐÂY KHÔNG TỒN TẠI dù SortKey đã khai báo 'project' —
                  sắp xếp theo dự án là thứ khai báo rồi mà không bấm được. */}
              {sapXep('project', 'Dự án')}
              {sapXep('title', 'Tên')}
              {sapXep('msgs', 'Tin nhắn')}
            </div>
          </div>

          {/* LƯỚI THẺ — dùng CHUNG cho điện thoại và máy tính.
              Trước đây có hai bản riêng: bảng 6 cột cho desktop, dòng gọn cho mobile.
              Hai bản lệch nhau (mobile thiếu hẳn menu ⋯ và ô chọn), và cả hai đều
              không có chỗ hiện "phiên đang dở việc gì". Một lưới co giãn là đủ. */}
          {gomTheoNhom ? (
            <div data-testid="session-groups">
              {nhomView.map((g) => {
                const gap = gapNhom.has(g.khoa);
                return (
                  <section key={g.khoa} data-testid="nhom-du-an" data-khoa={g.khoa}
                    className="mb-3 last:mb-0">
                    <div className="mb-1.5 flex items-center gap-2">
                      <button data-testid="nhom-gap"
                        onClick={() => setGapNhom((s) => {
                          const n = new Set(s);
                          gap ? n.delete(g.khoa) : n.add(g.khoa);
                          return n;
                        })}
                        className="tap44 flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-accent/40">
                        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform',
                          !gap && 'rotate-90')} />
                        <span className="shrink-0 text-[13px] font-semibold" data-testid="nhom-ten">{g.ten}</span>
                        {/* Repo GitHub khi có git; không thì đường dẫn — hai thứ đều
                            trả lời đúng câu "dự án này nằm ở đâu". */}
                        <span className="truncate text-[11.5px] text-muted-foreground" data-testid="nhom-repo">
                          {g.repo ? g.repo + (g.nhanh ? ' · ' + g.nhanh : '') : g.duongDan}
                        </span>
                        {/* Cảnh báo đặt Ở ĐẦU NHÓM, không lặp trên cả 13 thẻ cùng dự án */}
                        {!g.conTonTai && (
                          <span data-testid="nhom-mat" title="Thư mục gốc đã bị xoá — nhắn vào phiên này sẽ không tới nơi"
                            className="shrink-0 rounded-md bg-status-error/12 px-1.5 py-0.5 text-[10.5px] font-medium text-status-error">
                            thư mục đã xoá
                          </span>
                        )}
                        <span className="ml-auto shrink-0 whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">
                          {g.ss.length} phiên{g.tok ? ' · ' + gonSo(g.tok) : ''}
                        </span>
                      </button>
                      {/* Bấm tên nhóm = lọc nhanh về dự án đó. Tách thành nút riêng để
                          không tranh chấp với việc gập/mở. */}
                      {!g.laNhap && (
                        <button data-testid="nhom-loc" title={'Chỉ xem ' + g.ten}
                          onClick={() => { setProj(g.khoa); setPage(0); }}
                          className="tap44 shrink-0 rounded-lg px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
                          chỉ xem
                        </button>
                      )}
                    </div>
                    {!gap && (
                      <div className="flex flex-col gap-2">
                        {g.ss.map((s) => (
                          <SessionCard key={s.sid} s={s} truoc={ago} anDuAn
                            chon={sel.has(s.sid)} cheDoChon={cheDoChon}
                            onGiuLau={() => setCheDoChon(true)}
                            onChon={(v) => {
                              const next = new Set(sel);
                              v ? next.add(s.sid) : next.delete(s.sid);
                              setSel(next);
                            }}
                            onOpen={onOpen}
                            menu={<RowMenu s={s} onOpen={onOpen} />} />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            /* MỘT CỘT hàng ngang. Lưới 2-3 cột cũ bắt mắt phải quét zigzag, và mỗi
               thẻ 131px nên desktop chỉ lọt 10 dòng. Dòng ngang hai tầng khoảng 68px
               vừa dày gấp đôi, vừa đọc theo thứ tự trên xuống như log terminal.
               Chú thích để NGOÀI dấu ngoặc nhọn: nhánh ternary chỉ nhận MỘT phần tử,
               thêm một khối chú thích JSX nữa vào là thành hai phần tử, Turbopack
               báo "Expected '</', got 'ident'". */
            <div data-testid="session-grid" className="flex flex-col gap-2">
              {view.map((s) => (
                <SessionCard key={s.sid} s={s} truoc={ago}
                  chon={sel.has(s.sid)} cheDoChon={cheDoChon}
                  onGiuLau={() => setCheDoChon(true)}
                  onChon={(v) => {
                    const next = new Set(sel);
                    v ? next.add(s.sid) : next.delete(s.sid);
                    setSel(next);
                  }}
                  onOpen={onOpen}
                  menu={<RowMenu s={s} onOpen={onOpen} />} />
              ))}
            </div>
          )}

          {/* Nhóm Nháp đang gập: nói rõ còn bao nhiêu phiên bị giấu, kèm nút mở.
              Ẩn im lặng thì người dùng đếm tay ra số khác con số đầu trang. */}
          {!hienNhap && soNhap > 0 && (
            <button data-testid="mo-nhap" onClick={() => doiMoNhap(true)}
              className="tap44 flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground">
              <ChevronRight className="size-3.5" />
              Hiện thêm {soNhap} phiên nháp (thư mục tạm)
            </button>
          )}
          {hienNhap && soNhap > 0 && !nhapTrungTim && (
            <button data-testid="an-nhap" onClick={() => doiMoNhap(false)}
              className="tap44 flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-[12.5px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground">
              Ẩn {soNhap} phiên nháp
            </button>
          )}

          {view.length === 0 && stat !== 'jobs' && (
            <div className="py-12 text-center text-[14px] text-muted-foreground">Không có phiên nào khớp</div>
          )}

          {/* phân trang */}
          {/* Tab "Việc nền" không phân trang phiên — ẩn cả hàng này */}
          <div className={cn('items-center justify-between gap-2 border-t border-border/60 pt-3',
            stat === 'jobs' ? 'hidden' : 'flex')}>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-muted-foreground">Dòng mỗi trang</span>
              <select value={perPage} data-testid="per-page"
                onChange={(e) => { setPerPage(+e.target.value); setPage(0); }}
                className="h-8 rounded-lg border border-border bg-card px-2 text-[13px]">
                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <span className="text-[13px] text-muted-foreground" data-testid="pagination-info">
              {/* perPage, KHÔNG phải hằng PAGE: chọn 50 dòng/trang thì lưới hiện 50 thẻ
                  nhưng dòng này vẫn nói "1 – 10 / 133". */}
              {rows.length ? `${cur * perPage + 1} – ${Math.min((cur + 1) * perPage, rows.length)} / ${rows.length}` : '0'}
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
      {/* NÚT TRÒN NỔI — thay nút "Giao việc" cũ nằm trên tiêu đề (tiêu đề đã bỏ).
          Đặt cách đáy 74px để không đè thanh tab dưới (58px + safe-area) và không
          che nút phân trang. Luôn với tới được bằng ngón cái. */}
      <button data-testid="new-session" onClick={() => setTaoTask(true)}
        title="Giao việc mới cho Claude" aria-label="Giao việc mới cho Claude"
        className="fixed right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-6"
        style={{ bottom: 'calc(74px + env(safe-area-inset-bottom))' }}>
        <Plus className="size-6" />
      </button>

      {/* Giao việc là một MÀN RIÊNG, không phải thanh dẹt chiếm 109px dưới đáy danh
          sách. Bấm nút tròn nổi mới mở. */}
      {taoTask && (
        <ManTaoTask perm={perm} effort={effort} model={model}
          onDong={() => setTaoTask(false)} onOpen={onOpen} />
      )}
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
