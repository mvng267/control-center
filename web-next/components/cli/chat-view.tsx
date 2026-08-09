'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Send, Square, Check, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { ToolCard, type ToolPart } from './tool-card';
import { Markdown } from './markdown';
import { ChatToolbar, AttachBar, AttachButton, type Attachment } from './chat-toolbar';
import { PermSwitch } from './perm-switch';
import { TodoBar } from './todo-bar';
import { SlashHint, useSlash } from './slash-hint';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type TextPart = { t: 'text'; text: string };
type ThinkPart = { t: 'think'; text: string };
type Part = TextPart | ThinkPart | ToolPart;

interface Msg { role: string; content: string; ts: string | null; parts?: Part[]; n?: number }
interface Usage { turns: number; inTok: number; outTok: number; cacheRead: number; cacheWrite: number }
interface History {
  messages: Msg[]; total: number; start: number; typing: boolean; status: string;
  title: string; error: string | null; awaiting: boolean; model: string | null;
  usage: Usage | null;
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

export function ChatView({ sid, onBack, perm }: { sid: string; onBack: () => void; perm?: string }) {
  const [h, setH] = useState<History | null>(null);
  const [att, setAtt] = useState<Attachment[]>([]);
  // Thẻ tool nào đang mở — giữ ở ĐÂY chứ không trong từng thẻ, xem chú thích ở
  // tool-card.tsx. Khoá là tool_use_id nên bền qua mọi lần dựng lại cây.
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());
  const toggleTool = (id: string) => setOpenTools((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const [text, setText] = useState('');
  const slash = useSlash(text, (v) => setText(v));
  // Tin vừa gửi, hiện NGAY trước khi server kịp ghi vào .jsonl. Đo thật: Claude CLI
  // mất ~1.9s mới ghi file, cộng vòng poll 2s -> tin của mình có thể 4s sau mới hiện,
  // cảm giác như treo. Giữ ở đây tới khi bản từ server có nội dung trùng thì bỏ đi.
  const [pending, setPending] = useState<Msg[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  // Nhịp hỏi lại server: Claude ĐANG chạy thì hỏi dày (700ms) để chữ hiện ra gần như
  // tức thì; rảnh thì giãn ra 2s cho đỡ tốn pin và băng thông Tailscale.
  const busyNow = h?.typing || h?.status === 'RUNNING';
  useEffect(() => {
    let alive = true;
    const load = () => api<History>('/api/history/' + sid).then((r) => alive && setH(r)).catch(() => {});
    load();
    const t = setInterval(load, busyNow ? 700 : 2000);
    return () => { alive = false; clearInterval(t); };
  }, [sid, busyNow]);

  useEffect(() => {
    if (!pending.length) return;
    const server = h?.messages || [];
    setPending((ps) => ps.filter(
      (p) => !server.some((m) => m.role === 'user' && m.content.trim() === p.content.trim())));
  }, [h?.messages]);   // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(
    () => groupMessages([...(h?.messages || []), ...pending]), [h?.messages, pending]);

  // TodoWrite MỚI NHẤT của phiên — mỗi lần Claude cập nhật là ghi đè cả danh sách,
  // nên chỉ bản cuối mới phản ánh đúng tiến độ. Quét ngược cho nhanh.
  const todos = useMemo(() => {
    const ms = h?.messages || [];
    for (let i = ms.length - 1; i >= 0; i--) {
      for (const p of ms[i].parts || []) {
        if (p.t === 'tool' && p.todos?.length) return p.todos;
      }
    }
    return [];
  }, [h?.messages]);

  useEffect(() => {
    const el = boxRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [groups.length, h?.typing]);

  const send = async () => {
    const v = text.trim();
    if (!v && !att.length) return;
    // Claude CLI đọc ảnh qua ĐƯỜNG DẪN file, không nhận base64 trong tin nhắn.
    // /api/upload đã lưu ảnh xuống đĩa nên ở đây chỉ cần chèn đường dẫn vào câu.
    const msg = att.length
      ? (v ? v + '\n\n' : 'Xem ảnh này:\n\n') + att.map((a) => a.path).join('\n')
      : v;
    const keep = att;
    setText(''); setAtt([]);
    const mine: Msg = { role: 'user', content: msg, ts: new Date().toISOString() };
    setPending((ps) => [...ps, mine]);
    atBottom.current = true;   // vừa gửi thì luôn cuộn xuống xem tin của mình
    try {
      const r = await api<{ error?: string }>('/api/chat/' + sid, {
        method: 'POST', body: JSON.stringify({ message: msg }),
      });
      if (r.error) {
        setPending((ps) => ps.filter((p) => p !== mine));
        setText(v); setAtt(keep); toast.error('Không gửi được: ' + r.error);
      }
    } catch {
      setPending((ps) => ps.filter((p) => p !== mine));
      setText(v); setAtt(keep); toast.error('Lỗi mạng');
    }
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
      <div className="mx-auto flex w-full max-w-[920px] shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <Button variant="ghost" size="icon" className="size-8" onClick={onBack}><ArrowLeft className="size-4" /></Button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" data-testid="chat-title" title={sid}>
          {h?.title || sid.slice(0, 8)}
        </span>
        {h?.model && <Badge variant="outline" className="hidden shrink-0 text-[10.5px] text-tool-accent sm:inline-flex">{h.model}</Badge>}
        <Badge variant="outline" className={cn('hidden shrink-0 text-[10.5px] sm:inline-flex',
          h?.status === 'RUNNING' && 'border-status-ok/40 text-status-ok')}>{h?.status || '…'}</Badge>
        {/* Chế độ quyền phải thấy được NGAY TRONG chat: đang nhắn mà không biết Claude
            có tự sửa file được không thì không dám giao việc. */}
        <PermSwitch perm={perm} compact testid="chat-perm" />
        <ChatToolbar sid={sid} title={h?.title || ''} model={h?.model ?? null} usage={h?.usage}
          onTitle={(t) => setH((x) => (x ? { ...x, title: t } : x))}
          onModel={(mo) => setH((x) => (x ? { ...x, model: mo } : x))} />
      </div>

      <TodoBar todos={todos} />

      <div ref={boxRef} data-testid="chat-bubbles"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        /* Căn giữa và chặn bề rộng: trên màn 1440px mà để dòng chạy hết chiều ngang thì
           mắt phải quét quá xa, đọc rất mệt. 920px ~ 100 ký tự/dòng. */
        className="mx-auto flex w-full min-h-0 max-w-[920px] flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4">
        {groups.map((m, gi) => {
          const parts = m.parts?.length ? mergeTextParts(m.parts) : [{ t: 'text', text: m.content } as TextPart];
          const tools = parts.filter((p): p is ToolPart => p.t === 'tool');
          const k = dayKey(m.ts);
          const showDay = k && k !== lastDay;
          if (showDay) lastDay = k;
          return (
            /* key theo nội dung, không theo chỉ số: chỉ số đổi mỗi khi cách gộp
               nhóm thay đổi -> React dựng lại cả lượt vô cớ. */
            <div key={(m.ts || '') + ':' + (m.role || '') + ':' + gi} className="contents">
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
                    <div key={p.id || i} className="w-full">
                      <ToolCard part={p} sid={sid} open={openTools.has(p.id)} onToggle={toggleTool} /></div>
                  ) : p.text?.trim() ? (
                    <div key={i} data-testid="bubble"
                      className={cn(
                        'max-w-full break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed',
                        (m.role === 'user' || p.t === 'think') && 'whitespace-pre-wrap',
                        m.role === 'user'
                          ? 'rounded-br-md bg-primary text-primary-foreground'
                          : 'rounded-bl-md border border-border border-l-2 border-l-primary/45 bg-card',
                        p.t === 'think' && 'border-dashed italic text-muted-foreground',
                      )}>
                      {m.role === 'user' || p.t === 'think'
                        ? p.text
                        : <Markdown>{p.text}</Markdown>}
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
          <Button size="sm" variant="outline" className="h-[30px] text-status-error" onClick={stop}
            data-testid="stop-btn">
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

      <div className="mx-auto w-full max-w-[920px] shrink-0 border-t border-border px-3 py-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <SlashHint items={slash.items} active={slash.active} onPick={slash.pick} />
        <AttachBar items={att} onRemove={(i) => setAtt((xs) => xs.filter((_, k) => k !== i))} />
        <div className="flex items-center gap-2">
          {/* Nút ảnh nằm CẠNH ô nhắn tin, không phải trên header: đính ảnh là một
              phần của việc soạn tin, để tít trên cùng thì tay phải với. */}
          <AttachButton onAttach={(a) => setAtt((xs) => [...xs, a])} />
          {/* Textarea: dán đoạn dài / viết nhiều dòng vẫn đọc được.
              Enter gửi, Shift+Enter xuống dòng. */}
          <Textarea value={text} onChange={(e) => setText(e.target.value)} data-testid="chat-input"
            rows={1}
            onKeyDown={(e) => {
              if (slash.onKeyDown(e)) return;   // ↑↓ chọn, Tab/Enter điền, Esc đóng
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault(); send();
              }
            }}
            ref={(el) => {
              if (!el) return;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.35)) + 'px';
            }}
            placeholder="Tiếp tục cuộc trò chuyện…"
            className="max-h-[35dvh] min-h-11 resize-none py-2.5 text-[16px]" />
          <Button size="icon" className="size-11 shrink-0" onClick={send}
            disabled={!text.trim() && !att.length} data-testid="chat-send">
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
