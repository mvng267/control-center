'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ChevronRight, Code2, Copy, Eye, FileText, Folder, FolderOpen, Loader2, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { KhoiMa } from './khoi-ma';
import { Markdown } from './markdown';

/* Xem file trong thư mục dự án của phiên.

   TÔ MÀU cú pháp bằng bộ tự viết (lib/to-mau.ts), KHÔNG dùng shiki/highlight.js —
   chúng nặng ~1MB, hơn cả bundle hiện tại. Xem lý do đầy đủ trong to-mau.ts.

   File .md mở ra bản DỰNG SẴN (tiêu đề, danh sách, bảng, link), bấm nút để xem nguồn.
   Đọc tài liệu trên điện thoại mà phải nhìn `##` với `[x](y)` thì gần như không đọc nổi.

   iPhone: một cột — cây thư mục, bấm file thì trượt sang nội dung, có nút ← quay lại.
   Desktop: hai cột — cây trái 260px, nội dung phải. */

interface Tep { ok: boolean; noiDung?: string; soDong?: number; kichThuoc?: number; laNhiPhan?: boolean; quaLon?: boolean; error?: string }
interface Cay { ok: boolean; root: string | null; files: string[]; quaRong?: boolean }

function co(n?: number) {
  if (!n) return '';
  return n < 1024 ? n + 'B' : n < 1024 * 1024 ? (n / 1024).toFixed(0) + 'KB' : (n / 1048576).toFixed(1) + 'MB';
}

/* Dựng cây LỒNG NHAU từ danh sách đường dẫn phẳng server trả về ("src/server/index.js").

   Trước đây gộp cả nhánh thành MỘT khoá phẳng ("web-next/components/cli") vì sợ thụt lề
   nhiều tầng đẩy tên file ra khỏi màn 390px. Nhưng gộp phẳng có cái giá riêng: dự án này
   quét tới 6 tầng, ra hàng chục dòng thư mục đường dẫn dài, cuộn mãi không thấy thứ cần
   — mà mở một nhánh vẫn phải đọc cả tên đường dẫn đầy đủ.

   Cách xử thụt lề: 10px mỗi cấp (không phải 28px như lối thường), và server đã chặn ở
   6 tầng — tức tối đa 60px, còn 330px cho tên file trên iPhone. Tên dài vẫn `truncate`. */
interface Nut {
  ten: string;
  duong: string;          // đường dẫn đầy đủ, dùng làm khoá và để mở file
  laTM: boolean;
  con: Nut[];
  soFile: number;         // tổng file trong nhánh, hiện ở mép phải
}

function dungCay(files: string[]): Nut[] {
  const goc: Nut = { ten: '', duong: '', laTM: true, con: [], soFile: 0 };
  const mucLuc = new Map<string, Nut>([['', goc]]);

  for (const f of files) {
    const phan = f.split('/');
    let cha = goc;
    for (let i = 0; i < phan.length; i++) {
      const cuoi = i === phan.length - 1;
      const duong = phan.slice(0, i + 1).join('/');
      let nut = mucLuc.get(duong);
      if (!nut) {
        nut = { ten: phan[i], duong, laTM: !cuoi, con: [], soFile: 0 };
        mucLuc.set(duong, nut);
        cha.con.push(nut);
      }
      cha = nut;
    }
  }

  // đếm file theo nhánh + xếp thư mục lên trước, rồi mới theo bảng chữ cái
  const dem = (n: Nut): number => {
    if (!n.laTM) return 1;
    n.con.sort((a, b) => (a.laTM === b.laTM ? a.ten.localeCompare(b.ten) : a.laTM ? -1 : 1));
    n.soFile = n.con.reduce((t, c) => t + dem(c), 0);
    return n.soFile;
  };
  dem(goc);
  return goc.con;
}

/** Mọi thư mục có trong cây — để nút "mở tất cả" và lúc đang lọc biết mở cái gì. */
function moiThuMuc(ds: Nut[], ra: string[] = []): string[] {
  for (const n of ds) if (n.laTM) { ra.push(n.duong); moiThuMuc(n.con, ra); }
  return ra;
}

const LA_MD = (d: string) => /\.(md|markdown|mdx)$/i.test(d);

