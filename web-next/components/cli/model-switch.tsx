'use client';

import { useEffect, useState } from 'react';
import { Cpu, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* Chọn model (--model của Claude CLI).

   Trước đây việc này chỉ nằm trong menu ⋯ của khung chat: giao task mới thì KHÔNG
   chọn được model, dù model là thứ ảnh hưởng tới chất lượng nhiều hơn cả mức nghĩ.
   Tách ra thành công tắc riêng để màn giao task và khung chat dùng CHUNG một chỗ —
   hai bản riêng là hai nơi lệch nhau lúc nào không biết (đúng bài học của
   PermSwitch/EffortSwitch).

   Dùng ĐÚNG tên rút gọn CLI nhận: `opus`/`sonnet`/`haiku`. Không ghi tên đầy đủ kèm
   ngày (`claude-opus-4-...`) vì bản cài của Vinh nâng cấp thì chuỗi đó thành sai,
   còn tên rút gọn luôn trỏ tới bản mới nhất theo cấu hình Claude đang có. */

export const MODELS = [
  { id: '', label: 'Theo cấu hình', desc: 'Dùng model Claude CLI đang đặt sẵn' },
  { id: 'opus', label: 'Opus', desc: 'Mạnh nhất — việc khó, suy luận dài' },
  { id: 'sonnet', label: 'Sonnet', desc: 'Cân bằng — dùng hằng ngày' },
  { id: 'haiku', label: 'Haiku', desc: 'Nhanh và rẻ — việc vặt' },
] as const;

export function modelOf(id?: string) {
  return MODELS.find((m) => m.id === (id || '')) || MODELS[0];
}

/* model nhận cả null: server trả `model: null` khi phiên không đặt model riêng (theo
   model toàn cục). Ép về '' ngay bên dưới nên null hay undefined đều như nhau. */
export function ModelSwitch({ model, compact }: { model?: string | null; compact?: boolean }) {
  const [cur, setCur] = useState(model || '');

  // Server là nguồn thật — SSE đẩy về, đồng bộ khi đổi ở tab/thiết bị khác
  useEffect(() => { setCur(model || ''); }, [model]);

  const chon = async (id: string) => {
    const truoc = cur;
    setCur(id);
    try {
      await api('/api/model', { method: 'POST', body: JSON.stringify({ model: id }) });
      toast(modelOf(id).desc);
      navigator.vibrate?.(10);
    } catch {
      setCur(truoc);
      toast.error('Không đổi được model');
    }
  };

  const m = modelOf(cur);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant={compact ? 'ghost' : 'outline'} size="sm" data-testid="model-btn"
            data-model={cur || 'auto'}
            title={'Model: ' + m.label + ' — ' + m.desc}
            className={cn('tap44 shrink-0 gap-1.5', cur && 'text-primary',
              compact
                ? 'h-auto px-1 py-0 font-mono text-[10.5px] font-normal hover:bg-transparent hover:underline'
                : 'h-10 text-[12px]')}>
            <Cpu className={compact ? 'size-3' : 'size-3.5'} />
            <span className="max-w-[86px] truncate">{m.label}</span>
          </Button>
        } />
      <DropdownMenuContent align="end" className="w-[250px]">
        {MODELS.map((o) => (
          <DropdownMenuItem key={o.id || 'auto'} onClick={() => chon(o.id)}
            data-testid={'model-' + (o.id || 'auto')} className="items-start gap-2 py-2">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                {o.label}
                {o.id && <code className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{o.id}</code>}
                {cur === o.id && <Check className="size-3.5 text-primary" />}
              </span>
              <span className="text-[11.5px] leading-snug text-muted-foreground">{o.desc}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
