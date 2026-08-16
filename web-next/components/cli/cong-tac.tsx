'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* MỘT khung chung cho cả ba công tắc: quyền, mức nghĩ, model.

   Ba file cũ trùng nhau 75-80% — cùng import, cùng lối optimistic + rollback + toast
   + vibrate, cùng khung JSX dropdown. Khác nhau đúng ba thứ: endpoint, danh sách mục,
   icon. Chép ba bản là ba nơi lệch nhau lúc nào không biết, và đã lệch thật:
   ModelSwitch để `h-10` trong khi hai cái kia `h-8`, nên trong màn giao việc ba nút
   nằm cùng hàng mà cao thấp khác nhau 8px. Gom lại là hết chỗ để lệch.

   Cấu hình theo phiên: truyền `sid` thì gọi `/api/<x>/<sid>` (chỉ đổi cho phiên đó),
   không truyền thì gọi `/api/<x>` (mặc định chung cho phiên mới, loop/cron). */

export interface MucChon {
  id: string;
  label: string;
  desc: string;
  /** icon riêng cho từng mục — quyền dùng, mức nghĩ và model để trống */
  Icon?: React.ComponentType<{ className?: string }>;
  /** màu chữ khi mục này đang được chọn */
  tone?: string;
}

export function CongTac({
  muc, giaTri, endpoint, khoaBody, sid, IconChung, toneChung,
  nhan, testid, compact, rongMenu = 260, rongNhan = 86,
}: {
  muc: readonly MucChon[];
  giaTri?: string;
  /** 'perm' | 'effort' | 'model' — ghép thành /api/<endpoint>[/<sid>] */
  endpoint: string;
  /** tên trường trong body POST; server mỗi route đọc một tên khác nhau */
  khoaBody: string;
  sid?: string;
  /** icon dùng chung khi mục không có icon riêng */
  IconChung?: React.ComponentType<{ className?: string }>;
  toneChung?: string;
  nhan: string;
  testid: string;
  compact?: boolean;
  rongMenu?: number;
  rongNhan?: number;
}) {
  const dau = muc[0]?.id ?? '';
  const [cur, setCur] = useState(giaTri ?? dau);

  // Server là nguồn thật — SSE/history đẩy về, đồng bộ khi đổi ở tab hay thiết bị khác
  useEffect(() => { setCur(giaTri ?? dau); }, [giaTri, dau]);

  const chon = async (id: string) => {
    const truoc = cur;
    setCur(id);                          // đổi ngay cho đỡ giật, hỏng thì trả lại
    try {
      const u = sid ? `/api/${endpoint}/${sid}` : `/api/${endpoint}`;
      await api(u, { method: 'POST', body: JSON.stringify({ [khoaBody]: id }) });
      toast(muc.find((x) => x.id === id)?.desc || '');
      navigator.vibrate?.(10);
    } catch {
      setCur(truoc);
      toast.error(`Không đổi được ${nhan.toLowerCase()}`);
    }
  };

  const dangChon = muc.find((x) => x.id === cur) || muc[0];
  const Icon = dangChon.Icon || IconChung;
  /* Luôn tô màu theo lựa chọn. Trước đây chỉ Perm làm vậy, còn Effort/Model để xám khi
     ở mục đầu — nhìn như đang tắt trong khi vẫn có hiệu lực. */
  const tone = dangChon.tone || (cur ? toneChung : '');

  return (
    <DropdownMenu>
      {/* compact = nằm trong dòng trạng thái dưới ô gõ, chỗ đó rất chật nên bỏ viền */}
      <DropdownMenuTrigger
        render={
          <Button variant={compact ? 'ghost' : 'outline'} size="sm" data-testid={testid}
            data-gia-tri={cur || 'auto'}
            title={`${nhan}: ${dangChon.label} — ${dangChon.desc}`}
            className={cn('tap44 shrink-0 gap-1.5', tone,
              compact
                ? 'h-auto px-1 py-0 text-[10.5px] font-normal hover:bg-transparent hover:underline'
                : 'h-9 text-[12px]')}>
            {Icon && <Icon className={compact ? 'size-3' : 'size-3.5'} />}
            <span className="truncate" style={{ maxWidth: rongNhan }}>{dangChon.label}</span>
          </Button>
        } />
      <DropdownMenuContent align="end" style={{ width: rongMenu }}>
        {muc.map((x) => {
          const MucIcon = x.Icon || IconChung;
          return (
            <DropdownMenuItem key={x.id || 'auto'} onClick={() => chon(x.id)}
              data-testid={`${endpoint}-${x.id || 'auto'}`} className="items-start gap-2 py-2">
              {/* Cột icon có ở MỌI mục — thiếu nó thì chữ không thẳng cột, đó là chỗ
                  Effort/Model nhìn lệch so với Perm trước đây. */}
              {MucIcon
                ? <MucIcon className={cn('mt-0.5 size-3.5 shrink-0', x.tone || 'text-muted-foreground')} />
                : <span className="mt-0.5 size-3.5 shrink-0" />}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  {x.label}
                  {!!x.id && (
                    <code className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{x.id}</code>
                  )}
                  {cur === x.id && <Check className="size-3.5 text-primary" />}
                </span>
                <span className="text-[11.5px] leading-snug text-muted-foreground">{x.desc}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
