'use client';

import { useState } from 'react';
import { Repeat, CalendarClock, Trash2, Plus, Timer, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { Job } from '@/lib/types';
import { toast } from 'sonner';

/* Việc nền — chạy lặp (/loop) và hẹn giờ (cron). Server đã có sẵn 3 endpoint từ lâu
   nhưng giao diện mới CHƯA HỀ dùng tới, nên tính năng coi như mất. */

// Dùng lại kiểu Job chung ở lib/types (SSE cũng trả đúng dạng này) — khai lại một
// bản riêng ở đây là hai nơi lệch nhau lúc nào không biết.
export type { Job } from '@/lib/types';

// Vài mốc hay dùng, đỡ phải nhớ cú pháp cron
const CRON_PRESETS = [
  { label: 'Mỗi 15 phút', v: '*/15 * * * *' },
  { label: 'Mỗi giờ', v: '0 * * * *' },
  { label: '8h sáng hằng ngày', v: '0 8 * * *' },
  { label: 'Thứ 2 hằng tuần', v: '0 9 * * 1' },
];
const LOOP_PRESETS = ['5m', '15m', '30m', '1h'];

function cronVi(spec: string) {
  const hit = CRON_PRESETS.find((p) => p.v === spec);
  return hit ? hit.label : spec;
}

export function JobsPanel({ jobs, onOpen, moSan }: {
  jobs: Job[];
  onOpen?: (sid: string) => void;
  /* Đứng một mình trong tab "Việc nền" thì luôn mở — gập lại là tab trống trơn.
     Khi còn là dải nhét giữa danh sách thì mới cần gập cho đỡ chiếm chỗ. */
  moSan?: boolean;
}) {
  const [dlg, setDlg] = useState<null | 'loop' | 'cron'>(null);
  const [prompt, setPrompt] = useState('');
  const [spec, setSpec] = useState('15m');
  const [busy, setBusy] = useState(false);
  // có việc đang chạy thì mở sẵn, không thì gập cho gọn
  const [mo, setMo] = useState(moSan || jobs.length > 0);

  const create = async () => {
    const p = prompt.trim();
    if (!p) return toast.error('Chưa nhập việc cần làm');
    setBusy(true);
    try {
      const url = dlg === 'loop' ? '/api/loop' : '/api/schedule';
      const body = dlg === 'loop'
        ? JSON.stringify({ interval: spec, prompt: p })
        : JSON.stringify({ cron: spec, prompt: p });
      const r = await api<{ ok?: boolean; id?: string; error?: string }>(url, { method: 'POST', body });
      if (!r.ok) return toast.error(r.error || 'Không tạo được');
      toast.success(dlg === 'loop' ? `Sẽ chạy lại mỗi ${spec}` : `Đã hẹn: ${cronVi(spec)}`);
      setPrompt(''); setDlg(null);
      navigator.vibrate?.(12);
    } catch { toast.error('Lỗi mạng'); }
    finally { setBusy(false); }
  };

  const del = async (id: string) => {
    try {
      await api('/api/jobs/' + id, { method: 'DELETE' });
      toast('Đã huỷ việc nền');
    } catch { toast.error('Không huỷ được'); }
  };

  const openNew = (k: 'loop' | 'cron') => {
    setSpec(k === 'loop' ? '15m' : '0 * * * *');
    setDlg(k);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="jobs-panel">
      {/* Gập lại khi KHÔNG có việc nào đang chạy. Đây là thứ thỉnh thoảng mới dùng,
          mà đang nằm chen giữa ô tìm kiếm và bảng phiên — đẩy bảng (thứ mở app ra là
          muốn xem ngay) xuống dưới. Có việc đang chạy thì tự mở, vì lúc đó nó đáng
          được nhìn thấy. */}
      <button onClick={() => setMo((v) => !v)} data-testid="jobs-toggle"
        className="tap44 flex items-center gap-2 text-left">
        <Timer className="size-4 text-muted-foreground" />
        <span className="text-[14px] font-semibold">Việc nền</span>
        {jobs.length
          ? <Badge variant="outline" className="text-[12px]">{jobs.length}</Badge>
          : <span className="text-[12px] text-muted-foreground">chưa có</span>}
        <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform', mo && 'rotate-180')} />
      </button>

      {mo && (
      <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" size="sm" className="tap44 h-8 text-[12px]"
            data-testid="job-new-loop" onClick={() => openNew('loop')}>
            <Repeat className="size-3.5" /> Chạy lặp
          </Button>
          <Button variant="outline" size="sm" className="tap44 h-8 text-[12px]"
            data-testid="job-new-cron" onClick={() => openNew('cron')}>
            <CalendarClock className="size-3.5" /> Hẹn giờ
          </Button>
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {jobs.map((j) => (
            <div key={j.id} data-testid="job-row" data-job={j.id}
              className="flex items-center gap-2.5 rounded-[10px] border border-border bg-card px-3 py-2">
              {j.kind === 'loop'
                ? <Repeat className="size-4 shrink-0 text-primary" />
                : <CalendarClock className="size-4 shrink-0 text-tool-accent" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{j.prompt}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {j.kind === 'loop' ? `mỗi ${j.spec}` : cronVi(j.spec)}
                  {j.runs > 0 && ` · đã chạy ${j.runs} lần`}
                </span>
              </span>
              {j.lastSid && onOpen && (
                <Button variant="ghost" size="sm" className="tap44 h-7 shrink-0 text-[12px]"
                  data-testid="job-open" onClick={() => onOpen(j.lastSid!)}>
                  Xem lượt cuối
                </Button>
              )}
              <Button variant="ghost" size="icon" className="tap44 size-7 shrink-0 text-muted-foreground hover:text-status-error"
                data-testid="job-del" title="Huỷ việc này" onClick={() => del(j.id)}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      </div>
      )}

      {dlg && (
        <Dialog open onOpenChange={() => setDlg(null)}>
          <DialogContent className="max-w-[420px]" data-testid="job-dialog">
            <DialogHeader>
              <DialogTitle>{dlg === 'loop' ? 'Chạy lặp lại' : 'Hẹn giờ chạy'}</DialogTitle>
            </DialogHeader>

            <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} autoFocus
              data-testid="job-prompt" placeholder="Việc cần Claude làm mỗi lần…"
              className="text-[16px] md:text-[14px]" />

            <div className="flex flex-wrap gap-1.5">
              {(dlg === 'loop' ? LOOP_PRESETS.map((v) => ({ label: v, v })) : CRON_PRESETS).map((p) => (
                <Button key={p.v} size="sm" variant={spec === p.v ? 'default' : 'outline'}
                  className="tap44 h-7 text-[12px]" onClick={() => setSpec(p.v)}>
                  {p.label}
                </Button>
              ))}
            </div>

            <Input value={spec} onChange={(e) => setSpec(e.target.value)} data-testid="job-spec"
              className="font-mono text-[16px] md:text-[14px]" />
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {dlg === 'loop'
                ? 'Khoảng cách giữa hai lần chạy: 30s, 5m, 1h… Tối thiểu 30 giây vì mỗi lượt là một tiến trình Claude riêng.'
                : 'Cron 5 trường: phút giờ ngày tháng thứ. Ví dụ "0 8 * * *" là 8 giờ sáng hằng ngày.'}
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="tap44" onClick={() => setDlg(null)}>Hủy</Button>
              <Button size="sm" className="tap44" disabled={busy} onClick={create} data-testid="job-create">
                <Plus className="size-3.5" /> Tạo
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
