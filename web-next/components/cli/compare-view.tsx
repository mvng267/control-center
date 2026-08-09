'use client';

import { useEffect, useState } from 'react';
import { X, Columns2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Markdown } from './markdown';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Session } from '@/lib/types';

/* So sánh 2 phiên cạnh nhau — port từ web/legacy/js/compare.js.
   Lệnh "So sánh 2 phiên" vốn ĐÃ nằm trong bảng lệnh (lib/commands.ts) nhưng
   page.tsx không có nhánh xử lý, nên bấm vào chỉ hiện toast lạc đề
   "Mở phiên rồi dùng nút tương ứng ở đầu khung chat". */

interface Msg { role: string; content: string; ts: string | null }
interface Hist { messages: Msg[]; title: string; status: string }

function Pane({ sid, onPick }: { sid: string | null; onPick: () => void }) {
  const [h, setH] = useState<Hist | null>(null);

  useEffect(() => {
    if (!sid) { setH(null); return; }
    let alive = true;
    const load = () => api<Hist>('/api/history/' + sid).then((r) => alive && setH(r)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [sid]);

  if (!sid) {
    return (
      <button onClick={onPick} data-testid="cmp-empty"
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-[13px] text-muted-foreground transition-colors hover:bg-accent/30">
        <Columns2 className="size-5" />
        Chọn một phiên
      </button>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border"
      data-testid="cmp-pane" data-sid={sid}>
      <button onClick={onPick}
        className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-left transition-colors hover:bg-accent/30">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{h?.title || sid.slice(0, 8)}</span>
        <span className={cn('shrink-0 text-[10.5px]',
          h?.status === 'RUNNING' ? 'text-status-ok' : 'text-muted-foreground')}>{h?.status || '…'}</span>
      </button>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {(h?.messages || []).map((m, i) => (
          <div key={i} data-testid="cmp-msg" data-role={m.role}
            className={cn('max-w-full break-words rounded-lg px-2.5 py-1.5 text-[12.5px] leading-relaxed',
              m.role === 'user' ? 'bg-primary/15' : 'bg-card')}>
            {m.role === 'user' ? m.content : <Markdown>{m.content}</Markdown>}
          </div>
        ))}
        {!h?.messages?.length && (
          <p className="py-6 text-center text-[12.5px] text-muted-foreground">Chưa có nội dung</p>
        )}
      </div>
    </div>
  );
}

export function CompareView({
  sessions, initial, onClose,
}: {
  sessions: Session[];
  initial?: string | null;
  onClose: () => void;
}) {
  const [left, setLeft] = useState<string | null>(initial || null);
  const [right, setRight] = useState<string | null>(null);
  const [picking, setPicking] = useState<null | 'left' | 'right'>(null);

  const pick = (sid: string) => {
    if (picking === 'left') setLeft(sid); else setRight(sid);
    setPicking(null);
  };

  return (
    <div className="fixed inset-0 z-[130] flex flex-col bg-background" data-testid="compare-view">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <Columns2 className="size-4 text-primary" />
        <span className="flex-1 text-[13px] font-semibold">So sánh 2 phiên</span>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose} data-testid="cmp-close">
          <X className="size-4" />
        </Button>
      </div>

      {/* Điện thoại xếp dọc: 2 cột trên màn 390px thì mỗi cột 190px, không đọc nổi */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:flex-row">
        <Pane sid={left} onPick={() => setPicking('left')} />
        <Pane sid={right} onPick={() => setPicking('right')} />
      </div>

      {picking && (
        <div className="absolute inset-0 z-10 flex flex-col bg-background/95 backdrop-blur-sm"
          data-testid="cmp-picker">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
            <span className="flex-1 text-[13px] font-semibold">
              Chọn phiên cho cột {picking === 'left' ? 'trái' : 'phải'}
            </span>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setPicking(null)}>
              <X className="size-4" />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
            {sessions.map((s) => (
              <button key={s.sid} onClick={() => pick(s.sid)} data-testid="cmp-option"
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-accent/40">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{s.title || s.sid.slice(0, 8)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{s.project}</span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{s.msgs} tin</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
