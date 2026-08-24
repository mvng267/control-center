'use client';

import { useEffect, useState } from 'react';
import { Undo2, X, Loader2, FilePlus2, RotateCcw } from 'lucide-react';
import { getToken } from '@/lib/api';
import { toast } from 'sonner';

/* "Claude sửa nhầm rồi, quay lại đi" — terminal bấm `/rewind`, dashboard trước đây
   KHÔNG có gì. Phải tự `git checkout` qua một phiên Claude khác; trên điện thoại là
   bế tắc thật sự.

   Server chụp ảnh (`git stash create`) trước MỖI lượt nhắn. Khôi phục đưa file về nội
   dung lúc chụp.

   KHÔNG tự xoá file Claude tạo mới. `git checkout <ảnh> -- .` chỉ ghi đè file có
   trong ảnh — file sinh sau git không đụng tới vì nó không biết ta muốn xoá hay giữ.
   Xoá hộ thì là xoá thứ người dùng chưa nhìn thấy, nên chỉ LIỆT KÊ ra. */

interface Xem {
  ok: boolean; luc?: number; cwd?: string;
  veCu?: string[]; moiTao?: string[]; error?: string;
}

function gio(ms?: number) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function QuayLai({ sid, onClose }: { sid: string; onClose: () => void }) {
  const [xem, setXem] = useState<Xem | null>(null);
  const [dangLam, setDangLam] = useState(false);
  const [xong, setXong] = useState<{ veCu: string[]; moiTao: string[] } | null>(null);

  useEffect(() => {
    let song = true;
    fetch('/api/quaylai/' + sid, { headers: { ...(getToken() ? { 'X-Dash-Token': getToken() } : {}) } })
      .then((r) => r.json())
      .then((j) => { if (song) setXem(j); })
      .catch(() => { if (song) setXem({ ok: false, error: 'không gọi được server' }); });
    return () => { song = false; };
  }, [sid]);

  const lam = async () => {
    setDangLam(true);
    try {
      const r = await fetch('/api/quaylai/' + sid, {
        method: 'POST',
        headers: { ...(getToken() ? { 'X-Dash-Token': getToken() } : {}) },
      }).then((x) => x.json());
      if (r.ok) {
        setXong({ veCu: r.veCu || [], moiTao: r.moiTao || [] });
        toast.success(`Đã đưa ${(r.veCu || []).length} file về nội dung cũ`);
        navigator.vibrate?.(12);
      } else {
        toast.error(r.error || 'Không khôi phục được');
      }
    } catch {
      toast.error('Lỗi mạng');
    } finally { setDangLam(false); }
  };

  const dangTai = xem === null;

  return (
    <div className="fixed inset-0 z-[135] flex flex-col bg-background" data-testid="quay-lai">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <Undo2 className="size-4 shrink-0 text-status-run" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">Quay lại lượt trước</span>
          {!!xem?.luc && (
            <span className="block truncate text-[12px] text-muted-foreground">
              về trạng thái lúc {gio(xem.luc)}
            </span>
          )}
        </span>
        <button onClick={onClose} data-testid="ql-dong" title="Đóng" aria-label="Đóng"
          className="tap44 relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-border">
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {dangTai && (
          <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> đang xem có gì đổi…
          </div>
        )}

        {!dangTai && !xem.ok && (
          <div className="rounded-[10px] border border-status-run/30 bg-status-run/[0.07] p-3 text-[14px]"
            data-testid="ql-loi">
            {xem.error === 'chưa có ảnh chụp nào cho phiên này'
              ? 'Chưa có mốc nào để quay lại — mốc được chụp trước mỗi lượt bạn nhắn, và chỉ có với phiên nằm trong repo git.'
              : xem.error || 'Không đọc được.'}
          </div>
        )}

        {!dangTai && xem.ok && !xong && (
          <div className="flex flex-col gap-3">
            {!xem.veCu?.length && !xem.moiTao?.length && (
              <div className="rounded-[10px] border border-status-ok/30 bg-status-ok/[0.07] p-3 text-[14px] text-status-ok"
                data-testid="ql-khong-doi">
                Không có gì đổi từ lượt trước.
              </div>
            )}

            {!!xem.veCu?.length && (
              <div data-testid="ql-ve-cu">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground">
                  <RotateCcw className="size-3" /> {xem.veCu.length} file sẽ về nội dung cũ
                </div>
                <div className="flex flex-col gap-0.5 font-mono text-[12px]">
                  {xem.veCu.map((f) => <span key={f} className="truncate">{f}</span>)}
                </div>
              </div>
            )}

            {!!xem.moiTao?.length && (
              <div data-testid="ql-moi-tao"
                className="rounded-[10px] border border-status-run/30 bg-status-run/[0.06] p-2.5">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-status-run">
                  <FilePlus2 className="size-3" /> {xem.moiTao.length} file Claude TẠO MỚI — giữ nguyên
                </div>
                <div className="flex flex-col gap-0.5 font-mono text-[12px]">
                  {xem.moiTao.map((f) => <span key={f} className="truncate">{f}</span>)}
                </div>
                <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
                  Khôi phục KHÔNG xoá chúng. Muốn bỏ thì tự xoá — như vậy bạn luôn nhìn
                  thấy trước khi mất file.
                </p>
              </div>
            )}
          </div>
        )}

        {xong && (
          <div className="flex flex-col gap-2" data-testid="ql-xong">
            <div className="rounded-[10px] border border-status-ok/30 bg-status-ok/[0.07] p-3 text-[14px] text-status-ok">
              Đã đưa {xong.veCu.length} file về nội dung lúc {gio(xem?.luc)}.
            </div>
            {!!xong.moiTao.length && (
              <div className="rounded-[10px] border border-status-run/30 bg-status-run/[0.06] p-2.5 text-[12px]">
                Còn {xong.moiTao.length} file Claude tạo mới, chưa xoá:
                <div className="mt-1 flex flex-col gap-0.5 font-mono">
                  {xong.moiTao.map((f) => <span key={f} className="truncate">{f}</span>)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!dangTai && xem.ok && !xong && !!xem.veCu?.length && (
        <button onClick={lam} disabled={dangLam} data-testid="ql-lam"
          className="tap44 relative m-3 flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-status-run px-3 py-2.5 text-[14px] font-medium text-background disabled:opacity-50">
          {dangLam ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
          Đưa {xem.veCu.length} file về nội dung cũ
        </button>
      )}
    </div>
  );
}
