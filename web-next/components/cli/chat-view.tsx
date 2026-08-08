'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Send, Square, Check, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { ToolCard, type ToolPart } from './tool-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type TextPart = { t: 'text'; text: string };
type ThinkPart = { t: 'think'; text: string };
type Part = TextPart | ThinkPart | ToolPart;

interface Msg { role: string; content: string; ts: string | null; parts?: Part[]; n?: number }
interface History {
  messages: Msg[]; total: number; start: number; typing: boolean; status: string;
  title: string; error: string | null; awaiting: boolean; model: string | null;
}

const GROUP_GAP_MS = 120000;

// Claude CLI tách MỖI tool thành một message riêng -> không gộp thì câu văn và tool của
// cùng một lượt bị xé rời, kèm hàng loạt dòng giờ lặp lại. Gộp assistant liên tiếp
// trong 2 phút thành 1 lượt, và gộp các đoạn text liền kề thành 1 bong bóng.
function mergeTextParts(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (p.t === 'text' && prev?.t === 'text') {
      out[out.length - 1] = { t: 'text', text: prev.text + '\n\n' + p.text };
    } else out.push(p);
  }
  return out;
}

function groupMessages(msgs: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    const near = prev?.ts && m.ts && Math.abs(Date.parse(m.ts) - Date.parse(prev.ts)) < GROUP_GAP_MS;
    if (prev && prev.role === 'assistant' && m.role === 'assistant' && near) {
      prev.parts = mergeTextParts([...(prev.parts || [{ t: 'text', text: prev.content }]),
        ...(m.parts || [{ t: 'text', text: m.content }])]);
      prev.content = (prev.content ? prev.content + '\n' : '') + (m.content || '');
      prev.ts = m.ts;
      prev.n = (prev.n || 1) + 1;
      continue;
    }
    out.push({ ...m });
  }
  return out;
}