export function XemFile({ sid, onClose }: { sid: string; onClose: () => void }) {
  const [cay, setCay] = useState<Cay | null>(null);
  const [chon, setChon] = useState('');
  const [tep, setTep] = useState<Tep | null>(null);
  const [dangTai, setDangTai] = useState(false);
  const [tim, setTim] = useState('');
  const [moTM, setMoTM] = useState<Set<string>>(new Set());
  /* Xem markdown ở dạng DỰNG SẴN hay NGUỒN. Nhớ theo lựa chọn của người dùng chứ không
     reset mỗi lần mở file: ai đã chọn xem nguồn thường muốn xem nguồn cho cả loạt. */
  const [xemNguon, setXemNguon] = useState(false);

  useEffect(() => {
    let huy = false;
    api<Cay>('/api/tree?sid=' + encodeURIComponent(sid))
      .then((d) => { if (!huy) setCay(d); })
      .catch(() => { if (!huy) setCay({ ok: false, root: null, files: [] }); });
    return () => { huy = true; };
  }, [sid]);

  const moFile = async (duong: string) => {
    setChon(duong); setTep(null); setDangTai(true);
    try {
      const d = await api<Tep>(`/api/file?sid=${encodeURIComponent(sid)}&path=${encodeURIComponent(duong)}`);
      setTep(d);
    } catch {
      setTep({ ok: false, error: 'không đọc được file' });
    } finally { setDangTai(false); }
  };

  const cayNut = useMemo(() => {
    const ds = cay?.files || [];
    const q = tim.trim().toLowerCase();
    return dungCay(q ? ds.filter((f) => f.toLowerCase().includes(q)) : ds);
  }, [cay, tim]);

  // Đang lọc thì mở hết, không thì giữ theo lựa chọn của người dùng
  const dangTim = tim.trim().length > 0;

  /* Mở sẵn tầng ĐẦU khi cây vừa về: cây đóng hết thì mở panel ra chỉ thấy vài dòng thư
     mục, phải bấm mới biết bên trong có gì. Chỉ tầng đầu, không mở sâu — mở hết một dự
     án 6 tầng ra vài trăm dòng còn khó nhìn hơn. */
  useEffect(() => {
    if (!cay?.files?.length) return;
    setMoTM((cu) => (cu.size ? cu : new Set(dungCay(cay.files).filter((n) => n.laTM).map((n) => n.duong))));
  }, [cay]);

  const tatCaTM = useMemo(() => moiThuMuc(cayNut), [cayNut]);
  const moHet = moTM.size >= tatCaTM.length && tatCaTM.length > 0;

  const toggleTM = (k: string) => {
    setMoTM((cu) => {
      const s = new Set(cu);
      if (s.has(k)) s.delete(k); else s.add(k);
      return s;
    });
  };

  const chep = async () => {
    if (!tep?.noiDung) return;
    try {
      await navigator.clipboard.writeText(tep.noiDung);
      toast.success('Đã chép nội dung file');
      navigator.vibrate?.(12);
    } catch { toast.error('Không chép được'); }
  };

  const laMd = LA_MD(chon);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" data-testid="xem-file">
      {/* thanh trên cùng */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2"
        style={{ paddingTop: 'calc(8px + env(safe-area-inset-top))' }}>
        {/* iPhone: đang xem nội dung thì nút ← quay về cây; desktop luôn hiện cây nên ẩn */}
        {chon && (
          <Button variant="ghost" size="icon" className="tap44 size-8 md:hidden"
            data-testid="file-back" onClick={() => { setChon(''); setTep(null); }}>
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold" data-testid="file-title">
            {chon || 'File trong dự án'}
          </span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {cay?.root || '…'}
            {tep?.soDong ? ` · ${tep.soDong} dòng · ${co(tep.kichThuoc)}` : ''}
          </span>
        </span>
        {/* Chỉ file .md mới có nút này: các file khác không có gì để "dựng sẵn". */}
        {tep?.noiDung !== undefined && laMd && (
          <Button variant="ghost" size="icon" className="tap44 size-8" data-testid="file-doi-che-do"
            title={xemNguon ? 'Xem bản dựng sẵn' : 'Xem mã nguồn'}
            onClick={() => setXemNguon((v) => !v)}>
            {xemNguon ? <Eye className="size-4" /> : <Code2 className="size-4" />}
          </Button>
        )}
        {tep?.noiDung && (
          <Button variant="ghost" size="icon" className="tap44 size-8" data-testid="file-copy"
            title="Chép cả file" onClick={chep}>
            <Copy className="size-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="tap44 size-8" data-testid="file-close"
          title="Đóng" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* ---- cây thư mục ---- */}
        <div className={cn(
          'flex min-h-0 flex-col border-border md:w-[260px] md:shrink-0 md:border-r',
          // iPhone: chọn file rồi thì giấu cây đi, nhường cả màn cho nội dung
          chon ? 'hidden md:flex' : 'flex w-full',
        )}>
          <div className="flex items-center gap-1.5 border-b border-border p-2">
            <Input value={tim} onChange={(e) => setTim(e.target.value)} data-testid="file-search"
              placeholder="Lọc theo tên file…" className="h-8 min-w-0 flex-1 text-[16px] md:text-[14px]" />
            {/* Cây lồng nhiều tầng thì "gập tất cả" là lối thoát khi lạc — không có nó,
                mở nhầm một nhánh to phải bấm ngược từng cái. */}
            {!!tatCaTM.length && (
              <Button variant="ghost" size="icon" className="tap44 size-8 shrink-0"
                data-testid="file-mo-het" title={moHet ? 'Gập tất cả' : 'Mở tất cả'}
                onClick={() => setMoTM(moHet ? new Set() : new Set(tatCaTM))}>
                <ChevronRight className={cn('size-4 transition-transform', moHet && 'rotate-90')} />
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1" data-testid="file-tree">
            {!cay && <div className="flex items-center gap-2 p-3 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Đang quét thư mục…
            </div>}
            {/* cwd = thư mục nhà: cây sẽ là 4000 file lẫn lộn Desktop/Documents/Library,
                vừa vô dụng để đọc mã vừa phơi hết file cá nhân ra tailnet. Nói thẳng lý
                do, đừng để người dùng nhìn cây trống rồi tưởng hỏng. */}
            {cay?.quaRong && (
              <p className="p-3 text-[12px] leading-relaxed text-muted-foreground" data-testid="file-qua-rong">
                Phiên này chạy thẳng ở <b className="font-mono">{cay.root}</b> — cả thư mục nhà,
                nên không mở cây file. Mở phiên nào chạy trong thư mục dự án để xem mã.
              </p>
            )}
            {cay && !cay.quaRong && !cay.files.length && (
              <p className="p-3 text-[12px] text-muted-foreground">
                {cay.root ? 'Không có file nào khớp.' : 'Phiên này không có thư mục làm việc.'}
              </p>
            )}
            {cayNut.map((n) => (
              <NutCay key={n.duong} nut={n} sau={0} moTM={moTM} dangTim={dangTim}
                chon={chon} onToggle={toggleTM} onMo={moFile} />
            ))}
          </div>
        </div>

        {/* ---- nội dung file ---- */}
        <div className={cn('min-h-0 min-w-0 flex-1 overflow-auto',
          chon ? 'block' : 'hidden md:block')} data-testid="file-body">
          {dangTai && <div className="flex items-center gap-2 p-4 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Đang mở…
          </div>}
          {!dangTai && !chon && (
            <p className="p-6 text-[14px] text-muted-foreground">Chọn một file bên trái để xem.</p>
          )}
          {!dangTai && tep?.error && (
            <p className="p-4 text-[14px] text-status-error" data-testid="file-error">{tep.error}</p>
          )}
          {!dangTai && tep?.quaLon && (
            <p className="p-4 text-[14px] text-muted-foreground">
              File {co(tep.kichThuoc)} — quá lớn để mở trên trình duyệt (trần 512KB).
            </p>
          )}
          {!dangTai && tep?.laNhiPhan && (
            <p className="p-4 text-[14px] text-muted-foreground">
              File nhị phân ({co(tep.kichThuoc)}) — không hiển thị được dạng chữ.
            </p>
          )}
          {!dangTai && tep?.noiDung !== undefined && (
            laMd && !xemNguon
              ? (
                <div className="px-4 py-3" data-testid="file-md">
                  <Markdown>{tep.noiDung}</Markdown>
                </div>
              )
              : <KhoiMa ma={tep.noiDung} duong={chon} soDong testid="file-content" />
          )}
        </div>
      </div>
    </div>
  );
}

/* Một nút trong cây — gọi lại chính nó cho thư mục con.

   Thụt lề 10px/cấp chứ không phải 28px như lối thường: server chặn quét ở 6 tầng, nên
   tối đa 60px, còn ~330px cho tên file trên iPhone 390px. Với 28px thì tầng 6 ăn 168px
   — gần nửa màn, đúng cái làm bản trước phải gộp cây thành một mức phẳng. */
function NutCay({
  nut, sau, moTM, dangTim, chon, onToggle, onMo,
}: {
  nut: Nut;
  sau: number;
  moTM: Set<string>;
  dangTim: boolean;
  chon: string;
  onToggle: (k: string) => void;
  onMo: (d: string) => void;
}) {
  const le = { paddingLeft: 6 + sau * 10 };

  if (!nut.laTM) {
    return (
      <button onClick={() => onMo(nut.duong)} data-testid="file-item" data-path={nut.duong}
        style={le}
        className={cn('flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left hover:bg-accent',
          chon === nut.duong && 'bg-accent')}>
        {/* chừa đúng chỗ mũi tên của thư mục để tên file thẳng hàng với tên thư mục */}
        <span className="w-3 shrink-0" />
        <FileText className="size-3 shrink-0 text-muted-foreground" />
        <span className="truncate text-[12px]">{nut.ten}</span>
      </button>
    );
  }

  const mo = dangTim || moTM.has(nut.duong);
  return (
    <div>
      <button onClick={() => onToggle(nut.duong)} data-testid="file-dir" data-path={nut.duong}
        data-mo={mo} style={le}
        className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left hover:bg-accent">
        <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', mo && 'rotate-90')} />
        {mo ? <FolderOpen className="size-3.5 shrink-0 text-tool-accent" />
          : <Folder className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate text-[12px] font-medium">{nut.ten}</span>
        <span className="ml-auto shrink-0 pl-1 text-[12px] text-muted-foreground">{nut.soFile}</span>
      </button>
      {mo && nut.con.map((c) => (
        <NutCay key={c.duong} nut={c} sau={sau + 1} moTM={moTM} dangTim={dangTim}
          chon={chon} onToggle={onToggle} onMo={onMo} />
      ))}
    </div>
  );
}
