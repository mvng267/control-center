'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Loader2, Check, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* Nút tự cập nhật dashboard, đặt ở chân sidebar cạnh nút khoá.
   Server tự nhận ra cài kiểu gì (npm -g hay clone git) rồi chạy đúng lệnh — người bấm
   không phải nhớ máy nào cài kiểu nào, mà đó chính là thứ hay quên nhất khi có hai
   máy (Mac clone git, Debian cài npm chẳng hạn). */

interface TrangThai {
  ok: boolean;
  kieu: 'npm' | 'git';
  banHienTai: string;
  thuMuc: string;
  git?: { ma: string; tin: string; sach: boolean } | null;
}

interface KetQua {
  ok?: boolean; error?: string; ra?: string; kieu?: string; canKhoiDongLai?: boolean;
}

export function NutCapNhat() {
  const [st, setSt] = useState<TrangThai | null>(null);
  const [chay, setChay] = useState(false);
  const [xong, setXong] = useState<KetQua | null>(null);

  useEffect(() => {
    api<TrangThai>('/api/capnhat/trangthai').then(setSt).catch(() => {});
  }, []);

  const capNhat = async () => {
    if (chay) return;
    setChay(true); setXong(null);
    try {
      const r = await api<KetQua>('/api/capnhat/chay', { method: 'POST', body: '{}' });
      setXong(r);
      if (r.ok) {
        navigator.vibrate?.(12);
        toast.success(r.canKhoiDongLai
          ? 'Đã tải bản mới — khởi động lại server để dùng'
          : 'Đang ở bản mới nhất rồi');
      } else {
        toast.error(r.error?.slice(0, 120) || 'Không cập nhật được');
      }
    } catch {
      setXong({ ok: false, error: 'Lỗi mạng' });
      toast.error('Lỗi mạng');
    } finally { setChay(false); }
  };

  if (!st?.ok) return null;

  /* Cây git bẩn thì báo TRƯỚC khi bấm, không để bấm xong mới biết. Trên điện thoại
     không nhìn thấy terminal nên lỗi hiện sau khi bấm rất dễ bị bỏ qua. */
  const ban = st.kieu === 'git' && st.git && !st.git.sach;

  return (
    <div className="flex flex-col gap-1">
      <button onClick={capNhat} disabled={chay || !!ban} data-testid="nut-cap-nhat"
        title={ban ? 'Có thay đổi chưa commit — không cập nhật tự động được'
          : st.kieu === 'npm' ? 'npm i -g claude-control-center@latest'
            : `git pull trong ${st.thuMuc}`}
        className={cn('tap44 flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[14px] transition-colors',
          ban ? 'cursor-not-allowed text-muted-foreground/50'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground')}>
        {chay ? <Loader2 className="size-4 shrink-0 animate-spin" />
          : ban ? <TriangleAlert className="size-4 shrink-0" />
            : xong?.ok ? <Check className="size-4 shrink-0 text-status-ok" />
              : <RefreshCw className="size-4 shrink-0" />}
        <span className="truncate">{chay ? 'Đang cập nhật…' : 'Cập nhật'}</span>
        {/* Cho biết đang chạy bản nào và cài kiểu gì — bấm nút mà không biết mình
            đang ở đâu thì không đoán được nó sẽ làm gì. */}
        <span className="shrink-0 font-mono text-[10.5px] opacity-60" data-testid="cap-nhat-ban">
          {st.kieu === 'git' ? st.git?.ma : 'v' + st.banHienTai}
        </span>
      </button>

      {ban && (
        <p className="px-2.5 text-[10.5px] leading-relaxed text-muted-foreground/70" data-testid="cap-nhat-ban-nhap">
          Có sửa chưa commit trong thư mục mã — commit hoặc bỏ đi rồi mới cập nhật được.
        </p>
      )}

      {xong && !xong.ok && (
        <p className="px-2.5 text-[10.5px] leading-relaxed text-status-error" data-testid="cap-nhat-loi">
          {xong.error?.slice(0, 180)}
        </p>
      )}
      {xong?.ok && xong.canKhoiDongLai && (
        <p className="px-2.5 text-[10.5px] leading-relaxed text-muted-foreground" data-testid="cap-nhat-xong">
          Đã tải bản mới. Khởi động lại server để dùng.
        </p>
      )}
    </div>
  );
}