const clock = (ts: string | null) => {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(+d) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const dayKey = (ts: string | null) => (ts ? new Date(ts).toDateString() : '');
const dayLabel = (ts: string | null) => {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const y = new Date(now.getTime() - 86400000);
  if (d.toDateString() === now.toDateString()) return 'Hôm nay';
  if (d.toDateString() === y.toDateString()) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN');
};

export function ChatView({ sid, onBack }: { sid: string; onBack: () => void }) {
  const [h, setH] = useState<History | null>(null);
  const [text, setText] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    let alive = true;
    const load = () => api<History>('/api/history/' + sid).then((r) => alive && setH(r)).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [sid]);

  const groups = useMemo(() => groupMessages(h?.messages || []), [h?.messages]);

  useEffect(() => {
    const el = boxRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [groups.length, h?.typing]);

  const send = async () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    try {
      const r = await api<{ error?: string }>('/api/chat/' + sid, {
        method: 'POST', body: JSON.stringify({ message: v }),
      });
      if (r.error) { setText(v); toast.error('Không gửi được: ' + r.error); }
    } catch { setText(v); toast.error('Lỗi mạng'); }
  };

  const approve = async () => {
    try {
      await api('/api/approve/' + sid, { method: 'POST', body: '{}' });
      toast.success('Đã duyệt — Claude đang thực hiện');
      navigator.vibrate?.(30);
    } catch { toast.error('Không duyệt được'); }
  };

  const stop = async () => {
    try { await api('/api/kill/' + sid, { method: 'POST' }); toast('Đã dừng Claude'); } catch {}
  };

  let lastDay = '';

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="chat-view">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <Button variant="ghost" size="icon" className="size-8" onClick={onBack}><ArrowLeft className="size-4" /></Button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" data-testid="chat-title" title={sid}>
          {h?.title || sid.slice(0, 8)}
        </span>
        {h?.model && <Badge variant="outline" className="shrink-0 text-[10.5px] text-tool-accent">{h.model}</Badge>}
        <Badge variant="outline" className={cn('shrink-0 text-[10.5px]',
          h?.status === 'RUNNING' && 'border-status-ok/40 text-status-ok')}>{h?.status || '…'}</Badge>
      </div>

      <div ref={boxRef} data-testid="chat-bubbles"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4">
        {groups.map((m, gi) => {
          const parts = m.parts?.length ? mergeTextParts(m.parts) : [{ t: 'text', text: m.content } as TextPart];
          const tools = parts.filter((p): p is ToolPart => p.t === 'tool');
          const k = dayKey(m.ts);
          const showDay = k && k !== lastDay;
          if (showDay) lastDay = k;
          return (
            <div key={gi} className="contents">
              {showDay && (
                <div className="my-2 flex items-center gap-2.5" data-testid="day-divider">
                  <span className="h-px flex-1 bg-border" />
                  <span className="rounded-full border border-border bg-card px-2.5 py-[3px] text-[10.5px] text-muted-foreground">
                    {dayLabel(m.ts)}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <div data-testid="msg-wrap" data-role={m.role}
                className={cn('flex w-full flex-col gap-1.5',
                  m.role === 'user' ? 'items-end self-end' : 'items-start self-start',
                  'max-w-[85%] md:max-w-[76%]')}>
                {parts.map((p, i) =>
                  p.t === 'tool' ? (
                    <div key={i} className="w-full"><ToolCard part={p} sid={sid} /></div>
                  ) : p.text?.trim() ? (
                    <div key={i} data-testid="bubble"
                      className={cn(
                        'max-w-full whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed',
                        m.role === 'user'
                          ? 'rounded-br-md bg-primary text-primary-foreground'
                          : 'rounded-bl-md border border-border border-l-2 border-l-primary/45 bg-card',
                        p.t === 'think' && 'border-dashed italic text-muted-foreground',
                      )}>
                      {p.text}
                    </div>
                  ) : null,
                )}
                {m.ts && (
                  <div className="flex items-center gap-1.5 px-1 text-[10.5px] leading-none text-muted-foreground">
                    <span>{clock(m.ts)}</span>
                    {tools.length > 0 && (
                      <span className={cn(
                        tools.some((t) => t.status === 'error') ? 'text-status-error'
                          : tools.some((t) => t.status === 'running') ? 'text-status-run' : '',
                      )}>
                        · {tools.length} tool
                        {tools.some((t) => t.status === 'error')
                          ? ` · ${tools.filter((t) => t.status === 'error').length} lỗi` : ''}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {h?.typing && (
        <div className="flex shrink-0 items-center gap-3 px-4 pb-1" data-testid="typing">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-[7px] animate-pulse rounded-full bg-muted-foreground"
                style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </span>
          <Button size="sm" variant="outline" className="h-[30px] text-status-error" onClick={stop}>
            <Square className="size-3" /> Dừng
          </Button>
        </div>
      )}

      {h?.error && (
        <div className="mx-4 mb-2 shrink-0 rounded-[10px] border border-status-error/30 bg-status-error/[0.08] px-3 py-2 text-[12.5px] text-status-error"
          data-testid="chat-error">{h.error}</div>
      )}

      {h?.awaiting && (
        <div className="mx-4 mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-[10px] border border-primary/35 bg-primary/10 px-3 py-2 text-[12.5px]"
          data-testid="chat-approve">
          <span className="min-w-0 flex-1">Claude đã trình bày kế hoạch và đang chờ duyệt.</span>
          <Button size="sm" className="h-[34px]" onClick={approve}><Check className="size-3.5" /> Duyệt &amp; chạy</Button>
          <Button size="sm" variant="outline" className="h-[34px]"
            onClick={() => document.querySelector<HTMLInputElement>('[data-testid=chat-input]')?.focus()}>
            <Pencil className="size-3.5" /> Sửa
          </Button>
        </div>
      )}

      <div className="shrink-0 border-t border-border px-3 py-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <div className="flex items-center gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} data-testid="chat-input"
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && send()}
            placeholder="Tiếp tục cuộc trò chuyện…" className="h-11 text-[16px]" />
          <Button size="icon" className="size-11 shrink-0" onClick={send}><Send className="size-4" /></Button>
        </div>
      </div>
    </div>
  );
}
