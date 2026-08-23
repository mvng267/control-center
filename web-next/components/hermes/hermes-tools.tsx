'use client';

import { useState } from 'react';
import {
  Activity, Stethoscope, History, Sparkles, Brain, CalendarClock, Cpu,
  Wrench, Plug, BarChart3, Tag, SlidersHorizontal, Loader2, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getToken } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* 12 lệnh đọc của Hermes CLI — cùng danh sách whitelist ở server (HERMES_SAFE).
   Trước đây tab Hermes CHỈ chat được; muốn xem trạng thái hay chẩn đoán thì phải nhớ
   mở bảng lệnh ⌘K. Bày thành nút để nhìn là thấy Hermes làm được gì.

   Hermes có 70+ lệnh con; server chỉ mở nhóm ĐỌC. Nhóm cần terminal tương tác
   (setup, login) hoặc đổi cấu hình máy cố ý không có. */

/* `id` là khoá GIAO DIỆN (key React + nút nào đang chạy), `cmd`+`args` mới là thứ
   gửi xuống server. Phải tách vì nút "Model" nay gọi `config get model` — để id là
   'config' thì trùng khoá với nút "Cấu hình", bấm một cái sáng cả hai.

   Bốn lệnh gọi TRẦN là hỏng: `tools` và `model` báo "requires an interactive
   terminal", `sessions` và `skills` chỉ in usage. Biến thể có subcommand thì chạy
   ngoài TTY bình thường — đã chạy thật cả bốn. Server nhận `args` từ lâu
   (index.js:3198), chỉ là chỗ này chưa gửi. */
interface Lenh { id: string; nhan: string; mo: string; icon: LucideIcon; cmd?: string; args?: string[] }

const LENH: Lenh[] = [
  { id: 'status', nhan: 'Trạng thái', mo: 'Toàn bộ thành phần đang chạy thế nào', icon: Activity },
  { id: 'doctor', nhan: 'Chẩn đoán', mo: 'Tìm sự cố cấu hình', icon: Stethoscope },
  { id: 'sessions', nhan: 'Phiên', mo: 'Lịch sử hội thoại', icon: History, args: ['list'] },
  { id: 'skills', nhan: 'Skill', mo: 'Skill đang cài', icon: Sparkles, args: ['list'] },
  { id: 'memory', nhan: 'Bộ nhớ', mo: 'Cấu hình bộ nhớ ngoài', icon: Brain },
  { id: 'cron', nhan: 'Hẹn giờ', mo: 'Cron job của agent', icon: CalendarClock },
  { id: 'model', nhan: 'Model', mo: 'Model và provider mặc định', icon: Cpu, cmd: 'config', args: ['get', 'model'] },
  { id: 'tools', nhan: 'Tool', mo: 'Tool bật/tắt theo nền tảng', icon: Wrench, args: ['list'] },
  { id: 'mcp', nhan: 'MCP', mo: 'MCP server đã nối', icon: Plug },
  { id: 'insights', nhan: 'Thống kê', mo: 'Số liệu sử dụng', icon: BarChart3 },
  { id: 'version', nhan: 'Phiên bản', mo: 'Hermes đang chạy bản nào', icon: Tag },
  { id: 'config', nhan: 'Cấu hình', mo: 'Cấu hình hiện tại', icon: SlidersHorizontal },
];

export function HermesTools({ onClose }: { onClose: () => void }) {
  const [dangChay, setDangChay] = useState<string | null>(null);
  const [kq, setKq] = useState<{ nhan: string; noi: string } | null>(null);

  const chay = async (l: Lenh) => {
    setDangChay(l.id);
    setKq({ nhan: l.nhan, noi: '' });
    try {
      // fetch trực tiếp: api() NÉM khi gặp HTTP 4xx/5xx, nên nhánh hiện lỗi có cấu
      // trúc bên dưới sẽ không bao giờ chạy tới và người dùng chỉ thấy toast chung chung.
      const res = await fetch('/api/hermes/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(getToken() ? { 'X-Dash-Token': getToken() } : {}) },
        body: JSON.stringify({ cmd: l.cmd || l.id, args: l.args || [] }),
      });
      const r = await res.json().catch(() => ({}));
      setKq({ nhan: l.nhan, noi: (res.ok && r.ok) ? (r.output || '(không có kết quả)') : 'Lỗi: ' + (r.error || 'HTTP ' + res.status) });
      if (res.ok && r.ok) navigator.vibrate?.(10);
    } catch {
      setKq({ nhan: l.nhan, noi: 'Lỗi: không gọi được server' });
    } finally { setDangChay(null); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85dvh] max-w-[640px] overflow-hidden" data-testid="hermes-tools">
        <DialogHeader><DialogTitle>Công cụ Hermes</DialogTitle></DialogHeader>

        {!kq ? (
          <>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Các lệnh chỉ ĐỌC, chạy được ngay. Lệnh cần terminal tương tác
              (đăng nhập, cài đặt) không có ở đây.
            </p>
            <div className="grid max-h-[62dvh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {LENH.map((l) => (
                <button key={l.id} onClick={() => chay(l)} disabled={!!dangChay}
                  data-testid={'ht-' + l.id}
                  className={cn(
                    'tap44 flex flex-col items-start gap-1 rounded-[10px] border border-border bg-card px-3 py-2.5 text-left transition-colors',
                    dangChay ? 'opacity-50' : 'hover:bg-accent/50',
                  )}>
                  <span className="flex items-center gap-1.5">
                    {dangChay === l.id
                      ? <Loader2 className="size-3.5 animate-spin text-primary" />
                      : <l.icon className="size-3.5 text-tool-accent" />}
                    <span className="text-[14px] font-medium">{l.nhan}</span>
                  </span>
                  <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{l.mo}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold">{kq.nhan}</span>
              <Button variant="ghost" size="sm" className="tap44 ml-auto h-7 text-[12px]"
                onClick={() => setKq(null)} data-testid="ht-back">
                <X className="size-3.5" /> Chọn lệnh khác
              </Button>
            </div>
            {kq.noi ? (
              <pre data-testid="ht-output"
                className="max-h-[62dvh] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-background/60 p-3 font-mono text-[12px] leading-relaxed">
                {kq.noi}
              </pre>
            ) : (
              <div className="flex items-center gap-2 py-6 text-[14px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" /> Đang chạy…
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
