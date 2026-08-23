'use client';

import { useState } from 'react';
import { Plug, Package, Stethoscope, Users, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getToken } from '@/lib/api';
import { cn } from '@/lib/utils';

/* Xem môi trường Claude CLI: MCP server, plugin, chẩn đoán, phiên đang chạy.

   Vì sao ở màn cấu hình chứ KHÔNG phải tab riêng: thanh tab dưới trên iPhone 390px
   đang có 6 tab, mỗi tab 65px. Thêm hai tab nữa là 48px/tab — dưới ngưỡng chạm 44px
   cộng khoảng cách, bấm sẽ trượt sang tab bên. Đây lại là thứ liếc thỉnh thoảng,
   không phải chỗ làm việc hằng ngày.

   Bốn lệnh đều là LỆNH CON của CLI (`claude mcp list`), không phải lệnh slash —
   nhiều thứ chỉ có ở dạng này. Bảng tra cứng nằm ở server (CLAUDE_SUB). */

interface Muc { id: string; nhan: string; mo: string; icon: LucideIcon }

const MUC: Muc[] = [
  { id: 'mcp', nhan: 'MCP server', mo: 'Server đã nối và trạng thái từng cái', icon: Plug },
  { id: 'plugin', nhan: 'Plugin', mo: 'Plugin đang cài, nguồn và trạng thái', icon: Package },
  { id: 'agents', nhan: 'Phiên đang chạy', mo: 'Cả phiên mở từ terminal, không chỉ từ dashboard', icon: Users },
  { id: 'doctor', nhan: 'Chẩn đoán', mo: 'Kiểm tra cài đặt — đủ 10 mục', icon: Stethoscope },
];

export function MoiTruong() {
  const [dangChay, setDangChay] = useState<string | null>(null);
  const [kq, setKq] = useState<{ nhan: string; noi: string } | null>(null);

  const chay = async (m: Muc) => {
    setDangChay(m.id);
    setKq({ nhan: m.nhan, noi: '' });
    try {
      // fetch trần chứ không dùng api(): api() NÉM khi gặp 4xx/5xx nên nhánh hiện lỗi
      // có cấu trúc bên dưới sẽ không bao giờ chạy tới.
      const res = await fetch('/api/claude/sub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(getToken() ? { 'X-Dash-Token': getToken() } : {}) },
        body: JSON.stringify({ cmd: m.id }),
      });
      const r = await res.json().catch(() => ({}));
      setKq({
        nhan: m.nhan,
        noi: (res.ok && r.ok) ? (r.output || '(không có kết quả)')
          : 'Lỗi: ' + (r.error || 'HTTP ' + res.status),
      });
    } catch {
      setKq({ nhan: m.nhan, noi: 'Lỗi: không gọi được server' });
    } finally { setDangChay(null); }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {MUC.map((m) => (
          <button key={m.id} onClick={() => chay(m)} disabled={!!dangChay}
            data-testid={'mt-' + m.id}
            className={cn(
              'tap44 flex flex-col items-start gap-1 rounded-[10px] border border-border bg-card px-3 py-2.5 text-left transition-colors',
              dangChay ? 'opacity-50' : 'hover:bg-accent/50',
            )}>
            <span className="flex items-center gap-1.5">
              {dangChay === m.id
                ? <Loader2 className="size-3.5 animate-spin text-primary" />
                : <m.icon className="size-3.5 text-tool-accent" />}
              <span className="text-[14px] font-medium">{m.nhan}</span>
            </span>
            <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{m.mo}</span>
          </button>
        ))}
      </div>

      {kq && (
        <div className="rounded-[10px] border border-border bg-card" data-testid="mt-ket-qua">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="flex-1 truncate text-[12px] font-medium">{kq.nhan}</span>
            <button onClick={() => setKq(null)} className="tap44 text-[12px] text-muted-foreground hover:text-foreground">
              đóng
            </button>
          </div>
          <pre className="max-h-[40dvh] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[12px] leading-relaxed">
            {kq.noi || 'đang chạy…'}
          </pre>
        </div>
      )}
    </div>
  );
}
