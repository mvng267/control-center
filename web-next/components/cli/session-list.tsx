'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, ChevronLeft, ChevronRight, Plus, SlidersHorizontal, Check, ArrowUp, ArrowDown,
  MoreHorizontal, MessageSquare, Download, Square, Eye, EyeOff,
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
import { SheetDuoi } from '@/components/ui/sheet-duoi';

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

/* MỘT nguồn duy nhất cho danh sách kiểu sắp xếp — menu và dòng trạng thái cùng đọc
   từ đây. Hai bản riêng là hai nơi lệch nhau lúc nào không biết. */
const SAP_XEP: { k: SortKey; nhan: string }[] = [
  { k: 'mtimeMs', nhan: 'Mới nhất' },
  { k: 'project', nhan: 'Dự án' },
  { k: 'title', nhan: 'Tên' },
  { k: 'msgs', nhan: 'Tin nhắn' },
];
// Tên cũ là PAGE, và đúng cái tên đó gây ra lỗi phân trang: chỗ hiện "1 – 10 / 133"
// dùng hằng PAGE thay vì biến perPage, nên chọn 50 dòng/trang vẫn nói "1 – 10".
// Đổi tên để không ai lặp lại nhầm lẫn.
const PAGE_MAC_DINH = 10;
const KHOA_NHAP = '__nhap__';

/* Bỏ dấu tiếng Việt trước khi so khớp. Tiêu đề do Claude tự đặt gần như luôn có dấu
   ("Kiểm tra tiến độ"), mà gõ trên điện thoại thì hay gõ không dấu — trước đây gõ
   "kiem tra" ra 0 kết quả dù phiên đó đang nằm ngay trên màn hình.
   NFD tách dấu thành ký tự tổ hợp riêng rồi xoá chúng; `đ` không phải tổ hợp nên phải
   thay tay. Dùng thư viện chuẩn của JS, không thêm package nào. */
