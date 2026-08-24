'use client';

import { useEffect, useState } from 'react';
import { GitCompare, X, Loader2, ChevronDown } from 'lucide-react';
import { getToken } from '@/lib/api';
import { cn } from '@/lib/utils';

/* "Claude vừa đổi gì?" — câu hỏi số một khi mở dashboard trên điện thoại.

   Terminal có `/diff` ngay, nhưng CLI CHẶN lệnh đó ở chế độ `-p` (đã chạy thử:
   "isn't available in this environment"). Trước đây muốn biết phải nhờ chính Claude
   chạy `git diff` — tốn một lượt, tốn tiền, mà trả về văn xuôi chứ không phải patch.

   Mặc định hiện `--stat` (mỗi file một dòng): bản đầy đủ có thể vài nghìn dòng, mở
   trên điện thoại là cuộn mãi không tới đâu. Bấm "Xem từng dòng" mới tải bản đầy đủ. */

interface KetQua {
  ok: boolean; laGit?: boolean; cwd?: string; diff?: string; sach?: boolean; error?: string;
}

export function XemDiff({ sid, onClose }: { sid: string; onClose: () => void }) {
  const [day, setDay] = useState(false);
  /* Lưu kèm KHOÁ (sid + chế độ) thay vì gọi setState reset trong effect. Đổi chế độ
     thì khoá lệch -> coi như đang tải, không cần một lượt render chỉ để xoá state.
     eslint react-hooks/set-state-in-effect bắt đúng kiểu reset đó. */
  const [kho, setKho] = useState<{ khoa: string; kq: KetQua } | null>(null);
  const khoaNay = sid + ':' + (day ? 'day' : 'stat');
  const kq = kho && kho.khoa === khoaNay ? kho.kq : null;
  const dangTai = kq === null;

  useEffect(() => {
    let song = true;
    const khoa = sid + ':' + (day ? 'day' : 'stat');
    // fetch trần chứ không api(): api() NÉM khi gặp 4xx/5xx nên nhánh hiện lỗi có cấu
    // trúc bên dưới không bao giờ chạy tới.
    fetch('/api/diff/' + sid + (day ? '?day=1' : ''), {
      headers: { ...(getToken() ? { 'X-Dash-Token': getToken() } : {}) },
    })
      .then((r) => r.json())
      .then((j) => { if (song) setKho({ khoa, kq: j }); })
      .catch(() => { if (song) setKho({ khoa, kq: { ok: false, error: 'không gọi được server' } }); });
    return () => { song = false; };
  }, [sid, day]);

  return (
    <div className="fixed inset-0 z-[130] flex flex-col bg-background" data-testid="xem-diff">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <GitCompare className="size-4 shrink-0 text-tool-accent" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">Claude đã đổi gì</span>
          {kq?.cwd && (
            <span className="block truncate text-[12px] text-muted-foreground">{kq.cwd}</span>
          )}
        </span>
        <button onClick={onClose} data-testid="diff-dong"
          title="Đóng" aria-label="Đóng"
          className="tap44 relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-border">
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {dangTai && (
          <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> đang đọc git diff…
          </div>
        )}

        {!dangTai && kq && !kq.ok && (
          <div className="rounded-[10px] border border-status-run/30 bg-status-run/[0.07] p-3 text-[14px]"
            data-testid="diff-loi">
            {kq.laGit === false
              ? 'Thư mục của phiên này không phải repo git — không so được thay đổi.'
              : kq.error || 'Không đọc được thay đổi.'}
          </div>
        )}

        {!dangTai && kq?.ok && kq.sach && (
          <div className="rounded-[10px] border border-status-ok/30 bg-status-ok/[0.07] p-3 text-[14px] text-status-ok"
            data-testid="diff-sach">
            Không có thay đổi nào chưa commit.
          </div>
        )}

        {!dangTai && kq?.ok && !kq.sach && (
          <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed"
            data-testid="diff-noi-dung">
            {day
              ? kq.diff!.split('\n').map((l, i) => (
                <span key={i} className={cn('block',
                  /^\+(?!\+\+)/.test(l) && 'bg-status-ok/[0.12] text-status-ok',
                  /^-(?!--)/.test(l) && 'bg-status-error/[0.12] text-status-error',
                  /^@@/.test(l) && 'text-tool-accent',
                  /^diff --git/.test(l) && 'mt-2 font-semibold text-foreground')}>
                  {l || ' '}
                </span>
              ))
              : kq.diff}
          </pre>
        )}
      </div>

      {!dangTai && kq?.ok && !kq.sach && !day && (
        <button onClick={() => setDay(true)} data-testid="diff-xem-day"
          className="tap44 relative m-3 flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-[14px]">
          <ChevronDown className="size-4" /> Xem từng dòng
        </button>
      )}
    </div>
  );
}
