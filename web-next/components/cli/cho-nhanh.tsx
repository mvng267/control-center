'use client';

import { useState } from 'react';
import { ClipboardList, CircleHelp, Check, Loader2, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Session } from '@/lib/types';

/* Duyệt kế hoạch / trả lời câu hỏi NGAY TRÊN THẺ PHIÊN, không phải mở phiên ra.

   Vì sao cần: dùng dashboard trên điện thoại chủ yếu là để TRỰC phiên đang chạy —
   liếc xem cái nào đứng chờ rồi bấm cho nó đi tiếp. Trước đây thẻ chỉ hiện dải
   "Đang chờ duyệt kế hoạch", muốn bấm phải mở phiên, đọc, cuộn xuống cuối, rồi bấm.
   Bốn thao tác cho một cái bấm.

   Endpoint đã có sẵn cả hai:
     duyệt kế hoạch -> POST /api/approve/:sid  (server tự ép --permission-mode acceptEdits)
     trả lời câu hỏi -> POST /api/chat/:sid    (Claude nhận như tin nhắn thường)

   KHÔNG có nút "Từ chối": từ chối một kế hoạch là việc cần viết lý do, mà gõ lý do
   trên thẻ phiên thì chật. Bấm "Mở xem" rồi từ chối trong khung chat. */

export function ChoNhanh({ s, onMo }: { s: Session; onMo: () => void }) {
  const nd = s.choND;
  const [dangGui, setDangGui] = useState(false);
  const [xong, setXong] = useState(false);
  const [chon, setChon] = useState<Set<number>>(new Set());

  if (!nd || xong) return null;

  const duyet = async () => {
    setDangGui(true);
    try {
      await api('/api/approve/' + s.sid, { method: 'POST', body: JSON.stringify({}) });
      setXong(true);
      toast.success('Đã duyệt — Claude làm tiếp');
      navigator.vibrate?.(12);
    } catch {
      toast.error('Không duyệt được');
      setDangGui(false);
    }
  };

  const traLoi = async () => {
    const q = nd.hoi;
    if (!q || !chon.size) return;
    setDangGui(true);
    try {
      // Ghép đúng khuôn ask-card dùng trong khung chat, để Claude đọc ra cùng một kiểu
      const ten = [...chon].map((i) => q.chon[i]?.nhan).filter(Boolean);
      const cau = `${q.nhan || q.hoi}: ${ten.join(', ')}`;
      await api('/api/chat/' + s.sid, { method: 'POST', body: JSON.stringify({ message: cau }) });
      setXong(true);
      toast.success('Đã gửi lựa chọn');
      navigator.vibrate?.(12);
    } catch {
      toast.error('Không gửi được');
      setDangGui(false);
    }
  };

  // ---- kế hoạch chờ duyệt ----
  if (nd.cho === 'ke-hoach') {
    return (
      <div data-testid="cho-nhanh" data-loai="ke-hoach"
        className="ml-4 flex flex-col gap-1.5 rounded-md border border-primary/35 bg-primary/[0.08] px-2 py-1.5">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
          <ClipboardList className="size-3 shrink-0" /> Đang chờ duyệt kế hoạch
        </span>
        {nd.tomTat && (
          <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground">{nd.tomTat}</span>
        )}
        <div className="flex gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); duyet(); }} disabled={dangGui}
            data-testid="cho-duyet"
            className="tap44 flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-2 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-50">
            {dangGui ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Duyệt
          </button>
          <button onClick={(e) => { e.stopPropagation(); onMo(); }}
            data-testid="cho-mo"
            className="tap44 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px]">
            Mở xem <ChevronRight className="size-3" />
          </button>
        </div>
      </div>
    );
  }

  // ---- Claude hỏi, chọn phương án ----
  const q = nd.hoi;
  if (!q) return null;
  return (
    <div data-testid="cho-nhanh" data-loai="cau-hoi"
      className="ml-4 flex flex-col gap-1.5 rounded-md border border-primary/35 bg-primary/[0.08] px-2 py-1.5">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-primary">
        <CircleHelp className="size-3 shrink-0" /> Claude đang hỏi
      </span>
      <span className="line-clamp-2 text-[12px] leading-snug">{q.hoi}</span>
      <div className="flex flex-wrap gap-1">
        {q.chon.map((o, i) => (
          <button key={i} data-testid={'cho-chon-' + i}
            onClick={(e) => {
              e.stopPropagation();
              setChon((cu) => {
                // nhieu = chọn nhiều; ngược lại bấm cái nào thì chỉ còn cái đó
                if (!q.nhieu) return new Set([i]);
                const moi = new Set(cu);
                if (moi.has(i)) moi.delete(i); else moi.add(i);
                return moi;
              });
            }}
            className={cn('tap44 rounded-md border px-2 py-1 text-[12px] transition-colors',
              chon.has(i) ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:bg-accent/50')}>
            {o.nhan}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <button onClick={(e) => { e.stopPropagation(); traLoi(); }} disabled={dangGui || !chon.size}
          data-testid="cho-gui"
          className="tap44 flex flex-1 items-center justify-center gap-1 rounded-md bg-primary px-2 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-50">
          {dangGui ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Gửi
        </button>
        <button onClick={(e) => { e.stopPropagation(); onMo(); }}
          data-testid="cho-mo"
          className="tap44 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px]">
          {q.them > 0 ? `Còn ${q.them} câu` : 'Mở xem'} <ChevronRight className="size-3" />
        </button>
      </div>
    </div>
  );
}