function boDau(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

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
  sessions, jobs, perm, effort, model, onOpen, quick, sidMo, gonGang,
}: {
  sessions: Session[]; jobs: Job[]; perm?: string; effort?: string;
  model?: string | null;   // model toàn cục — chuyển tiếp cho màn giao task
  onOpen: (sid: string) => void;
  quick?: { q: string; n: number };   // lối tắt "Xem nhanh" ở sidebar
  /** phiên đang mở ở cột chat — tô sáng để biết mình đang đọc cái nào (kiểu Telegram) */
  sidMo?: string | null;
  /* Cột hẹp bên trái khi đang mở phiên: bỏ những thứ chỉ hợp với màn rộng (đầu trang,
     dải tóm tắt, phân trang) và ép mỗi hàng một thẻ. Không gọn lại thì cột 340px phải
     cuộn ngang mới đọc được. */
  gonGang?: boolean;
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
  // Ba bộ lọc thêm, nằm trong menu ⇅ cùng với sắp xếp
  const [locCho, setLocCho] = useState(false);
  const [anDaXoa, setAnDaXoa] = useState(false);
  const [locChuaDoc, setLocChuaDoc] = useState(false);
  const [moMenu, setMoMenu] = useState(false);
  // Lọc chỉ xem phiên đã ghim — nằm cùng menu ⇅ với các bộ lọc khác
  const [locFav, setLocFav] = useState(false);

  /* Ghim/bỏ ghim. Đổi giao diện NGAY rồi mới gọi server: nhịp SSE 2 giây mới về, chờ
     nó thì bấm sao xong mà ngôi sao đứng im — người dùng tưởng bấm trượt rồi bấm lại,
     thành ra bật rồi tắt. Cùng lối "cập nhật lạc quan" đã dùng cho công tắc tab. */
  const [favTam, setFavTam] = useState<Record<string, boolean>>({});
  const doiFav = (sid: string, bat: boolean) => {
    setFavTam((x) => ({ ...x, [sid]: bat }));
    api('/api/fav/' + sid, { method: 'POST', body: JSON.stringify({ bat }) })
      .catch(() => {
        // server từ chối -> trả lại như cũ, đừng để giao diện nói dối
        setFavTam((x) => ({ ...x, [sid]: !bat }));
        toast.error('Không ghim được');
      });
  };

  // Hiện cả phiên đã ẩn — nằm cùng menu ⇅ với các bộ lọc khác
  const [hienAn, setHienAn] = useState(false);
  /* Ẩn phiên. Cùng lối cập-nhật-lạc-quan với ghim: nhịp SSE 2 giây mới về, chờ nó thì
     bấm "Ẩn" xong thẻ vẫn nằm đó — người dùng tưởng bấm hụt rồi bấm lại. */
  const [anTam, setAnTam] = useState<Record<string, boolean>>({});
  const doiAn = (sid: string, bat: boolean) => {
    setAnTam((x) => ({ ...x, [sid]: bat }));
    api('/api/an/' + sid, { method: 'POST', body: JSON.stringify({ bat }) })
      .then(() => toast(bat ? 'Đã ẩn — bật "Hiện cả phiên đã ẩn" để xem lại' : 'Đã bỏ ẩn'))
      .catch(() => {
        setAnTam((x) => ({ ...x, [sid]: !bat }));
        toast.error('Không ẩn được');
      });
  };

  useEffect(() => {
    try { setMoNhap(localStorage.getItem('cli-mo-nhap') === '1'); } catch {}
  }, []);
  const doiMoNhap = (v: boolean) => {
    setMoNhap(v); setPage(0);
    try { localStorage.setItem('cli-mo-nhap', v ? '1' : '0'); } catch {}
  };

  /* Nhớ lựa chọn qua localStorage — nhưng CHỈ những thứ an toàn khi khôi phục.
     KHÔNG nhớ `stat` và `q`: mở app ra thấy danh sách đã lọc sẵn theo thứ đặt từ hôm
     qua thì tưởng mất phiên, khó chịu hơn hẳn việc bấm lại một nút. Cùng lý do
     `cli-mo-nhap` bao lâu nay chỉ nhớ đúng một thứ. */
  useEffect(() => {
    try {
      const raw = localStorage.getItem('cli-loc');
      if (!raw) return;
      const c = JSON.parse(raw);
      if (c.sort?.k) setSort({ k: c.sort.k, dir: c.sort.dir === 1 ? 1 : -1 });
      if (typeof c.proj === 'string') setProj(c.proj);
      if ([10, 25, 50].includes(c.perPage)) setPerPage(c.perPage);
      setLocCho(!!c.locCho);
      setAnDaXoa(!!c.anDaXoa);
      setLocChuaDoc(!!c.locChuaDoc);
      setLocFav(!!c.locFav);
    } catch {}
  }, []);

  /* Ghi lại mỗi khi đổi. Bỏ qua lần chạy đầu để không đè cấu hình đã lưu bằng giá trị
     mặc định trong khoảnh khắc trước khi useEffect ở trên kịp nạp. */
  const daNap = useRef(false);
  useEffect(() => {
    if (!daNap.current) { daNap.current = true; return; }
    try {
      localStorage.setItem('cli-loc', JSON.stringify({
        sort, proj, perPage, locCho, anDaXoa, locChuaDoc, locFav,
      }));
    } catch {}
  }, [sort, proj, perPage, locCho, anDaXoa, locChuaDoc, locFav]);

  // Bật/tắt một bộ lọc thì phải về trang 1 — đang ở trang 5 mà lọc còn 3 kết quả
  // thì màn hình trống trơn, nhìn như hỏng.
  const doiLoc = (dat: () => void) => { dat(); setPage(0); };
  const soLocBat = (locCho ? 1 : 0) + (anDaXoa ? 1 : 0) + (locChuaDoc ? 1 : 0);

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
    const needle = boDau(q.trim());
    /* Áp cập nhật lạc quan LÊN TRƯỚC mọi thứ khác: lọc và sắp xếp đều đọc `fav`, nên
       nếu chỉ áp lúc vẽ thì bấm sao xong phiên không nhảy lên đầu ngay. */
    const dsFav = Object.keys(favTam).length || Object.keys(anTam).length
      ? sessions.map((s) => {
        let r = s;
        if (s.sid in favTam) r = { ...r, fav: favTam[s.sid] };
        if (s.sid in anTam) r = { ...r, an: anTam[s.sid] };
        return r;
      })
      : sessions;
    const out = dsFav.filter((s) => {
      const d = s.duAn;
      if (locFav && !s.fav) return false;
      // phiên đã ẩn: giấu mặc định, hiện lại khi bật công tắc trong menu ⇅
      if (s.an && !hienAn) return false;
      if (proj && (d?.khoa || s.project) !== proj) return false;
      if (stat === 'run' && !['RUNNING', 'ACTIVE'].includes(s.status)) return false;
      if (stat === 'idle' && ['RUNNING', 'ACTIVE'].includes(s.status)) return false;
      // Tab "Việc nền" hiện JobsPanel, không hiện phiên nào
      if (stat === 'jobs') return false;

      /* Ba bộ lọc thêm, đều dùng trường server ĐÃ trả mà giao diện chưa đụng tới.
         `cho`: phiên đang ĐỨNG IM chờ bấm duyệt kế hoạch hoặc trả lời câu hỏi — thứ
         cần tay người ngay, mà trước đây phải tự dò từng thẻ mới thấy.
         `conTonTai === false`: thư mục gốc đã bị xoá nên nhắn vào rơi vào hư không.
         Đo trên máy này: 24/136 phiên (18%) — gần một phần năm danh sách là rác
         không dùng được, mà không có cách nào giấu đi. */
      if (locCho && !s.cho) return false;
      if (anDaXoa && d && d.conTonTai === false) return false;
      if (locChuaDoc && !s.unread) return false;

      /* Ô tìm trước đây chỉ quét sid + project + title: gõ nội dung câu cuối hay tên
         repo đều ra 0 kết quả dù chữ đó đang hiện ngay trên thẻ.
         `dangChay` cũng phải có mặt: dòng 3 của thẻ hiện dangChay ĐÈ LÊN tinCuoi khi
         phiên đang chạy, nên thiếu nó thì gõ đúng chữ đang đọc được trên thẻ
         ("Bash(npm test)") lại ra 0 kết quả — đúng lỗi mà bài này bọc.
         So khớp sau khi BỎ DẤU cả hai vế: tiêu đề Claude đặt thường có dấu, mà gõ
         trên điện thoại thì hay gõ không dấu. */
      if (needle) {
        const kho = boDau([s.sid, s.project, s.title, s.tinCuoi, s.dangChay, d?.ten, d?.repo, d?.duongDan]
          .filter(Boolean).join(' '));
        if (!kho.includes(needle)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      /* PHIÊN GHIM luôn lên đầu, bất kể đang sắp theo gì. Đó là lý do tồn tại của
         tính năng: danh sách xoay theo thời gian nên phiên đang làm dở tụt xuống
         ngay khi mở phiên khác. Ghim rồi mà vẫn phải tìm thì ghim để làm gì. */
      if (!!a.fav !== !!b.fav) return a.fav ? -1 : 1;
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
  }, [sessions, q, proj, stat, sort, locCho, anDaXoa, locChuaDoc, locFav, favTam, hienAn, anTam]);

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

  /* Số ghi cạnh mỗi bộ lọc trong menu. Phải đếm trong ĐÚNG phạm vi đang hiển thị,
     không đếm trên toàn bộ `sessions` — đo thật trên máy này: 24 phiên có thư mục đã
     xoá, nhưng 23 trong số đó là phiên NHÁP đang bị nhóm Nháp giấu đi. Ghi "24" thì
     người dùng bật lên chờ danh sách ngắn đi 24, thực tế tụt đúng 1. */
  const demLoc = useMemo(() => {
    const trong = hienNhap ? sessions : sessions.filter((s) => !s.duAn?.laNhap);
    return {
      cho: trong.filter((s) => s.cho).length,
      daXoa: trong.filter((s) => s.duAn && s.duAn.conTonTai === false).length,
      chuaDoc: trong.filter((s) => s.unread).length,
      // đếm theo trạng thái ĐANG HIỆN (kể cả cái vừa bấm chưa kịp về từ server)
      fav: trong.filter((s) => (s.sid in favTam ? favTam[s.sid] : s.fav)).length,
      an: trong.filter((s) => (s.sid in anTam ? anTam[s.sid] : s.an)).length,
    };
  }, [sessions, hienNhap, favTam, anTam]);
  const soNhap = hop.length - hop.filter((s) => !s.duAn?.laNhap).length;

  /* Cột hẹp bên trái không có hàng phân trang (không đủ chỗ), nên phải hiện nhiều hơn
     rồi để người dùng cuộn — kiểu Telegram. 200 là trần an toàn: đo trên máy này 155
     phiên, mà mỗi thẻ chỉ là DOM tĩnh nên cuộn vẫn mượt. */
  const soMoiTrang = gonGang ? 200 : perPage;
  const pages = Math.max(1, Math.ceil(rows.length / soMoiTrang));
  const cur = Math.min(page, pages - 1);
  const view = rows.slice(cur * soMoiTrang, cur * soMoiTrang + soMoiTrang);

  /* Gom nhóm CHỈ khi đang sắp xếp theo dự án. Đã thử gom cả khi sắp "Mới nhất":
     10 phiên mới nhất rơi vào 6 dự án khác nhau, nên đầu nhóm ăn chỗ mà mỗi nhóm chỉ
     có 1 thẻ — trên iPhone tụt từ 3 thẻ xuống 2. Thứ tự thời gian và gom nhóm là hai
     ý định loại trừ nhau; ép cả hai thì hỏng cả hai.
     Lọc về một dự án cũng không gom: cả trang cùng một nhóm thì đầu nhóm là thừa. */
  const gomTheoNhom = !proj && sort.k === 'project';
  const nhomView = useMemo(() => (gomTheoNhom ? gomNhom(view) : []), [view, gomTheoNhom]);

  return (
    /* `relative`: neo cho nút tròn nổi ở chế độ hai cột — nếu không nó rơi ra mép phải
       cửa sổ và đè lên khung chat. */
    <div className="relative flex h-full min-h-0 flex-col" data-testid="cli-list">
      {/* HÀNG TAB thay cho tiêu đề "Phiên Claude" + mô tả + dải tóm tắt.
          Đo trên iPhone 390px: ba khối đó đẩy thẻ phiên đầu tiên xuống 296px — 35%
          màn hình chỉ để tới được danh sách. Tab vừa gọn hơn vừa nói đúng việc:
          mỗi mục là một BỘ LỌC có số đếm, không phải nhãn trang trí. */}
      {/* px-2 + gap-0 trên điện thoại: với px-3/gap-1 thì tab thứ tư ("Việc nền") tràn
          khỏi mép 390px — cuộn ngang được nhưng nhìn vào tưởng chỉ có ba tab, mà tab
          nào cũng phải thấy mới biết là bấm được. */}
      <div className={cn('flex shrink-0 items-center overflow-x-auto an-thanh-cuon border-b border-border pt-2',
        // cột hẹp 340px: bỏ đệm ngang và khoảng cách để 4 tab vừa đủ chỗ, không phải cuộn
        gonGang ? 'gap-0 px-1.5' : 'gap-0 px-2 sm:gap-1 sm:px-3')} data-testid="tab-loc">
        {[
          { id: '', nhan: 'Tất cả', so: sessions.length, cham: '' },
          { id: 'run', nhan: 'Đang chạy', so: tally.run, cham: 'bg-status-ok' },
          { id: 'idle', nhan: 'Đã nghỉ', so: tally.idle, cham: 'bg-muted-foreground/50' },
          { id: 'jobs', nhan: 'Việc nền', so: jobs.length, cham: '' },
        ].map((t) => (
          <button key={t.id || 'all'} data-testid={'tab-' + (t.id || 'all')} data-active={stat === t.id}
            onClick={() => { setStat(t.id); setPage(0); }}
            /* Nới bằng ĐỆM THẬT (py-3 = 44px cả hàng), KHÔNG dùng `.tap44`: bốn tab này
               đã dùng `after:` để vẽ gạch chân tab đang chọn, mà `.tap44::after` cũng
               chiếm ::after — đè nhau, mất gạch chân hoặc mất vùng chạm.
               py-3 ra 42px (thiếu 2), nên dùng min-h-11 = 44px đúng ngưỡng. */
            className={cn('relative flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap py-2 transition-colors',
              /* Cột hẹp giữ 12px và đệm nhỏ: ở 14px thì bốn tab cộng lại vượt 340px,
                 tab "Việc nền" bị cắt mất chữ — nhìn vào tưởng chỉ có ba tab. */
              gonGang ? 'gap-1 px-1.5 text-[12px]' : 'gap-1 px-2 text-[12px] sm:gap-1.5 sm:px-2.5 sm:text-[14px]',
              stat === t.id
                ? 'font-medium text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
                : 'text-muted-foreground hover:text-foreground')}>
            {!!t.cham && <span className={cn('size-1.5 rounded-full', t.cham)} />}
            {/* Cột hẹp rút nhãn: "Việc nền" -> "Nền", "Đang chạy" -> "Chạy" */}
            {gonGang ? (t.id === 'jobs' ? 'Nền' : t.id === 'run' ? 'Chạy' : t.id === 'idle' ? 'Nghỉ' : 'Tất cả') : t.nhan}
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
              {/* h-9 thay h-11: hàng này ăn 44px vĩnh viễn cho thứ phần lớn thời gian
                  để trống. text-[16px] trên mobile là BẮT BUỘC — dưới 16px thì Safari
                  iOS tự phóng to trang khi chạm vào ô nhập. */}
              <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} data-testid="search-box"
                placeholder="Tìm phiên…" className="h-9 pl-8 text-[16px] md:text-[14px]" />
            </div>
            {/* Dropdown dự án CHỈ ở cột rộng. Ở cột hẹp 340px, ô tìm + dropdown + nút
                menu cộng lại làm ô tìm co còn ~160px — gõ vài chữ là không đọc được
                mình vừa gõ gì. Lọc theo dự án chuyển vào menu ⇅ cùng các bộ lọc khác. */}
            <select value={proj} onChange={(e) => { setProj(e.target.value); setPage(0); }} data-testid="project-filter"
              className={cn('h-9 shrink-0 rounded-lg border border-border bg-card px-2 text-[14px] outline-none sm:w-auto sm:px-2.5',
                gonGang ? 'hidden' : 'w-[104px]')}>
              <option value="">Mọi dự án</option>
              {projects.map((p) => <option key={p.khoa} value={p.khoa}>{p.nhan}</option>)}
            </select>

            {/* Nút mở menu sắp xếp + lọc. Trước đây bốn nút sắp xếp bày phẳng thành
                MỘT HÀNG RIÊNG ăn 43px vĩnh viễn, trong khi phần lớn thời gian người
                dùng để nguyên "Mới nhất". Gom vào menu, lấy chỗ đó cho danh sách. */}
            <button type="button" data-testid="mo-loc" onClick={() => setMoMenu(true)}
              title="Sắp xếp và lọc"
              className="tap44 relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:text-foreground">
              <SlidersHorizontal className="size-4" />
              {/* Chấm báo có lọc đang bật. Không có nó thì bật lọc rồi quên là ngồi
                  nhìn danh sách trống mà không hiểu vì sao thiếu phiên. */}
              {soLocBat > 0 && (
                <span data-testid="loc-dang-bat"
                  className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">
                  {soLocBat}
                </span>
              )}
            </button>
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
              <span className="text-[14px] font-medium">Đã chọn {sel.size}</span>
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
          {/* Hàng này ẩn hẳn trên điện thoại: "Chọn cả trang" vốn đã `sm:flex`, nên ở
              390px nó chỉ còn mỗi chữ "Mới nhất ↓" mà vẫn ăn 26px. Muốn biết đang sắp
              xếp theo gì thì mở menu — trong đó có dấu ✓. */}
          {/* Cột hẹp ẩn nốt hàng này: đang mở phiên thì việc chính là ĐỌC chat, còn
              chọn nhiều phiên để thao tác hàng loạt là việc của màn danh sách đầy đủ.
              Giữ lại chỉ tổ ăn mất chiều cao của thẻ phiên trong cột 340px. */}
          <div className={cn('hidden items-center gap-2 overflow-x-auto an-thanh-cuon sm:flex',
            (stat === 'jobs' || gonGang) && 'sm:hidden')}>
            {/* "Chọn cả trang" ẨN HẲN trên điện thoại. Đo trên iPhone 390px: hàng này
                ăn 45px nhưng chữ bị ẩn, nên chỉ còn MỘT Ô VUÔNG TRƠ TRỌI không ai hiểu
                để làm gì. Trên điện thoại thay bằng chạm giữ một thẻ để vào chế độ
                chọn (giống ứng dụng Ảnh); desktop giữ nguyên vì có chỗ. */}
            <label className="hidden shrink-0 cursor-pointer items-center gap-2 text-[14px] text-muted-foreground sm:flex">
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
            {/* Cho biết đang sắp xếp theo gì — bốn nút đã vào menu, không còn nhìn
                thấy trạng thái nữa. Chỉ chữ, không bấm được: muốn đổi thì mở menu. */}
            <span className="ml-auto shrink-0 text-[12px] text-muted-foreground" data-testid="sort-hien-tai">
              {SAP_XEP.find((x) => x.k === sort.k)?.nhan}
              {sort.dir === 1
                ? <ArrowUp className="ml-0.5 inline size-3" />
                : <ArrowDown className="ml-0.5 inline size-3" />}
            </span>
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
                        <span className="shrink-0 text-[14px] font-semibold" data-testid="nhom-ten">{g.ten}</span>
                        {/* Repo GitHub khi có git; không thì đường dẫn — hai thứ đều
                            trả lời đúng câu "dự án này nằm ở đâu". */}
                        <span className="truncate text-[12px] text-muted-foreground" data-testid="nhom-repo">
                          {g.repo ? g.repo + (g.nhanh ? ' · ' + g.nhanh : '') : g.duongDan}
                        </span>
                        {/* Cảnh báo đặt Ở ĐẦU NHÓM, không lặp trên cả 13 thẻ cùng dự án */}
                        {!g.conTonTai && (
                          <span data-testid="nhom-mat" title="Thư mục gốc đã bị xoá — nhắn vào phiên này sẽ không tới nơi"
                            className="shrink-0 rounded-md bg-status-error/12 px-1.5 py-0.5 text-[12px] font-medium text-status-error">
                            thư mục đã xoá
                          </span>
                        )}
                        <span className="ml-auto shrink-0 whitespace-nowrap text-[12px] tabular-nums text-muted-foreground">
                          {g.ss.length} phiên{g.tok ? ' · ' + gonSo(g.tok) : ''}
                        </span>
                      </button>
                      {/* Bấm tên nhóm = lọc nhanh về dự án đó. Tách thành nút riêng để
                          không tranh chấp với việc gập/mở. */}
                      {!g.laNhap && (
                        <button data-testid="nhom-loc" title={'Chỉ xem ' + g.ten}
                          onClick={() => { setProj(g.khoa); setPage(0); }}
                          className="tap44 shrink-0 rounded-lg px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground">
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
                            dangMo={s.sid === sidMo}
                            onFav={(bat) => doiFav(s.sid, bat)}
                            onOpen={onOpen}
                            menu={<RowMenu s={s} onOpen={onOpen} onAn={(bat) => doiAn(s.sid, bat)} />} />
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
                  dangMo={s.sid === sidMo}
                  onFav={(bat) => doiFav(s.sid, bat)}
                  onOpen={onOpen}
                  menu={<RowMenu s={s} onOpen={onOpen} onAn={(bat) => doiAn(s.sid, bat)} />} />
              ))}
            </div>
          )}

          {/* Nhóm Nháp đang gập: nói rõ còn bao nhiêu phiên bị giấu, kèm nút mở.
              Ẩn im lặng thì người dùng đếm tay ra số khác con số đầu trang. */}
          {!hienNhap && soNhap > 0 && (
            <button data-testid="mo-nhap" onClick={() => doiMoNhap(true)}
              className="tap44 flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-[14px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground">
              <ChevronRight className="size-3.5" />
              Hiện thêm {soNhap} phiên nháp (thư mục tạm)
            </button>
          )}
          {hienNhap && soNhap > 0 && !nhapTrungTim && (
            <button data-testid="an-nhap" onClick={() => doiMoNhap(false)}
              className="tap44 flex w-full items-center justify-center gap-1.5 border-t border-border py-2.5 text-[14px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground">
              Ẩn {soNhap} phiên nháp
            </button>
          )}

          {view.length === 0 && stat !== 'jobs' && (
            <div className="py-12 text-center text-[14px] text-muted-foreground">Không có phiên nào khớp</div>
          )}

          {/* phân trang */}
          {/* Tab "Việc nền" không phân trang phiên — ẩn cả hàng này */}
          {/* Cột hẹp cũng ẩn: "Dòng mỗi trang" + "1 – 10 / 133" nằm cạnh nhau cần
              ~300px, ở 340px là vỡ thành hai hàng và ăn mất chỗ của thẻ phiên. */}
          <div className={cn('items-center justify-between gap-2 border-t border-border/60 pt-3',
            stat === 'jobs' || gonGang ? 'hidden' : 'flex')}>
            <div className="flex items-center gap-2">
              <span className="text-[14px] text-muted-foreground">Dòng mỗi trang</span>
              <select value={perPage} data-testid="per-page"
                onChange={(e) => { setPerPage(+e.target.value); setPage(0); }}
                className="h-8 rounded-lg border border-border bg-card px-2 text-[14px]">
                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <span className="text-[14px] text-muted-foreground" data-testid="pagination-info">
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
              <span className="px-2 text-[14px] tabular-nums">{cur + 1} / {pages}</span>
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
          che nút phân trang. Luôn với tới được bằng ngón cái.

          Ở bố cục HAI CỘT (đang mở phiên) thì `fixed right-4` neo vào mép PHẢI cửa sổ,
          tức nằm đè lên khung chat chứ không phải cột danh sách — thấy rõ trên ảnh
          chụp 1440px: nút xanh che góc phải dưới của khung chat. Lúc đó chuyển thành
          nút nhỏ nằm TRONG cột trái. */}
      <button data-testid="new-session" onClick={() => setTaoTask(true)}
        title="Giao việc mới cho Claude" aria-label="Giao việc mới cho Claude"
        className={cn('z-40 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95',
          gonGang
            ? 'absolute bottom-4 right-4 size-12'
            : 'fixed right-4 size-14 md:bottom-6')}
        style={gonGang ? undefined : { bottom: 'calc(74px + env(safe-area-inset-bottom))' }}>
        <Plus className={gonGang ? 'size-5' : 'size-6'} />
      </button>

      {/* Giao việc là một MÀN RIÊNG, không phải thanh dẹt chiếm 109px dưới đáy danh
          sách. Bấm nút tròn nổi mới mở. */}
      {taoTask && (
        <ManTaoTask perm={perm} effort={effort} model={model}
          onDong={() => setTaoTask(false)} onOpen={onOpen} />
      )}

      {/* MENU SẮP XẾP + LỌC. Dùng sheet trượt đáy cho CẢ hai màn: trên điện thoại vì
          ngón cái với tới, trên máy tính vì không đáng dựng thêm một Dialog riêng chỉ
          để bày đúng bảy dòng này. */}
      <SheetDuoi mo={moMenu} onDong={() => setMoMenu(false)} tieuDe="Sắp xếp và lọc"
        testid="menu-loc">
        <div className="px-3 pb-1 pt-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Sắp xếp
        </div>
        {SAP_XEP.map(({ k, nhan }) => (
          <button key={k} type="button" data-testid={'sort-' + k} data-active={sort.k === k}
            /* KHÔNG đóng menu sau khi chọn — có chủ ý. Menu này có CẢ sắp xếp lẫn bốn
               bộ lọc, mà hai thứ đó thường đi cùng nhau ("sắp theo dự án, và chỉ xem
               phiên đã ghim"). Đóng ngay thì mỗi lựa chọn phải mở lại một lần. */
            onClick={() => { setSort((s) => ({ k, dir: s.k === k && s.dir === -1 ? 1 : -1 })); setPage(0); }}
            className="tap44 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent/60">
            <Check className={cn('size-4 shrink-0', sort.k === k ? 'text-primary' : 'opacity-0')} />
            <span className="flex-1 text-[14px]">{nhan}</span>
            {/* Bấm lại mục đang chọn để đảo chiều — mũi tên cho biết chiều hiện tại */}
            {sort.k === k && (
              <span className="flex shrink-0 items-center gap-0.5 text-[12px] text-muted-foreground">
                {sort.dir === 1
                  ? <>tăng <ArrowUp className="size-3" /></>
                  : <>giảm <ArrowDown className="size-3" /></>}
              </span>
            )}
          </button>
        ))}

        <div className="mt-1 border-t border-border px-3 pb-1 pt-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Lọc
        </div>
        {/* Dropdown dự án chuyển vào ĐÂY khi ở cột hẹp — trên hàng lọc nó làm ô tìm co
            còn ~160px. Ở cột rộng nó vẫn nằm ngoài (thao tác một chạm), nên chỗ này ẩn
            đi để không có hai bản cùng lúc. */}
        {gonGang && (
          <div className="px-3 pb-2 pt-1">
            <select value={proj} onChange={(e) => { doiLoc(() => setProj(e.target.value)); }}
              data-testid="project-filter-menu"
              className="h-9 w-full rounded-lg border border-border bg-card px-2 text-[14px] outline-none">
              <option value="">Mọi dự án</option>
              {projects.map((p) => <option key={p.khoa} value={p.khoa}>{p.nhan}</option>)}
            </select>
          </div>
        )}
        {([
          { id: 'cho', bat: locCho, dat: setLocCho, nhan: 'Chỉ phiên chờ tôi duyệt',
            mo: 'Đang đứng chờ bấm duyệt kế hoạch hoặc trả lời câu hỏi', dem: demLoc.cho },
          { id: 'da-xoa', bat: anDaXoa, dat: setAnDaXoa, nhan: 'Ẩn phiên thư mục đã xoá',
            mo: 'Thư mục gốc không còn — nhắn vào rơi vào hư không', dem: demLoc.daXoa },
          { id: 'chua-doc', bat: locChuaDoc, dat: setLocChuaDoc, nhan: 'Chỉ phiên chưa đọc',
            mo: 'Có tin mới chưa xem', dem: demLoc.chuaDoc },
          { id: 'fav', bat: locFav, dat: setLocFav, nhan: 'Chỉ phiên đã ghim',
            mo: 'Bấm ngôi sao trên thẻ để ghim', dem: demLoc.fav },
          { id: 'hien-an', bat: hienAn, dat: setHienAn, nhan: 'Hiện cả phiên đã ẩn',
            mo: 'Ẩn chỉ giấu khỏi danh sách, không xoá file', dem: demLoc.an },
        ]).map((x) => (
          <button key={x.id} type="button" data-testid={'loc-' + x.id} data-active={x.bat}
            onClick={() => doiLoc(() => x.dat(!x.bat))}
            className="tap44 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent/60">
            <span className={cn('flex size-4 shrink-0 items-center justify-center rounded border',
              x.bat ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
              {x.bat && <Check className="size-3" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[14px] font-medium">{x.nhan}</span>
              <span className="truncate text-[12px] text-muted-foreground">{x.mo}</span>
            </span>
            {/* Số phiên khớp — biết trước bật lên còn lại bao nhiêu, đỡ bật rồi tắt */}
            <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{x.dem}</span>
          </button>
        ))}
      </SheetDuoi>
    </div>
  );
}

/* Menu ⋯ cuối mỗi dòng — Atlas có ở mọi bảng. Việc hay làm nhất với một phiên là
   dừng nó hoặc lấy bản ghi ra, mà trước đây phải MỞ phiên rồi mới thấy nút. Ở đây
   làm được ngay từ danh sách. */
function RowMenu({ s, onOpen, onAn }: {
  s: Session; onOpen: (sid: string) => void;
  /** ẩn / bỏ ẩn phiên khỏi danh sách (không xoá file) */
  onAn?: (bat: boolean) => void;
}) {
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
        {/* ẨN — chỉ giấu khỏi danh sách, KHÔNG xoá .jsonl (dữ liệu gốc của CLI).
            Đo trên máy này: 12/145 phiên có thư mục gốc không còn, cộng 17 phiên nháp
            trong /tmp — chiếm chỗ mà nhắn vào cũng rơi vào hư không.
            Cho ẩn phiên BẤT KỲ, không riêng phiên mồ côi: người dùng biết cái nào đáng
            giữ hơn là máy đoán. */}
        {!!onAn && (
          <DropdownMenuItem data-testid="row-an" onClick={() => onAn(!s.an)}>
            {s.an
              ? <><Eye className="size-4" /> Bỏ ẩn phiên</>
              : <><EyeOff className="size-4" /> Ẩn khỏi danh sách</>}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
