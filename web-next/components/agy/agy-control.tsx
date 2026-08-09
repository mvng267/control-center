'use client';

import { useEffect, useState } from 'react';
import {
  BellRing, RefreshCw, Stethoscope, Shuffle, Loader2, TriangleAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

/* Điều khiển agy-proxy — chỉ 4 lệnh mà tài liệu bàn giao xác nhận ĐẢO NGƯỢC ĐƯỢC.
   Server có bảng cứng riêng nên kể cả sửa file này cũng không gọi được lệnh khác.

   Cố ý KHÔNG có: tắt gateway, tạo lại API key, quét sức khoẻ cả pool (~14 phút và
   bị nhà cung cấp chặn tốc độ), xoá account. Đó là nhóm tài liệu cảnh báo có thể
   làm chết mọi client đang chạy hoặc mất dữ liệu. */

const ROTATIONS = [
  { id: 'round-robin', label: 'Lần lượt' },
  { id: 'smart', label: 'Thông minh' },
  { id: 'full-first', label: 'Đầy trước' },
  { id: 'failover', label: 'Dự phòng' },
  { id: 'highest-first', label: 'Cao nhất' },
] as const;

export function AgyControl({ rotation, onDone }: { rotation?: string; onDone?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [hoi, setHoi] = useState<null | { id: string; tieuDe: string; noi: string; lam: () => void }>(null);
  const [xoay, setXoay] = useState(rotation || 'round-robin');

  // Chiến lược hiện tại KHÔNG có trong /api/agy/status (đọc SQLite), phải hỏi API.
  // Không lấy được thì giữ mặc định — nút vẫn bấm được, chỉ là chưa tô đúng ô.
  useEffect(() => {
    if (rotation) return;
    api<{ ok: boolean; rotation?: string }>('/api/agy/rotation')
      .then((r) => { if (r.ok && r.rotation) setXoay(r.rotation); })
      .catch(() => {});
  }, [rotation]);

  const goi = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const r = await api<{ ok: boolean; error?: string; woken?: number; queued?: number; status?: string }>(
        '/api/agy/control', { method: 'POST', body: JSON.stringify({ action, ...extra }) });
      if (!r.ok) { toast.error(r.error || 'Không thực hiện được'); return null; }
      navigator.vibrate?.(12);
      onDone?.();
      return r;
    } catch { toast.error('Lỗi mạng'); return null; }
    finally { setBusy(null); }
  };

  const goCooldown = () => setHoi({
    id: 'wake',
    tieuDe: 'Gỡ cooldown cho toàn bộ account?',
    noi: 'Account đang nghỉ vì hết hạn mức hoặc bị chặn tốc độ sẽ được nhận request lại ngay. '
      + 'Đảo ngược được — nếu vẫn hết hạn mức thì chúng tự nghỉ lại.',
    lam: async () => {
      const r = await goi('wake');
      if (r) toast.success(`Đã gỡ cooldown cho ${r.woken ?? 0} account`);
    },
  });

  const napQuota = () => setHoi({
    id: 'quota-refresh',
    tieuDe: 'Nạp lại hạn mức từ nhà cung cấp?',
    noi: 'Chạy nền, giãn nhịp để không bị chặn tốc độ — với 350 account mất khoảng 2–3 phút. '
      + 'Chỉ đọc, không đổi gì.',
    lam: async () => {
      const r = await goi('quota-refresh');
      if (r) toast.success(`Đang nạp lại hạn mức cho ${r.queued ?? '?'} account`);
    },
  });

  const doiXoay = (v: string) => setHoi({
    id: 'set-rotation',
    tieuDe: 'Đổi chiến lược xoay account?',
    noi: `Chuyển sang "${ROTATIONS.find((x) => x.id === v)?.label || v}". Ảnh hưởng cách chọn `
      + 'account cho mọi request tiếp theo. Đổi lại lúc nào cũng được.',
    lam: async () => {
      const r = await goi('set-rotation', { rotation: v });
      if (r) { setXoay(v); toast.success('Đã đổi chiến lược xoay'); }
    },
  });

  const kiemTra = async () => {
    const e = email.trim();
    if (!e) return toast.error('Nhập email account cần kiểm');
    const r = await goi('checklive', { email: e });
    if (r) toast.success(`${e}: ${r.status === 'ok' ? 'còn sống' : r.status === 'quota' ? 'hết hạn mức' : r.status || 'không rõ'}`);
  };

  return (
    <Card className="gap-0 p-4" data-testid="agy-control">
      <div className="mb-1 flex items-center gap-2">
        <Shuffle className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-semibold">Điều khiển</span>
      </div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-muted-foreground">
        Chỉ những lệnh đảo ngược được. Tắt gateway, tạo lại API key và xoá account
        cố ý không có ở đây.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="tap44 h-8 text-[12px]"
          disabled={!!busy} onClick={goCooldown} data-testid="ctl-wake">
          {busy === 'wake' ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />}
          Gỡ cooldown
        </Button>
        <Button variant="outline" size="sm" className="tap44 h-8 text-[12px]"
          disabled={!!busy} onClick={napQuota} data-testid="ctl-quota">
          {busy === 'quota-refresh' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Nạp lại hạn mức
        </Button>
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <span className="text-[12px] font-medium">Chiến lược xoay account</span>
        {/* agy có thể trả chiến lược không nằm trong danh sách (bản mới thêm kiểu
            mới) — ép kiểu bừa thì không ô nào sáng, nhìn như hỏng. Nói thẳng ra. */}
        <Segmented items={ROTATIONS}
          value={(ROTATIONS.some((x) => x.id === xoay) ? xoay : 'round-robin') as (typeof ROTATIONS)[number]['id']}
          onChange={doiXoay} testid="ctl-rotation" size="sm" className="self-start" />
        {!ROTATIONS.some((x) => x.id === xoay) && (
          <span className="text-[11px] text-amber-500">
            agy đang dùng “{xoay}” — chiến lược này chưa có trong danh sách
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <span className="text-[12px] font-medium">Kiểm tra một account</span>
        <div className="flex items-center gap-2">
          <Input value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && kiemTra()}
            placeholder="email@example.com" data-testid="ctl-email"
            className="h-8 flex-1 text-[16px] md:text-[12.5px]" />
          <Button variant="outline" size="sm" className="tap44 h-8 shrink-0 text-[12px]"
            disabled={!!busy || !email.trim()} onClick={kiemTra} data-testid="ctl-checklive">
            {busy === 'checklive' ? <Loader2 className="size-3.5 animate-spin" /> : <Stethoscope className="size-3.5" />}
            Kiểm tra
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Chỉ kiểm được từng account. Quét cả pool mất ~14 phút và bị nhà cung cấp
          chặn tốc độ nên không mở.
        </p>
      </div>

      {hoi && (
        <Dialog open onOpenChange={() => setHoi(null)}>
          <DialogContent className="max-w-[420px]" data-testid="ctl-dialog">
            <DialogHeader><DialogTitle>{hoi.tieuDe}</DialogTitle></DialogHeader>
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-[2px] size-4 shrink-0 text-amber-500" />
              <p className="text-[13px] leading-relaxed text-muted-foreground">{hoi.noi}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setHoi(null)}>Hủy</Button>
              <Button size="sm" data-testid="ctl-ok"
                onClick={() => { const f = hoi.lam; setHoi(null); f(); }}>
                Đồng ý
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
