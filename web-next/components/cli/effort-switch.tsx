'use client';

import { useEffect, useState } from 'react';
import { Gauge, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* Mức suy nghĩ (--effort của Claude CLI). Dashboard trước đây KHÔNG truyền cờ này,
   nên mọi task giao từ app đều chạy mức mặc định — dù trên terminal có đổi gì đi nữa.
   Đây là chế độ điều khiển ảnh hưởng nhiều nhất tới chất lượng câu trả lời, đứng
   sau model. */

export const EFFORTS = [
  { id: '', label: 'Tự động', desc: 'Để Claude tự chọn theo độ khó của việc' },
  { id: 'low', label: 'Thấp', desc: 'Nhanh, hợp việc đơn giản, tốn ít token' },
  { id: 'medium', label: 'Vừa', desc: 'Cân bằng giữa nhanh và kỹ' },
  { id: 'high', label: 'Cao', desc: 'Nghĩ kỹ hơn, hợp việc cần suy luận' },
  { id: 'xhigh', label: 'Rất cao', desc: 'Rất kỹ, chậm và tốn token' },
  { id: 'max', label: 'Tối đa', desc: 'Kỹ nhất có thể — chậm nhất, tốn nhất' },
] as const;

export function effortOf(id?: string) {
  return EFFORTS.find((e) => e.id === (id || '')) || EFFORTS[0];
}

export function EffortSwitch({ effort, compact }: { effort?: string; compact?: boolean }) {
  const [muc, setMuc] = useState(effort || '');

  // Server là nguồn thật — SSE đẩy về, đồng bộ khi đổi ở tab/thiết bị khác
  useEffect(() => { setMuc(effort || ''); }, [effort]);

  const chon = async (id: string) => {
    const truoc = muc;
    setMuc(id);
    try {
      await api('/api/effort', { method: 'POST', body: JSON.stringify({ effort: id }) });
      toast(effortOf(id).desc);
      navigator.vibrate?.(10);
    } catch {
      setMuc(truoc);
      toast.error('Không đổi được mức suy nghĩ');
    }
  };

  const cur = effortOf(muc);

  return (
    <DropdownMenu>
      {/* compact = trong dòng trạng thái dưới ô gõ — xem chú thích ở perm-switch */}
      <DropdownMenuTrigger
        render={
          <Button variant={compact ? 'ghost' : 'outline'} size="sm" data-testid="effort-btn"
            data-effort={muc || 'auto'}
            title={'Mức suy nghĩ: ' + cur.label + ' — ' + cur.desc}
            className={cn('tap44 shrink-0 gap-1.5', muc && 'text-tool-accent',
              compact
                ? 'h-auto px-1 py-0 font-mono text-[10.5px] font-normal hover:bg-transparent hover:underline'
                : 'h-8 text-[12px]')}>
            <Gauge className={compact ? 'size-3' : 'size-3.5'} />
            <span className="max-w-[74px] truncate">{cur.label}</span>
          </Button>
        } />
      <DropdownMenuContent align="end" className="w-[260px]">
        {EFFORTS.map((e) => (
          <DropdownMenuItem key={e.id || 'auto'} onClick={() => chon(e.id)}
            data-testid={'effort-' + (e.id || 'auto')} className="items-start gap-2 py-2">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                {e.label}
                {e.id && <code className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{e.id}</code>}
                {muc === e.id && <Check className="size-3.5 text-primary" />}
              </span>
              <span className="text-[11.5px] leading-snug text-muted-foreground">{e.desc}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
