'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ChevronRight, Copy, FileText, Folder, FolderOpen, Loader2, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* Xem file trong thư mục dự án của phiên — kiểu VSCode nhưng KHÔNG tô màu cú pháp.
   Vinh vào qua Tailscale, mà shiki nặng ~1MB, gấp đôi bundle hiện tại (1.577KB) chỉ để
   đổi lấy màu chữ. Số dòng + font monospace là đủ đọc mã.

   iPhone: một cột — cây thư mục, bấm file thì trượt sang nội dung, có nút ← quay lại.
   Desktop: hai cột — cây trái 240px, nội dung phải. */

interface Tep { ok: boolean; noiDung?: string; soDong?: number; kichThuoc?: number; laNhiPhan?: boolean; quaLon?: boolean; error?: string }
interface Cay { ok: boolean; root: string | null; files: string[]; quaRong?: boolean }

function co(n?: number) {
  if (!n) return '';
  return n < 1024 ? n + 'B' : n < 1024 * 1024 ? (n / 1024).toFixed(0) + 'KB' : (n / 1048576).toFixed(1) + 'MB';
}

/* Dựng cây từ danh sách đường dẫn phẳng server trả về ("src/server/index.js").
   Chỉ gom một mức: thư mục -> file trong đó. Cây lồng nhiều tầng trên màn 390px thụt
   lề tới mức tên file bị đẩy ra khỏi màn hình, nên gộp cả nhánh thành một khoá
   ("web-next/components/cli") và hiện tên rút gọn. */
function gomTheoThuMuc(files: string[]) {
  const nhom = new Map<string, string[]>();
  for (const f of files) {
    const i = f.lastIndexOf('/');
    const thuMuc = i < 0 ? '' : f.slice(0, i);
    const arr = nhom.get(thuMuc) || [];
    arr.push(f);
    nhom.set(thuMuc, arr);
  }
  // thư mục gốc lên đầu, còn lại theo bảng chữ cái
  return [...nhom.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])));
}

export function XemFile({ sid, onClose }: { sid: string; onClose: () => void }) {
  const [cay, setCay] = useState<Cay | null>(null);
  const [chon, setChon] = useState('');
  const [tep, setTep] = useState<Tep | null>(null);
  const [dangTai, setDangTai] = useState(false);
  const [tim, setTim] = useState('');
  const [moTM, setMoTM] = useState<Set<string>>(new Set(['']));

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

  const nhom = useMemo(() => {
    const ds = cay?.files || [];
    const q = tim.trim().toLowerCase();
    return gomTheoThuMuc(q ? ds.filter((f) => f.toLowerCase().includes(q)) : ds);
  }, [cay, tim]);

  // Đang tìm thì mở hết, không thì giữ theo lựa chọn của người dùng
  const dangTim = tim.trim().length > 0;

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

  const dong = tep?.noiDung ? tep.noiDung.split('\n') : [];

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
          <span className="block truncate text-[13px] font-semibold" data-testid="file-title">
            {chon || 'File trong dự án'}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {cay?.root || '…'}
            {tep?.soDong ? ` · ${tep.soDong} dòng · ${co(tep.kichThuoc)}` : ''}
          </span>
        </span>
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
          <div className="border-b border-border p-2">
            <Input value={tim} onChange={(e) => setTim(e.target.value)} data-testid="file-search"
              placeholder="Lọc theo tên file…" className="h-8 text-[16px] md:text-[13px]" />
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
            {nhom.map(([thuMuc, ds]) => {
              const mo = dangTim || moTM.has(thuMuc);
              return (
                <div key={thuMuc || '/'}>
                  <button onClick={() => toggleTM(thuMuc)} data-testid="file-dir"
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left hover:bg-accent">
                    <ChevronRight className={cn('size-3 shrink-0 text-muted-foreground transition-transform', mo && 'rotate-90')} />
                    {mo ? <FolderOpen className="size-3.5 shrink-0 text-tool-accent" />
                      : <Folder className="size-3.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate text-[12px] font-medium">{thuMuc || '/'}</span>
                    <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground">{ds.length}</span>
                  </button>
                  {mo && ds.map((f) => (
                    <button key={f} onClick={() => moFile(f)} data-testid="file-item" data-path={f}
                      className={cn('flex w-full items-center gap-1.5 rounded-md py-1.5 pl-7 pr-2 text-left hover:bg-accent',
                        chon === f && 'bg-accent')}>
                      <FileText className="size-3 shrink-0 text-muted-foreground" />
                      <span className="truncate text-[12px]">{f.slice(f.lastIndexOf('/') + 1)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- nội dung file ---- */}
        <div className={cn('min-h-0 min-w-0 flex-1 overflow-auto',
          chon ? 'block' : 'hidden md:block')} data-testid="file-body">
          {dangTai && <div className="flex items-center gap-2 p-4 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Đang mở…
          </div>}
          {!dangTai && !chon && (
            <p className="p-6 text-[12.5px] text-muted-foreground">Chọn một file bên trái để xem.</p>
          )}
          {!dangTai && tep?.error && (
            <p className="p-4 text-[12.5px] text-status-error" data-testid="file-error">{tep.error}</p>
          )}
          {!dangTai && tep?.quaLon && (
            <p className="p-4 text-[12.5px] text-muted-foreground">
              File {co(tep.kichThuoc)} — quá lớn để mở trên trình duyệt (trần 512KB).
            </p>
          )}
          {!dangTai && tep?.laNhiPhan && (
            <p className="p-4 text-[12.5px] text-muted-foreground">
              File nhị phân ({co(tep.kichThuoc)}) — không hiển thị được dạng chữ.
            </p>
          )}
          {!dangTai && tep?.noiDung !== undefined && (
            /* Số dòng trong cột riêng có min-width cố định: để chung một chuỗi với nội
               dung thì cuộn ngang làm số dòng trôi mất khỏi màn hình. */
            <div className="flex font-mono text-[11.5px] leading-[1.55]">
              <div className="sticky left-0 shrink-0 select-none border-r border-border bg-muted/40 px-2 py-2 text-right text-muted-foreground">
                {dong.map((_, i) => <div key={i}>{i + 1}</div>)}
              </div>
              <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre px-3 py-2" data-testid="file-content">
                {tep.noiDung}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
