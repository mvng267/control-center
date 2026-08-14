'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Send, Check, Pencil, Copy, CheckCheck, ImagePlus, Loader2, Plus,
  Terminal, FileCode2, Zap, Brain, ChevronDown, FolderTree,
} from 'lucide-react';
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
import { DangChay, HoaClaude } from './dang-chay';
import { ThinkCard } from './think-card';
import { NoteLine, type NotePart } from './note-line';
import { AskCard } from './ask-card';
import { PlanCard } from './plan-card';
import { XemFile } from './xem-file';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { SheetDuoi, MucSheet } from '@/components/ui/sheet-duoi';
import { useCauHinh } from '@/lib/use-cauhinh';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* Bốn ký tự mở đầu mà Claude CLI hiểu. MỘT nguồn duy nhất cho cả hai cách bày: hàng
   nút trên máy tính và sheet trượt lên trên điện thoại. Hai bản riêng thì thêm chức
   năng mới lại quên một bên. */
const CHUC_NANG = [
  { k: '/', nhan: 'lệnh', Icon: Terminal, mo: 'Lệnh dựng sẵn của Claude CLI' },
  { k: '@', nhan: 'file', Icon: FileCode2, mo: 'Chèn đường dẫn file trong dự án' },
  { k: '!', nhan: 'bash', Icon: Zap, mo: 'Chạy thẳng một lệnh shell' },
  { k: '#', nhan: 'ghi nhớ', Icon: Brain, mo: 'Ghi vào trí nhớ dài hạn của Claude' },
] as const;

type TextPart = { t: 'text'; text: string };
type ThinkPart = { t: 'think'; text: string };
type Part = TextPart | ThinkPart | ToolPart | NotePart;

interface Msg {
  role: string; content: string; ts: string | null; parts?: Part[]; n?: number; sub?: boolean;
  /** mốc ĐẦU lượt — bất biến qua các vòng gộp, dùng làm React key */
  tsDau?: string | null;
}
interface Usage { turns: number; inTok: number; outTok: number; cacheRead: number; cacheWrite: number }
interface DuAnChat {
  ten: string; khoa: string; duongDan: string;
  repo: string; nhanh: string; conTonTai: boolean; laNhap: boolean;
}
interface History {
  messages: Msg[]; total: number; start: number; typing: boolean; status: string;
  title: string; error: string | null; awaiting: boolean;
  model: string | null;        // model ĐẶT RIÊNG cho phiên (null = theo model toàn cục)
  modelDaChay?: string | null; // model THẬT của lượt gần nhất, đọc từ .jsonl
  dangChay?: string;           // lệnh đang chạy dở, vd "Bash(npm test)"
  usage: Usage | null;
  duAn?: DuAnChat;   // dự án của phiên: tên thư mục thật, repo, nhánh, còn tồn tại không
  effort?: string;   // mức nghĩ của lượt gần nhất
  nhap?: string;   // chữ đang chảy ra của lượt hiện tại (bản nháp từ stdout)
}

/** claude-opus-5 -> Opus. Tên đầy đủ dài gấp ba mà không thêm thông tin nào ở mức
    xem lướt. `<synthetic>` là dòng lỗi API, không phải model thật -> bỏ. */
function gonModel(m?: string | null) {
  if (!m) return '';
  const x = String(m).replace(/^claude-/, '').replace(/-\d[\d-]*$/, '');
  if (x === '<synthetic>') return '';
  return x.charAt(0).toUpperCase() + x.slice(1);
}

