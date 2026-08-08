'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface HMsg { role: string; content: string; ts: number }
interface HConv { id: string; title: string; source: string; count: number; lastTs: number; messages: HMsg[] }

const EXTRA_KEY = 'hermesExtra';   // tin gửi từ dashboard, giữ qua F5 (cap 60/hội thoại)

function loadExtra(): Record<string, HMsg[]> {
  try { return JSON.parse(localStorage.getItem(EXTRA_KEY) || '{}'); } catch { return {}; }
}
function saveExtra(e: Record<string, HMsg[]>) {
  try { localStorage.setItem(EXTRA_KEY, JSON.stringify(e)); } catch {}
}

export function HermesTab() {
  const [convs, setConvs] = useState<HConv[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [extra, setExtra] = useState<Record<string, HMsg[]>>({});
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setExtra(loadExtra()); }, []);

  useEffect(() => {
    let alive = true;
    const load = () => api<{ conversations: HConv[] }>('/api/hermes')
      .then((r) => alive && setConvs(r.conversations || [])).catch(() => {});
    load();
    const t = setInterval(load, 2500);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const conv = convs.find((c) => c.id === openId);
  const msgs = conv ? [...conv.messages, ...(extra[conv.id] || [])] : [];

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [msgs.length, openId]);

  const send = async () => {
    const v = text.trim();
    if (!v || !openId || sending) return;
    setText('');
    setSending(true);
    // hiện ngay tin của mình, khỏi chờ server
    const mine: HMsg = { role: 'user', content: v, ts: Date.now() };
    const next = { ...extra, [openId]: [...(extra[openId] || []), mine].slice(-60) };
    setExtra(next); saveExtra(next);
    try {
      const r = await api<{ reply?: string; error?: string }>('/api/hermes/send', {
        // server đọc trường `text` (không phải `message`) — gửi sai tên là luôn 400
        method: 'POST', body: JSON.stringify({ text: v }),
      });
      if (r.reply) {
        const withReply = { ...next, [openId]: [...(next[openId] || []),
          { role: 'assistant', content: r.reply, ts: Date.now() }].slice(-60) };
        setExtra(withReply); saveExtra(withReply);
      } else if (r.error) toast.error('Hermes: ' + r.error);
    } catch { toast.error('Không gửi được'); }
    setSending(false);
  };

  if (!openId) {
    return (
      <div className="mx-auto flex max-w-[1000px] flex-col gap-2 p-4 pb-24 md:pb-6" data-testid="hermes-list">
        {convs.length === 0 && (
          <div className="py-10 text-center text-[13px] text-muted-foreground">Chưa có hội thoại nào</div>
        )}
        {convs.map((c) => (
          <Card key={c.id} data-testid="hermes-conv"
            className="cursor-pointer gap-0 p-3 transition-colors hover:bg-accent/50"
            onClick={() => setOpenId(c.id)}>
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-tool-accent/15 text-tool-accent">
                <MessageSquare className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{c.title}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {c.source} · {c.count} tin
                </span>
              </span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                {c.lastTs ? new Date(c.lastTs).toLocaleDateString('vi-VN') : ''}
              </span>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="hermes-chat">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => setOpenId(null)}>
          <ArrowLeft className="size-4" />
        </Button>
        <span className="truncate text-[13px] font-medium">{conv?.title}</span>
      </div>

      <div ref={boxRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4">
        {msgs.map((m, i) => (
          <div key={i} data-testid="hermes-bubble" data-role={m.role}
            className={cn(
              'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed md:max-w-[76%]',
              m.role === 'user'
                ? 'self-end rounded-br-md bg-primary text-primary-foreground'
                : m.role === 'tool'
                  ? 'self-start border border-tool-accent/25 bg-tool-accent/[0.08] font-mono text-[12px] text-tool-accent'
                  : 'self-start rounded-bl-md border border-border bg-card',
            )}>
            {m.role === 'tool' ? m.content.slice(0, 300) : m.content}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-border px-3 py-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <div className="flex items-center gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && send()}
            placeholder="Nhắn cho Hermes…" className="h-11 text-[16px]" data-testid="hermes-input" />
          <Button size="icon" className="size-11 shrink-0" onClick={send} disabled={sending}>
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
