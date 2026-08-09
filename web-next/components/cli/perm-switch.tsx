'use client';

import { useEffect, useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck, ClipboardList, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* Công tắc chế độ quyền — 4 nấc, khớp PERM_MODES ở server và --permission-mode của
   Claude CLI. Trước đây chỉ có ở màn danh sách, vào trong chat là mất, nên đang nhắn
   thì không biết Claude có tự sửa file được không. Giờ dùng chung cả hai chỗ. */

export const PERMS = [
  {
    id: 'acceptEdits', label: 'Tự sửa file', cli: 'acceptEdits', Icon: ShieldCheck,
    tone: 'text-status-ok', desc: 'Claude tự sửa/tạo file; lệnh nguy hiểm vẫn bị chặn',
  },
  {
    id: 'plan', label: 'Duyệt trước', cli: 'plan', Icon: ClipboardList,
    tone: 'text-primary', desc: 'Trình bày kế hoạch rồi chờ bạn bấm Duyệt mới làm',
  },
  {
    id: 'default', label: 'Hỏi quyền', cli: 'default', Icon: Shield,
    tone: 'text-muted-foreground', desc: 'KHÔNG tự sửa được file (sẽ báo chưa có quyền)',
  },
  {
    id: 'bypassPermissions', label: 'Bỏ kiểm tra', cli: 'bypassPermissions', Icon: ShieldAlert,
    tone: 'text-status-error', desc: 'CẨN THẬN: bỏ qua MỌI kiểm tra quyền',
  },
] as const;

export function permOf(id?: string) {
  return PERMS.find((p) => p.id === id) || PERMS[0];
}

export function PermSwitch({
  perm, compact, testid = 'perm-btn',
}: {
  perm?: string;
  compact?: boolean;   // chỉ hiện icon (dùng trong khung chat cho đỡ chật)
  testid?: string;
}) {
  const [mode, setMode] = useState(perm || 'acceptEdits');

  // Server là nguồn thật: SSE đẩy về mỗi 2s, đồng bộ khi đổi ở tab/thiết bị khác
  useEffect(() => { if (perm && perm !== mode) setMode(perm); }, [perm]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (id: string) => {
    const before = mode;
    setMode(id);                        // đổi ngay cho đỡ giật, hỏng thì trả lại
    try {
      await api('/api/perm', { method: 'POST', body: JSON.stringify({ mode: id }) });
      toast(permOf(id).desc);
      navigator.vibrate?.(10);
    } catch {
      setMode(before);
      toast.error('Không đổi được chế độ');
    }
  };

  const cur = permOf(mode);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" data-testid={testid} data-perm={mode}
            title={'Chế độ quyền: ' + cur.label + ' — ' + cur.desc}
            className={cn('tap44 h-8 shrink-0 gap-1.5 text-[12px]', cur.tone, compact && 'w-8 px-0')}>
            <cur.Icon className="size-3.5" />
            {!compact && <span className="max-w-[92px] truncate">{cur.label}</span>}
          </Button>
        } />
      <DropdownMenuContent align="end" className="w-[268px]">
        {PERMS.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => pick(p.id)} data-testid={'perm-' + p.id}
            className="items-start gap-2 py-2">
            <p.Icon className={cn('mt-[2px] size-4 shrink-0', p.tone)} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                {p.label}
                <code className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{p.cli}</code>
                {mode === p.id && <Check className="size-3.5 text-primary" />}
              </span>
              <span className="text-[11.5px] leading-snug text-muted-foreground">{p.desc}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
