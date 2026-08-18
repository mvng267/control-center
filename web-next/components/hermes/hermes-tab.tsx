'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, MessageSquare, Search, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { HermesTools } from './hermes-tools';
import { toast } from 'sonner';

interface HMsg { role: string; content: string; ts: number }
interface HConv { id: string; title: string; source: string; count: number; lastTs: number; messages: HMsg[] }

// Hội thoại từ Hermes CLI không có tiêu đề, tên rơi về ID thô kiểu
// "20260808_170834_f6bbf2" — nhìn không biết là cái gì. ID đã chứa sẵn ngày giờ
// nên dịch ra tiếng Việt; hội thoại từ Telegram vốn có tiêu đề thật thì giữ nguyên.
const RAW_ID = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_[0-9a-f]+$/;

function niceTitle(c: { title: string; source: string }) {
  const m = RAW_ID.exec(c.title || '');
  if (!m) return c.title;
  const [, y, mo, d, h, mi] = m;
  return `Phiên ${c.source} · ${d}/${mo}/${y} ${h}:${mi}`;
}

// Tin đầu tiên của người dùng làm phụ đề — biết hội thoại nói về gì mà không phải mở.
// Bỏ qua tin do HỆ THỐNG chèn vào luồng user: thông báo tiến trình nền, nhắc nhở,
// kết quả tool… Không lọc thì phụ đề thành "[IMPORTANT: Background process proc_7ff…
// completed normally (exit code 0)" — chẳng nói lên điều gì về hội thoại.
const NOISE = /^\s*(\[IMPORTANT|<[a-z-]+>|\[Request interrupted|Caveat:|\[system\])/i;

function firstLine(c: { messages?: { role: string; content: string }[] }) {
  const first = (c.messages || []).find(
    (m) => m.role === 'user' && m.content.trim() && !NOISE.test(m.content));
  if (!first) return '';
  return first.content.replace(/\s+/g, ' ').trim().slice(0, 90);
}

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
  const [q, setQ] = useState('');
  const [extra, setExtra] = useState<Record<string, HMsg[]>>({});
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [moTools, setMoTools] = useState(false);
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
    const needle = q.trim().toLowerCase();
    const shown = needle
      ? convs.filter((c) => (niceTitle(c) + ' ' + firstLine(c) + ' ' + c.source).toLowerCase().includes(needle))
      : convs;
    return (
      <div className="pb-24 md:pb-6">
        <PageHeader title="Hermes" count={convs.length}
          desc="Hội thoại của Hermes từ Telegram và CLI, gộp về một chỗ."
          actions={
            <>
            <Button variant="outline" size="sm" className="tap44 h-8 text-[12px]"
              onClick={() => setMoTools(true)} data-testid="hermes-tools-btn">
              <Wrench className="size-3.5" /> Công cụ
            </Button>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} data-testid="hermes-search"
                placeholder="Tìm hội thoại…" className="h-11 w-[180px] pl-8 text-[16px] md:h-8 md:text-[14px]" />
            </div>
            </>
          } />

      {moTools && <HermesTools onClose={() => setMoTools(false)} />}

      <div className="mx-auto flex max-w-[1000px] flex-col gap-2 px-4 md:px-6" data-testid="hermes-list">
        {shown.length === 0 && (
          <div className="py-10 text-center text-[14px] text-muted-foreground">
            {needle ? `Không có hội thoại nào khớp “${q}”` : 'Chưa có hội thoại nào'}
          </div>
        )}
        {shown.map((c) => (
          <Card key={c.id} data-testid="hermes-conv"
            className="cursor-pointer gap-0 p-3 transition-colors hover:bg-accent/50"
            onClick={() => setOpenId(c.id)}>
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-tool-accent/15 text-tool-accent">
                <MessageSquare className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{niceTitle(c)}</span>
                <span className="block truncate text-[12px] text-muted-foreground">
                  {firstLine(c) || `${c.source} · ${c.count} tin`}
                </span>
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                {c.lastTs ? new Date(c.lastTs).toLocaleDateString('vi-VN') : ''}
              </span>
            </div>
          </Card>
        ))}
      </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="hermes-chat">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <Button variant="ghost" size="icon" className="tap44 size-8" onClick={() => setOpenId(null)}>
          <ArrowLeft className="size-4" />
        </Button>
        <span className="truncate text-[14px] font-medium">{conv ? niceTitle(conv) : ''}</span>
      </div>

      {/* testid này là ĐỊA CHỈ cho use-soft-keyboard: bàn phím bật thì nó cuộn hộp
          xuống cuối. Đổi tên là mất tính năng, không phải chỉ hỏng test. */}
      <div ref={boxRef} data-testid="hermes-bubbles"
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4">
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
          <Button size="icon" className="tap44 size-11 shrink-0" onClick={send} disabled={sending}>
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