/** 3.785.161 -> "3,8M" — số token thô dài quá, đọc lướt không kịp. */
function gonTok(n: number) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
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
  // Sheet chức năng (chỉ mở được trên điện thoại — nút mở có `sm:hidden`)
  const [sheet, setSheet] = useState(false);
  // Panel xem file phủ toàn màn — mở từ nút hàng 2 hoặc từ tên file trong thẻ tool
  const [moFile, setMoFile] = useState(false);
  const cauHinh = useCauHinh();
  // Thẻ tool nào đang mở — giữ ở ĐÂY chứ không trong từng thẻ, xem chú thích ở
  // tool-card.tsx. Khoá là tool_use_id nên bền qua mọi lần dựng lại cây.
  const [openTools, setOpenTools] = useState<Set<string>>(new Set());
  /* Lượt ĐANG GẬP. Khoá là `tsDau` (mốc đầu lượt) chứ KHÔNG phải chỉ số: cửa sổ chỉ
     giữ 30 tin cuối, phiên đang chạy thì tin mới đẩy tin cũ ra nên mọi chỉ số tụt đi
     một mỗi 2 giây — dùng chỉ số thì gập xong 2 giây sau tự mở lại (đúng lỗi đã gặp
     với thẻ tool và bảng câu hỏi). */
  const [gapLuot, setGapLuot] = useState<Set<string>>(new Set());
  const toggleLuot = (k: string) => setGapLuot((s) => {
    const n = new Set(s);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });
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

  /* Chiều cao khung ở lần vẽ trước — để bù lại phần bị cắt mất khi cửa sổ tin trượt. */
  const caoTruoc = useRef(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else {
      /* ĐANG ĐỌC LẠI Ở TRÊN. Server chỉ trả 30 tin gần nhất, nên mỗi lượt mới đến là
         tin cũ NHẤT bị đẩy ra khỏi mảng: khung co lại từ phía trên, mà scrollTop vẫn
         nguyên số cũ -> con trỏ cuộn trỏ sang đoạn chữ khác. Người dùng mô tả đúng cái này:
         "kéo lên quá thì nó dính trên cùng màn hình" — dính ở top=0 trong khi nội dung
         bên dưới cứ trượt đi.
         Đo thật trên phiên đang chạy, cuộn lên đầu rồi giữ nguyên 8 vòng poll:
         cao 2683 -> 2725 -> 2661, lượt đầu đổi từ "Bash(Tìm PUB" sang "Read(paths.t"
         sang "Read(updater" — 2/8 vòng trượt mất chỗ đang đọc.
         Bù lại đúng phần chênh: khung cao thêm bao nhiêu thì đẩy scrollTop xuống bấy
         nhiêu, chữ dưới mắt đứng yên. */
      const chenh = el.scrollHeight - caoTruoc.current;
      if (chenh && caoTruoc.current) el.scrollTop += chenh;
    }
    caoTruoc.current = el.scrollHeight;
    // Bám theo cả ĐỘ DÀI bản nháp: chữ chảy ra làm khung cao dần mà số lượt không
    // đổi, chỉ nghe groups.length thì con chữ mới trôi khỏi tầm nhìn.
  }, [groups.length, h?.typing, h?.nhap?.length]);

  /* Chèn ký tự mở đầu (`/`, `@`, `!`, `#`) rồi đưa con trỏ về ô gõ — bảng gợi ý tự
     bung ra theo ký tự đó. Thêm vào CUỐI chỗ đang gõ chứ không ghi đè: người ta có
     thể đã gõ dở rồi mới nhớ ra muốn chèn tên file. */
  const chen = (k: string) => {
    setText((t) => (t && !t.endsWith(' ') ? t + ' ' : t) + k);
    inputRef.current?.focus();
  };

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
      {/* Đầu trang HAI DÒNG. Trước đây chỉ có mỗi tiêu đề, còn model/trạng thái thì
          `hidden sm:inline-flex` nên trên iPhone không thấy gì cả — mở một phiên ra
          là mất sạch dữ kiện mà danh sách vừa hiện đầy đủ. Dòng 2 mang đúng bộ đó:
          dự án, repo + nhánh, model · mức nghĩ, token, số lượt. */}
      <div className="flex w-full shrink-0 flex-col gap-1 border-b border-border px-4 py-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <div className="flex items-center gap-2">
          {/* Nút back có VIỀN: trước chỉ là icon trần trên nền tối, nhìn không ra là
              bấm được — mà trên iPhone đây là đường DUY NHẤT quay lại danh sách vì
              thanh tab dưới đã ẩn khi vào chat. */}
          <Button variant="outline" size="icon" className="tap44 size-9 shrink-0" onClick={onBack}
            title="Quay lại danh sách" aria-label="Quay lại danh sách" data-testid="chat-back">
            <ArrowLeft className="size-4" />
          </Button>
          {/* Hoa Claude cạnh tên: xoay khi đang chạy, đứng yên mờ khi nghỉ. Nhìn một
              cái là biết phiên còn sống hay không, khỏi đọc chữ trạng thái. */}
          <HoaClaude chay={!!(h?.typing || h?.status === 'RUNNING')} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium" data-testid="chat-title" title={sid}>
            {h?.title || sid.slice(0, 8)}
          </span>
          <Badge variant="outline" className={cn('shrink-0 text-[10.5px]',
            h?.status === 'RUNNING' && 'border-status-ok/40 text-status-ok')}>{h?.status || '…'}</Badge>
          {/* Chế độ quyền + mức nghĩ chuyển XUỐNG dòng trạng thái dưới ô gõ, đúng chỗ
              Claude CLI in chúng. Để trên này thì lẫn giữa các nút icon, và trên iPhone
              còn bị đẩy khuất. */}
          <ChatToolbar sid={sid} title={h?.title || ''} model={h?.model ?? null} usage={h?.usage}
            onTitle={(t) => setH((x) => (x ? { ...x, title: t } : x))}
            onModel={(mo) => setH((x) => (x ? { ...x, model: mo } : x))} />
        </div>

        {/* MỘT dòng, cuộn ngang nếu chật — không cho xuống hàng. Đo trên iPhone
            390px: để flex-wrap thì nó tách thành 2 dòng, ăn 39px và đẩy khung chat
            từ 688px xuống 593px. Nội dung ở đây là phụ đề, không đáng đổi lấy gần
            100px vùng đọc. */}
        <div className="flex min-w-0 items-center gap-x-2.5 overflow-x-auto whitespace-nowrap pl-10 text-[11.5px] text-muted-foreground"
          style={{ scrollbarWidth: 'none' }}
          data-testid="chat-meta">
          {h?.duAn && (
            <span className="shrink-0 font-medium text-foreground/75" data-testid="chat-du-an">{h.duAn.ten}</span>
          )}
          {/* Repo GitHub khi có git; không thì đường dẫn — trả lời "phiên này chạy ở đâu" */}
          {!!(h?.duAn?.repo || h?.duAn?.duongDan) && (
            <span className="truncate" title={h?.duAn?.duongDan} data-testid="chat-repo">
              {h?.duAn?.repo ? h.duAn.repo + (h.duAn.nhanh ? ' · ' + h.duAn.nhanh : '') : h?.duAn?.duongDan}
            </span>
          )}
          {/* Thư mục gốc đã xoá -> --resume trượt, tin nhắn RƠI VÀO HƯ KHÔNG. Phải
              báo TRƯỚC khi gõ, không phải sau khi gửi mà không thấy gì xảy ra. */}
          {h?.duAn && !h.duAn.conTonTai && (
            <span data-testid="chat-mat" title="Thư mục gốc đã bị xoá — nhắn vào phiên này sẽ không tới nơi"
              className="shrink-0 rounded-md bg-status-error/12 px-1.5 py-px text-[10.5px] font-medium text-status-error">
              thư mục đã xoá
            </span>
          )}
          {/* Hiện model ĐÃ CHẠY THẬT (đọc từ .jsonl) — đúng cả với phiên chạy từ
              terminal. `h.model` là model đặt riêng cho phiên, thường null, nên dùng
              nó ở đây thì hầu như không bao giờ hiện được gì. Có đặt riêng thì ưu tiên,
              vì đó là thứ lượt SAU sẽ chạy. */}
          {!!(h?.model || h?.modelDaChay) && (
            <span className="shrink-0 text-tool-accent" data-testid="chat-model"
              title={(h.model || h.modelDaChay || '') + (h.effort ? ' · mức nghĩ ' + h.effort : '')}>
              {gonModel(h.model || h.modelDaChay)}{h.effort ? ' · ' + h.effort : ''}
            </span>
          )}
          {/* Số lượt ẩn trên màn hẹp: ít quan trọng nhất trong hàng này, mà danh
              sách phiên đã hiện sẵn. Nhường chỗ cho repo + model. */}
          {!!h?.usage?.turns && (
            <span className="hidden shrink-0 tabular-nums sm:inline" data-testid="chat-luot">{h.usage.turns} lượt</span>
          )}
          {!!h?.usage && (
            <span className="shrink-0 tabular-nums" data-testid="chat-tok"
              title={((h.usage.inTok || 0) + (h.usage.outTok || 0)).toLocaleString('vi-VN') + ' token'}>
              {gonTok((h.usage.inTok || 0) + (h.usage.outTok || 0))}
            </span>
          )}
        </div>
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
              <div data-testid="msg-wrap" data-role={m.role}
                data-gap={gapLuot.has(m.tsDau || m.ts || '')}
                className="flex w-full flex-col border-t border-border/50 pt-1.5">
                {/* DÒNG TIÊU ĐỀ LƯỢT — vùng bấm gập DUY NHẤT.
                    Không cho bấm cả lượt: bên trong đã có 5 thứ bấm được (thẻ tool,
                    bảng chọn, thẻ kế hoạch, nút chép, dòng ghi chú), bấm cả khối thì
                    nuốt hết chúng.
                    Giờ + nút chép chuyển từ góc phải tuyệt đối lên đây, nên thân lượt
                    dùng được TRỌN bề rộng (trước phải chừa pr-12). */}
                {(() => {
                  const khoa = m.tsDau || m.ts || '';
                  const gap = gapLuot.has(khoa);
                  const soTool = parts.filter((p) => p.t === 'tool').length;
                  const tomTat = parts.find((p) => p.t === 'text') as TextPart | undefined;
                  return (
                    <>
                      <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground/70">
                        <button type="button" data-testid="luot-gap"
                          onClick={() => toggleLuot(khoa)}
                          title={gap ? 'Mở lượt này' : 'Gập lượt này'}
                          /* KHÔNG dùng .tap44 ở đây: lớp phủ của nó cao tối thiểu
                             44px, mà dòng này chỉ ~20px nên vùng chạm TRÀN LÊN lượt
                             bên trên và che mất nút gập của lượt đó (Playwright báo
                             "element intercepts pointer events"). Nới bằng đệm thật:
                             py-2 cho ~36px, đủ ngón tay mà không đè hàng xóm. */
                          className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-2 text-left transition-colors hover:text-foreground">
                          <ChevronDown className={cn('size-3 shrink-0 transition-transform',
                            gap && '-rotate-90')} />
                          <span className={cn('shrink-0 font-medium',
                            m.role === 'user' ? 'text-primary' : 'text-tool-accent')}>
                            {m.role === 'user' ? '❯ ' + cauHinh.nguoiDung : '⏺ Claude'}
                          </span>
                          {m.ts && <span className="shrink-0 tabular-nums">{clock(m.ts)}</span>}
                          {!!soTool && <span className="shrink-0">· {soTool} thẻ</span>}
                          {/* Gập rồi thì phải biết bên trong là gì mới quyết định có mở.
                              Một lượt gộp tới 2 phút hội thoại (GROUP_GAP_MS) nên có
                              thể rất dài — gập mà không có mồi thì màn hình trống trơn,
                              không biết vừa giấu cái gì. */}
                          {gap && !!tomTat?.text && (
                            <span className="min-w-0 truncate opacity-70">· {tomTat.text.slice(0, 60)}</span>
                          )}
                        </button>
                        {m.sub && (
                          <span data-testid="msg-sub" className="shrink-0 text-[10px] text-tool-accent">sub</span>
                        )}
                        <span className="shrink-0 opacity-45 transition-opacity hover:opacity-100">
                          <CopyTurn parts={parts} />
                        </span>
                      </div>
                      {gap && null}
                    </>
                  );
                })()}

                {!gapLuot.has(m.tsDau || m.ts || '') && parts.map((p, i) =>
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
      {(h?.typing || h?.status === 'RUNNING') && (
        <DangChay onStop={stop} lenh={h?.dangChay} />
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

      <div className="w-full shrink-0 border-t border-border px-3 py-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <SlashHint items={slash.items} active={slash.active} onPick={slash.pick} />
        <MentionHint items={mention.items} active={mention.active} onPick={mention.pick} />
        <ModeHint che={docChe(text)} />
        <AttachBar items={att} onRemove={(i) => setAtt((xs) => xs.filter((_, k) => k !== i))} />
        {/* KHÔNG kẻ đường ngang phía trên ô gõ nữa.
            Bản trước bắt chước Claude CLI: `border-t-2 pt-2` đổi màu theo chế độ đang
            gõ. Nhưng trên iPhone nó ăn 10px của vùng đọc chat mà chỉ nói lại đúng thứ
            dấu nhắc `❯`/`!`/`#` ngay bên cạnh đã nói — và dấu nhắc ĐỔI MÀU y hệt.
            Bỏ đường kẻ, giữ dấu nhắc: mất 0 thông tin, lãi 10px.
            Nút ảnh cũng rời hàng này — nó nằm trong sheet chức năng (mobile) / hàng 2
            (desktop), để hàng 1 chỉ còn đúng việc nhắn tin. */}
        <div className="flex items-center gap-2">
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
          {/* title mang luôn phần nhắc phím tắt đã bỏ khỏi hàng dưới */}
          <Button size="icon" variant="ghost" onClick={() => send()}
            title="Gửi tin nhắn — Enter gửi, Shift+Enter xuống dòng"
            aria-label="Gửi tin nhắn"
            className={cn('tap44 size-8 shrink-0 rounded-lg transition-colors',
              text.trim() || att.length ? 'text-primary hover:text-primary' : 'text-muted-foreground/40')}
            disabled={!text.trim() && !att.length} data-testid="chat-send">
            <Send className="size-3.5" />
          </Button>
        </div>

        {/* DÒNG TRẠNG THÁI dưới ô gõ — Claude CLI luôn in một dòng như vậy.

            Trước đây dòng này chỉ nhắc phím tắt và bị `hidden sm:flex` ẩn HẲN trên
            điện thoại. Mà iPhone mới là nơi dùng chính, nên ở đó không thấy được
            chế độ quyền lẫn mức nghĩ đang bật — hai thứ quyết định Claude có tự sửa
            file hay không. Chúng nằm tít trên header, lẫn giữa các nút icon.

            Giờ: chế độ + mức nghĩ hiện Ở ĐÂY, ngay dưới chỗ gõ, mọi bề rộng. Phần
            nhắc phím tắt vẫn chỉ hiện từ sm trở lên — không có bàn phím cứng thì
            nhắc Shift+Enter là vô nghĩa. */}
        {/* Ngăn các mục bằng dấu `·` — đúng ký tự Claude CLI dùng, bắt được trong bản
            ghi PTY ("Enter to confirm · Esc to cancel"). Khoảng trắng trần thì các
            mục dính vào nhau, đọc ra một câu dài. */}
        {/* HÀNG 2 — nút chức năng bên trái, chế độ + model GHIM bên phải.
            Trước đây có HAI hàng: một hàng chữ nhắc (chế độ, Enter gửi…) và một hàng
            nút. Gộp lại còn một, bỏ 18px mà không mất chức năng nào:
            `Enter gửi` / `Shift+Enter` chuyển thành title của nút gửi — iPhone không
            có bàn phím cứng nên hai nhắc đó vốn vô nghĩa ở đó.
            Bên trái cuộn ngang khi chật; bên phải `shrink-0` nên chế độ quyền và
            model KHÔNG BAO GIỜ bị cuộn mất — đó là hai thứ quyết định Claude có tự
            sửa file hay không, phải luôn nhìn thấy. */}
        <div className="mt-1.5 flex items-center gap-2 px-1 pb-0.5" data-testid="goi-y">
          {/* ĐIỆN THOẠI: một nút "Chức năng" mở sheet trượt lên.
              Bản trước bày cả 4 nút trên một hàng cuộn ngang ở 390px: chỉ nhìn thấy
              hai nút rưỡi, `#ghi nhớ` nằm hẳn ngoài màn — muốn dùng phải biết trước
              là có rồi vuốt đi tìm. Một nút mở sheet thì mọi chức năng đều nhìn thấy
              cùng lúc, kèm mô tả, và ngón cái với tới được ngay đáy màn. */}
          <button type="button" data-testid="mo-chuc-nang" onClick={() => setSheet(true)}
            className="tap44 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground active:scale-95 sm:hidden">
            <Plus className="size-3.5 opacity-70" />
            Chức năng
          </button>

          {/* MÁY TÍNH: đủ bề ngang thì bày thẳng, không bắt bấm thêm một lần */}
          <div className="hidden min-w-0 flex-1 items-center gap-1.5 overflow-x-auto sm:flex"
            style={{ scrollbarWidth: 'none' }}>
            {CHUC_NANG.map(({ k, nhan, Icon }) => (
              <button key={k} type="button" data-testid={'goi-y-' + nhan}
                onClick={() => chen(k)}
                className="tap44 inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground active:scale-95">
                <Icon className="size-3 opacity-70" />
                <b className="font-semibold text-foreground/80">{k}</b>
                {/* Giữ nhãn ở MỌI bề rộng: chỉ mỗi ký tự `#` thì không ai đoán ra
                    nó làm gì. Hàng này cuộn ngang được nên chật cũng không vỡ. */}
                <span className="font-sans">{nhan}</span>
              </button>
            ))}
            {/* Nút ảnh rời khỏi hàng 1 (hàng 1 chỉ để nhắn tin) về đây */}
            <AttachButton onAttach={(a) => setAtt((xs) => [...xs, a])} />
            {/* Xem file: KHÁC nút `@file` bên cạnh — `@` chèn đường dẫn vào tin nhắn
                cho Claude đọc, nút này mở panel để CHÍNH MÌNH đọc mã. */}
            <button type="button" data-testid="goi-y-xem-file" onClick={() => setMoFile(true)}
              className="tap44 inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground active:scale-95">
              <FolderTree className="size-3 opacity-70" />
              xem file
            </button>
          </div>

          {/* Ghim phải — không cuộn mất. `ml-auto` cho trường hợp điện thoại: bên
              trái chỉ còn một nút nhỏ, không có khối flex-1 nào đẩy hộ. */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/70">
            <PermSwitch perm={perm} compact testid="chat-perm" />
            <EffortSwitch effort={effort} compact />
          </div>
        </div>

        {/* Sheet chức năng — chỉ mở từ nút bên trên, tức chỉ trên điện thoại */}
        <SheetDuoi mo={sheet} onDong={() => setSheet(false)} tieuDe="Chức năng"
          testid="sheet-chuc-nang">
          {CHUC_NANG.map(({ k, nhan, Icon, mo }) => (
            <MucSheet key={k} Icon={Icon} nhan={nhan} mo={mo} ky={k}
              testid={'sheet-' + nhan}
              onClick={() => { setSheet(false); chen(k); }} />
          ))}
          <AttachButton onAttach={(a) => setAtt((xs) => [...xs, a])}
            render={(moChon, busy) => (
              <MucSheet Icon={busy ? Loader2 : ImagePlus} nhan="Đính kèm ảnh"
                mo={busy ? 'Đang tải lên…' : 'Chụp hoặc chọn ảnh từ máy'}
                testid="sheet-anh"
                onClick={() => { if (!busy) { setSheet(false); moChon(); } }} />
            )} />
          <MucSheet Icon={FolderTree} nhan="Xem file" mo="Đọc mã nguồn trong thư mục dự án"
            testid="sheet-xem-file"
            onClick={() => { setSheet(false); setMoFile(true); }} />
        </SheetDuoi>
      </div>

      {/* Panel xem file — phủ toàn màn (fixed inset-0), nằm ngoài khu nhập để bàn phím
          iPhone bật lên không đẩy nó lệch. */}
      {moFile && <XemFile sid={sid} onClose={() => setMoFile(false)} />}
    </div>
  );
}
