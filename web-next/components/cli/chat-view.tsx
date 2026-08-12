'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Send, Check, Pencil, Copy, CheckCheck, ImagePlus } from 'lucide-react';
import { api } from '@/lib/api';
import { ToolCard, type ToolPart } from './tool-card';
import { Markdown } from './markdown';
import { ChatToolbar, AttachBar, AttachButton, taiAnhLen, type Attachment } from './chat-toolbar';
import { PermSwitch } from './perm-switch';
import { EffortSwitch } from './effort-switch';
import { TodoBar } from './todo-bar';
import { SlashHint, useSlash } from './slash-hint';
import { MentionHint, useMention } from './mention-hint';
import { ModeHint, docChe } from './mode-hint';
import { DangChay } from './dang-chay';
import { ThinkCard } from './think-card';
import { NoteLine, type NotePart } from './note-line';
import { AskCard } from './ask-card';
import { PlanCard } from './plan-card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type TextPart = { t: 'text'; text: string };
type ThinkPart = { t: 'think'; text: string };
type Part = TextPart | ThinkPart | ToolPart | NotePart;

interface Msg {
  role: string; content: string; ts: string | null; parts?: Part[]; n?: number; sub?: boolean;
  /** mốc ĐẦU lượt — bất biến qua các vòng gộp, dùng làm React key */
  tsDau?: string | null;
}
interface Usage { turns: number; inTok: number; outTok: number; cacheRead: number; cacheWrite: number }
interface History {
  messages: Msg[]; total: number; start: number; typing: boolean; status: string;
  title: string; error: string | null; awaiting: boolean; model: string | null;
  usage: Usage | null;
  nhap?: string;   // chữ đang chảy ra của lượt hiện tại (bản nháp từ stdout)
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

/* Ghi chú nào THUỘC VỀ lượt đang chạy, ghi chú nào là ranh giới thật.
   hook lỗi / lỗi API sinh ra TRONG lúc Claude làm việc -> phải nằm trong lượt đó.
   Mốc /compact là ranh giới thật của phiên -> luôn đứng riêng, cắt lượt là đúng. */
const noteTrongLuot = (m: Msg) => m.role === 'system'
  && !!m.parts?.length
  && m.parts.every((p) => p.t === 'note' && p.kind !== 'compact');

function groupMessages(msgs: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    const near = prev?.ts && m.ts && Math.abs(Date.parse(m.ts) - Date.parse(prev.ts)) < GROUP_GAP_MS;

    /* Hút dòng hook lỗi vào lượt assistant ngay trước nó. Trước đây mỗi dòng như vậy
       đẩy ra một nhóm mới, nên MỘT lượt của Claude bị xé thành 6 khối "Claude · 1 tool"
       liên tiếp (chụp màn hình phiên thật lúc 11:54–11:55 thấy rõ). Trên terminal
       chúng chảy liền một mạch trong cùng lượt. */
    if (prev && prev.role === 'assistant' && noteTrongLuot(m) && near) {
      prev.parts = [...(prev.parts || [{ t: 'text', text: prev.content }]), ...(m.parts || [])];
      prev.ts = m.ts;
      continue;
    }

    // Không trộn lượt của subagent với lượt chính — gộp vào là mất luôn ranh giới.
    if (prev && prev.role === 'assistant' && m.role === 'assistant' && near
        && !prev.sub === !m.sub) {
      prev.parts = mergeTextParts([...(prev.parts || [{ t: 'text', text: prev.content }]),
        ...(m.parts || [{ t: 'text', text: m.content }])]);
      prev.content = (prev.content ? prev.content + '\n' : '') + (m.content || '');
      prev.ts = m.ts;
      prev.n = (prev.n || 1) + 1;
      continue;
    }
    // tsDau ghim mốc lúc MỞ lượt; prev.ts còn bị ghi đè khi gộp thêm tin
    out.push({ ...m, tsDau: m.ts });
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

/* Chép NGUYÊN cả lượt (chữ + tóm tắt tool). Trước chỉ chép được từng khối code. */
function CopyTurn({ parts }: { parts: Part[] }) {
  const [done, setDone] = useState(false);
  const text = parts.map((p) => p.t === 'tool'
    ? `[${p.disp}] ${p.summary}` : (p as TextPart).text).filter(Boolean).join('\n\n');
  if (!text.trim()) return null;
  return (
    <button data-testid="copy-turn" title="Chép cả lượt"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true); setTimeout(() => setDone(false), 1200);
        }).catch(() => {});
      }}
      className="tap44 ml-auto shrink-0 text-muted-foreground/60 transition-colors hover:text-foreground">
      {done ? <CheckCheck className="size-3.5 text-status-ok" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function ChatView({ sid, onBack, perm, effort }: { sid: string; onBack: () => void; perm?: string; effort?: string }) {
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
  // Vị trí con trỏ — "@" đứng giữa câu được nên phải biết đang gõ ở đâu, chỉ nhìn
  // toàn chuỗi như "/" là không đủ.
  const caret = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const mention = useMention(sid, text, (v, c) => {
    setText(v);
    caret.current = c;
    // đặt lại con trỏ sau khi React vẽ xong, không thì nó nhảy về cuối chuỗi
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(c, c));
  }, caret);
  // Lịch sử tin đã gửi, ↑/↓ gọi lại như terminal (port attachHistory —
  // web/legacy/js/palette.js:175-194). Giữ trong localStorage để F5 không mất.
  const HIST_KEY = 'hist:chat';
  const hist = useRef<string[]>([]);
  const histAt = useRef(-1);
  useEffect(() => {
    try { hist.current = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch {}
  }, []);
  const histPush = (v: string) => {
    if (!v.trim()) return;
    hist.current = [v, ...hist.current.filter((x) => x !== v)].slice(0, 50);
    histAt.current = -1;
    try { localStorage.setItem(HIST_KEY, JSON.stringify(hist.current)); } catch {}
  };
  const histNav = (dir: 1 | -1) => {
    const n = hist.current.length;
    if (!n) return false;
    const next = histAt.current + dir;
    if (next < -1 || next >= n) return false;
    histAt.current = next;
    setText(next === -1 ? '' : hist.current[next]);
    return true;
  };
  // Tin vừa gửi, hiện NGAY trước khi server kịp ghi vào .jsonl. Đo thật: Claude CLI
  // mất ~1.9s mới ghi file, cộng vòng poll 2s -> tin của mình có thể 4s sau mới hiện,
  // cảm giác như treo. Giữ ở đây tới khi bản từ server có nội dung trùng thì bỏ đi.
  const [pending, setPending] = useState<Msg[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  /* Dán / kéo-thả ảnh. Trên terminal Claude nhận ảnh dán thẳng; ở đây trước chỉ có
     nút chọn file, nên chụp màn hình xong phải lưu ra đĩa rồi mới đính được.
     Giới hạn 4 ảnh một lần: dán cả album vào thì mỗi ảnh là một lượt tải lên. */
  const [keoVao, setKeoVao] = useState(false);
  const nhanAnh = async (fs: File[]) => {
    const anh = fs.filter((f) => f.type.startsWith('image/'));
    if (!anh.length) return false;
    if (anh.length > 4) toast('Chỉ nhận 4 ảnh một lần');
    for (const f of anh.slice(0, 4)) {
      const a = await taiAnhLen(f);
      if (a) setAtt((xs) => [...xs, a]);
    }
    return true;
  };

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
    // Bám theo cả ĐỘ DÀI bản nháp: chữ chảy ra làm khung cao dần mà số lượt không
    // đổi, chỉ nghe groups.length thì con chữ mới trôi khỏi tầm nhìn.
  }, [groups.length, h?.typing, h?.nhap?.length]);

  /* Nhận tham số để bảng chọn (AskCard) gửi thẳng lựa chọn mà không phải chờ state
     `text` cập nhật xong — setText rồi gọi send() ngay thì send vẫn đọc giá trị cũ. */
  const send = async (noiDung?: string) => {
    const v = (noiDung ?? text).trim();
    if (!v && !att.length) return;
    // Claude CLI đọc ảnh qua ĐƯỜNG DẪN file, không nhận base64 trong tin nhắn.
    // /api/upload đã lưu ảnh xuống đĩa nên ở đây chỉ cần chèn đường dẫn vào câu.
    const msg = att.length
      ? (v ? v + '\n\n' : 'Xem ảnh này:\n\n') + att.map((a) => a.path).join('\n')
      : v;
    const keep = att;
    histPush(v);
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

  // /api/approve nhận body.note (index.js:1258) — gõ sẵn gì trong ô nhập thì gửi kèm
  // làm lưu ý cho lượt duyệt, khỏi phải duyệt xong rồi nhắn bổ sung.
  const approve = async () => {
    const note = text.trim();
    try {
      await api('/api/approve/' + sid, { method: 'POST', body: JSON.stringify(note ? { note } : {}) });
      if (note) setText('');
      toast.success('Đã duyệt — Claude đang thực hiện');
      navigator.vibrate?.(30);
    } catch { toast.error('Không duyệt được'); }
  };

  const stop = async () => {
    try { await api('/api/kill/' + sid, { method: 'POST' }); toast('Đã dừng Claude'); } catch {}
  };

  let lastDay = '';

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-testid="chat-view"
      /* Thả ảnh vào BẤT KỲ đâu trong khung chat, không bắt nhắm đúng ô nhập.
         Chỉ bật khi thứ đang rê thật sự là file — rê chữ bôi đen cũng bắn dragover. */
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault(); setKeoVao(true);
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setKeoVao(false); }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault(); setKeoVao(false); nhanAnh([...e.dataTransfer.files]);
      }}>
      {/* Terminal dùng TRỌN bề ngang cửa sổ. Trước đây kẹp 920px giữa màn hình cho
          "dễ đọc", nhưng nội dung ở đây phần lớn là log tool và đường dẫn dài — bó lại
          thành ra xuống dòng liên tục, còn hai bên bỏ trống. */}
      {/* paddingTop bù safe-area: trên điện thoại header của vỏ app bị ẩn khi đang
          chat, nên thanh này thành thứ trên cùng — thiếu bù thì nút quay lại chui
          xuống dưới notch. Từ md trở lên header vẫn còn nên biến này bằng 0. */}
      <div className="flex w-full shrink-0 items-center gap-2 border-b border-border px-4 py-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <Button variant="ghost" size="icon" className="tap44 size-8" onClick={onBack}
          title="Quay lại danh sách" aria-label="Quay lại danh sách" data-testid="chat-back">
          <ArrowLeft className="size-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium" data-testid="chat-title" title={sid}>
          {h?.title || sid.slice(0, 8)}
        </span>
        {h?.model && <Badge variant="outline" className="hidden shrink-0 text-[10.5px] text-tool-accent sm:inline-flex">{h.model}</Badge>}
        <Badge variant="outline" className={cn('hidden shrink-0 text-[10.5px] sm:inline-flex',
          h?.status === 'RUNNING' && 'border-status-ok/40 text-status-ok')}>{h?.status || '…'}</Badge>
        {/* Chế độ quyền + mức nghĩ chuyển XUỐNG dòng trạng thái dưới ô gõ, đúng chỗ
            Claude CLI in chúng. Để trên này thì lẫn giữa các nút icon, và trên iPhone
            còn bị đẩy khuất. */}
        <ChatToolbar sid={sid} title={h?.title || ''} model={h?.model ?? null} usage={h?.usage}
          onTitle={(t) => setH((x) => (x ? { ...x, title: t } : x))}
          onModel={(mo) => setH((x) => (x ? { ...x, model: mo } : x))} />
      </div>

      {keoVao && (
        <div data-testid="drop-overlay"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80">
          <span className="flex items-center gap-2 text-[14px] font-medium text-primary">
            <ImagePlus className="size-4" /> Thả ảnh vào đây
          </span>
        </div>
      )}

      <TodoBar todos={todos} />

      <div ref={boxRef} data-testid="chat-bubbles"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        /* font-mono cho CẢ bản chép: terminal chỉ có một phông chữ đều, mọi cột thẳng
           hàng. Đây là thứ tạo cảm giác "đúng là CLI" rõ nhất, hơn cả ký tự ⏺ ⎿.
           Full-width: terminal không kẹp nội dung vào giữa. */
        className="flex w-full min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-4 font-mono">
        {groups.map((m, gi) => {
          const parts = m.parts?.length ? mergeTextParts(m.parts) : [{ t: 'text', text: m.content } as TextPart];
          const k = dayKey(m.ts);
          const showDay = k && k !== lastDay;
          if (showDay) lastDay = k;
          return (
            /* key phải BẤT BIẾN qua các vòng poll, nếu không React dựng lại cả lượt
               và mọi state bên trong về 0.
               Hai thứ KHÔNG được đưa vào key:
                 - m.ts: groupMessages ghi đè prev.ts bằng mốc tin mới nhất gộp vào;
                 - gi (chỉ số nhóm): cửa sổ chỉ giữ 30 tin CUỐI, phiên đang chạy thì
                   tin mới đẩy tin cũ ra nên mọi chỉ số tụt đi một.
               Hậu quả đo được: đang chọn dở bảng câu hỏi thì cứ 2 giây mất sạch lựa
               chọn ("Còn 1 câu" -> "Còn 3 câu"), thẻ tool đang mở cũng tự đóng.
               Dùng mốc ĐẦU lượt — nó gắn với chính tin đó, không đổi khi cửa sổ trượt. */
            <div key={(m.tsDau || m.ts || '') + ':' + (m.role || '')} className="contents">
              {showDay && (
                <div className="my-2 flex items-center gap-2.5 text-[10.5px] text-muted-foreground/70"
                  data-testid="day-divider">
                  <span className="h-px flex-1 bg-border" />
                  <span className="shrink-0">{dayLabel(m.ts)}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              {/* MỘT LƯỢT vẽ y như terminal in ra:
                    > câu của mình
                    ⏺ câu trả lời
                    ⏺ Bash(lệnh)
                      ⎿  kết quả
                  Không bong bóng, không avatar, không nhãn vai — terminal không có
                  những thứ đó. Bản trước tôi thêm avatar + tên vai + đường dọc, nhìn
                  vẫn ra giao diện chat của một app chứ không phải bản chép phiên CLI. */}
              {m.role === 'system' ? (
                <div data-testid="msg-wrap" data-role="system" className="flex w-full flex-col">
                  {parts.map((p, i) => p.t === 'note' ? <NoteLine key={i} part={p} /> : null)}
                </div>
              ) : (
              <div data-testid="msg-wrap" data-role={m.role} className="relative flex w-full flex-col pr-12">
                {/* Giờ + nút chép: terminal không có, nhưng đây là dashboard xem lại
                    phiên nên vẫn cần. Đặt nổi ở góc phải, rất mờ, chừa sẵn pr-12 để
                    không đè lên chữ. Neo ở LƯỢT chứ không ở dòng chữ đầu — có lượt
                    chỉ toàn tool, không có câu văn nào để bám vào. */}
                <span className="absolute right-0 top-0 flex items-center gap-1.5 opacity-45 transition-opacity hover:opacity-100">
                  {m.sub && (
                    <span data-testid="msg-sub" className="text-[10px] text-tool-accent">sub</span>
                  )}
                  {m.ts && (
                    <span className="select-none text-[10px] tabular-nums text-muted-foreground">
                      {clock(m.ts)}
                    </span>
                  )}
                  <CopyTurn parts={parts} />
                </span>

                {parts.map((p, i) =>
                  p.t === 'tool' && p.hoi?.length ? (
                    // Bảng chọn: bấm rồi gửi lựa chọn thành tin nhắn mới
                    <div key={p.id || i} className="my-1">
                      {/* daTraLoi: chỉ khoá khi phiên đã CÓ LƯỢT SAU thật sự. Trước
                          dùng `gi < groups.length - 1` — cửa sổ 30 tin trượt làm cả
                          gi lẫn groups.length đổi mỗi vòng poll, nên thẻ chớp giữa
                          khoá/mở và mất sạch lựa chọn đang chọn dở.
                          Mốc lượt là bất biến, so nó với lượt cuối thì ổn định. */}
                      <AskCard hoi={p.hoi}
                        daTraLoi={(m.tsDau || m.ts || '') !== (groups[groups.length - 1]?.tsDau
                          || groups[groups.length - 1]?.ts || '')}
                        onGui={(t) => send(t)} />
                    </div>
                  ) : p.t === 'tool' && p.ke ? (
                    <div key={p.id || i} className="my-1">
                      <PlanCard ke={p.ke} keFile={p.keFile} daDuyet={!h?.awaiting} onDuyet={approve}
                        onSua={() => document.querySelector<HTMLTextAreaElement>('[data-testid=chat-input]')?.focus()} />
                    </div>
                  ) : p.t === 'tool' ? (
                    <ToolCard key={p.id || i} part={p} sid={sid}
                      open={openTools.has(p.id)} onToggle={toggleTool} />
                  ) : p.t === 'note' ? (
                    <NoteLine key={i} part={p} />
                  ) : p.t === 'think' ? (
                    <ThinkCard key={i} text={p.text} />
                  ) : p.text?.trim() ? (
                    /* Câu văn: mình thì "> ", Claude thì "⏺ ".
                       MÀU theo đúng Claude CLI: chấm của lượt TRẢ LỜI là màu chữ
                       thường (trắng), không phải tím. Tím trong CLI dành riêng cho
                       tool. Đo trên ảnh chụp: dashboard tô tím cả câu văn lẫn tool
                       nên không phân biệt được đâu là Claude nói, đâu là nó chạy
                       lệnh — mất đúng thông tin mà ký tự ⏺ sinh ra để mang. */
                    <div key={i} data-testid="bubble" data-role={m.role}
                      className="flex w-full items-start gap-2 text-[13px] leading-relaxed">
                      <span className={cn('shrink-0 select-none',
                        m.role === 'user' ? 'text-primary' : 'text-foreground')}>
                        {m.role === 'user' ? '❯' : '⏺'}
                      </span>
                      <div className={cn('min-w-0 flex-1 break-words',
                        m.role === 'user' && 'whitespace-pre-wrap text-foreground/90')}>
                        {m.role === 'user' ? p.text : <Markdown>{p.text}</Markdown>}
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
              )}
            </div>
          );
        })}

        {/* CHỮ ĐANG CHẢY RA của lượt hiện tại.
            .jsonl chỉ được ghi khi lượt XONG, nên trước đây màn hình đứng im hàng chục
            giây (đo thật: có lượt gần 5 giây, có lượt lâu hơn nhiều) rồi bung ra một
            cục. Giờ đọc thẳng stdout của tiến trình nên chữ hiện dần như terminal.
            Con trỏ nhấp nháy ở cuối, đúng kiểu terminal đang gõ. */}
        {!!h?.nhap && (
          <div data-testid="dang-go" className="flex w-full gap-2">
            <span aria-hidden className="shrink-0 select-none text-tool-accent">⏺</span>
            <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed">
              {h.nhap}
              <span className="ml-[1px] inline-block h-[13px] w-[7px] translate-y-[2px] animate-pulse bg-foreground/70" />
            </div>
          </div>
        )}
      </div>

      {/* Nút dừng dựa vào STATUS, không phải `typing`. `typing = procs.has(sid)` chỉ
          đúng khi chính dashboard spawn Claude — phiên chạy từ terminal ngoài thì
          typing=false nên KHÔNG có nút dừng nào, mà bấm Gửi lại nhận 409 "session is
          busy". Bản legacy dùng status nên vẫn xử lý được (export.js:453). */}
      {(h?.typing || h?.status === 'RUNNING') && <DangChay onStop={stop} />}

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

      <div className="w-full shrink-0 border-t border-border px-3 py-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <SlashHint items={slash.items} active={slash.active} onPick={slash.pick} />
        <MentionHint items={mention.items} active={mention.active} onPick={mention.pick} />
        <ModeHint che={docChe(text)} />
        <AttachBar items={att} onRemove={(i) => setAtt((xs) => xs.filter((_, k) => k !== i))} />
        {/* Claude CLI KHÔNG vẽ hộp bo góc quanh dòng nhập — bắt bằng PTY thật
            (expect + TERM=xterm-256color) rồi đếm ký tự: 80 dấu `─` kẻ một đường
            ngang hết bề rộng, dấu nhắc `❯`, dấu `·` ngăn các gợi ý. Không có ký tự
            góc ┌┐└┘ nào cả.
            Nên: một đường kẻ trên, ô gõ nằm dưới, không viền không bo. Màu đường kẻ
            đổi theo chế độ để vẫn biết đang gõ `!` hay `#`. */}
        <div className={cn('flex items-center gap-2 border-t-2 pt-2 transition-colors',
          docChe(text) === 'bash' ? 'border-tool-accent/60'
            : docChe(text) === 'nho' ? 'border-primary/60'
            : text.trim() ? 'border-primary/50' : 'border-border')}>
          {/* Nút ảnh nằm CẠNH ô nhắn tin, không phải trên header: đính ảnh là một
              phần của việc soạn tin, để tít trên cùng thì tay phải với. */}
          <AttachButton onAttach={(a) => setAtt((xs) => [...xs, a])} />
          {/* Dấu nhắc trước ô gõ, đúng như dòng nhập của Claude CLI — và ĐỔI theo chế
              độ: "!" chạy bash, "#" ghi nhớ, còn lại là ">" nhắn cho Claude. */}
          <span aria-hidden data-testid="prompt-sign"
            className={cn('shrink-0 select-none font-mono text-[15px]',
              docChe(text) === 'bash' ? 'text-tool-accent'
                : docChe(text) === 'nho' ? 'text-primary' : 'text-primary')}>
            {docChe(text) === 'bash' ? '!' : docChe(text) === 'nho' ? '#' : '❯'}
          </span>
          {/* Textarea: dán đoạn dài / viết nhiều dòng vẫn đọc được.
              Enter gửi, Shift+Enter xuống dòng. */}
          <Textarea value={text} data-testid="chat-input"
            rows={1}
            onChange={(e) => { caret.current = e.target.selectionStart ?? 0; setText(e.target.value); }}
            // Bấm chuột / dùng phím mũi tên cũng đổi vị trí con trỏ, không chỉ lúc gõ
            onSelect={(e) => { caret.current = e.currentTarget.selectionStart ?? 0; }}
            /* Dán ảnh: chỉ chặn sự kiện khi clipboard THẬT SỰ có ảnh, không thì
               chặn nhầm cả dán chữ thường. */
            onPaste={(e) => {
              const fs = [...(e.clipboardData?.files || [])];
              if (fs.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); nhanAnh(fs); }
            }}
            onKeyDown={(e) => {
              if (slash.onKeyDown(e)) return;     // ↑↓ chọn, Tab/Enter điền, Esc đóng
              if (mention.onKeyDown(e)) return;   // như trên, cho bảng gợi ý file "@"
              /* Esc ngắt Claude, đúng như terminal. Đặt SAU hai bảng gợi ý: đang mở
                 gợi ý thì Esc phải đóng bảng trước, không được dừng luôn cả lượt. */
              if (e.key === 'Escape' && (h?.typing || h?.status === 'RUNNING')) {
                e.preventDefault(); stop(); return;
              }
              // ↑/↓ gọi lại tin cũ — CHỈ khi ô rỗng hoặc đang duyệt lịch sử, nếu không
              // sẽ cướp mất thao tác di chuyển con trỏ trong đoạn nhiều dòng.
              if ((e.key === 'ArrowUp' || e.key === 'ArrowDown')
                  && (!text.trim() || histAt.current >= 0)) {
                if (histNav(e.key === 'ArrowUp' ? 1 : -1)) { e.preventDefault(); return; }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault(); send();
              }
            }}
            ref={(el) => {
              inputRef.current = el;
              if (!el) return;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.35)) + 'px';
            }}
            placeholder="Nhắn cho Claude…"
            /* dark:bg-transparent BẮT BUỘC: component Textarea gốc có sẵn
               `dark:bg-input/30`, mà biến thể dark thắng `bg-transparent` thường —
               nên ở giao diện tối ô gõ vẫn nổi một mảng xám giữa khung mono, nhìn ra
               ô nhập của app chứ không phải dòng lệnh. Terminal không có nền nào. */
            className="max-h-[35dvh] min-h-11 resize-none border-0 bg-transparent px-0 py-2.5 font-mono text-[16px] shadow-none focus-visible:ring-0 dark:bg-transparent" />
          {/* Nút gửi PHẲNG, không nền đặc. Terminal không có nút xanh nào cả — khối
              màu đặc trong khung mono trông như dán từ app khác vào. Chỉ tô màu chữ
              khi đã có gì để gửi; mờ đi chứ không biến mất, vì biến mất thì khung
              nhảy giật ngay lúc gõ ký tự đầu. */}
          <Button size="icon" variant="ghost" onClick={() => send()} title="Gửi tin nhắn"
            aria-label="Gửi tin nhắn"
            className={cn('tap44 size-8 shrink-0 rounded-lg transition-colors',
              text.trim() || att.length ? 'text-primary hover:text-primary' : 'text-muted-foreground/40')}
            disabled={!text.trim() && !att.length} data-testid="chat-send">
            <Send className="size-3.5" />
          </Button>
        </div>

        {/* DÒNG TRẠNG THÁI dưới ô gõ — Claude CLI luôn in một dòng như vậy.

            Trước đây dòng này chỉ nhắc phím tắt và bị `hidden sm:flex` ẩn HẲN trên
            điện thoại. Mà iPhone mới là nơi Vinh dùng chính, nên ở đó không thấy được
            chế độ quyền lẫn mức nghĩ đang bật — hai thứ quyết định Claude có tự sửa
            file hay không. Chúng nằm tít trên header, lẫn giữa các nút icon.

            Giờ: chế độ + mức nghĩ hiện Ở ĐÂY, ngay dưới chỗ gõ, mọi bề rộng. Phần
            nhắc phím tắt vẫn chỉ hiện từ sm trở lên — không có bàn phím cứng thì
            nhắc Shift+Enter là vô nghĩa. */}
        {/* Ngăn các mục bằng dấu `·` — đúng ký tự Claude CLI dùng, bắt được trong bản
            ghi PTY ("Enter to confirm · Esc to cancel"). Khoảng trắng trần thì các
            mục dính vào nhau, đọc ra một câu dài. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 font-mono text-[10.5px] text-muted-foreground/60 [&>span:not(:first-child)]:before:mr-1.5 [&>span:not(:first-child)]:before:text-muted-foreground/30 [&>span:not(:first-child)]:before:content-['·']"
          data-testid="input-hint">
          <PermSwitch perm={perm} compact testid="chat-perm" />
          <EffortSwitch effort={effort} compact />
          <span className="hidden sm:inline"><b className="font-semibold text-muted-foreground">Enter</b> gửi</span>
          <span className="hidden sm:inline"><b className="font-semibold text-muted-foreground">Shift+Enter</b> xuống dòng</span>
          <span className="hidden sm:inline"><b className="font-semibold text-muted-foreground">/</b> lệnh</span>
          <span className="hidden sm:inline"><b className="font-semibold text-muted-foreground">@</b> file</span>
          <span className="hidden sm:inline"><b className="font-semibold text-muted-foreground">!</b> bash</span>
          <span className="hidden sm:inline"><b className="font-semibold text-muted-foreground">#</b> ghi nhớ</span>
          {(h?.typing || h?.status === 'RUNNING') && (
            <span className="ml-auto text-status-error">
              <b className="font-semibold">Esc</b> dừng
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
