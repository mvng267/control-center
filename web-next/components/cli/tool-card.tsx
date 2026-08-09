'use client';

import { useEffect, useState } from 'react';
import {
  Terminal, FileText, FilePen, FilePlus, Search, Bot, ListChecks, Globe,
  Sparkles, Plug, Wrench, ChevronDown, Check, X, Circle, Minus, Copy,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ToolPart {
  t: 'tool';
  id: string;
  name: string;
  disp: string;
  summary: string;
  input: string;
  status: 'ok' | 'error' | 'running' | 'pending';
  result: string;
  images: { i: number; mt: string; bytes: number }[];
  // Server gửi {text, status} (extractTodos ở src/server/tools.js) — trước đây khai
  // là `content` nên checklist hiện ra TRỐNG TRƠN, chỉ thấy dấu ○ không có chữ.
  todos?: { text: string; status: string }[];
}

function iconFor(name: string) {
  if (name.startsWith('mcp__')) return Plug;
  const map: Record<string, typeof Terminal> = {
    Bash: Terminal, BashOutput: Terminal, KillShell: Terminal,
    Read: FileText, Edit: FilePen, MultiEdit: FilePen, NotebookEdit: FilePen,
    Write: FilePlus, Grep: Search, Glob: Search, ToolSearch: Search,
    Task: Bot, Agent: Bot, TodoWrite: ListChecks,
    WebFetch: Globe, WebSearch: Globe, Skill: Sparkles,
  };
  return map[name] || Wrench;
}

const STATUS = {
  ok: { Icon: Check, cls: 'text-status-ok', tip: 'Thành công' },
  error: { Icon: X, cls: 'text-status-error', tip: 'Lỗi' },
  running: { Icon: Circle, cls: 'text-status-run', tip: 'Đang chạy…' },
  pending: { Icon: Minus, cls: 'text-muted-foreground/60', tip: 'Không có kết quả (bị ngắt)' },
} as const;

function CodeBlock({ label, text, error, lang }: { label: string; text: string; error?: boolean; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="px-3 pb-2.5">
      <div className={cn('mb-1 flex items-center gap-1.5 text-[10px] font-semibold tracking-wide',
        error ? 'text-status-error' : 'text-muted-foreground')}>
        {label}
        {lang && <span className="rounded bg-primary/12 px-1.5 py-px text-[9.5px] font-medium text-primary">{lang}</span>}
      </div>
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
          className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Copy className="size-3" />
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <pre className={cn(
          'max-h-[200px] overflow-auto whitespace-pre rounded-[10px] border bg-background/60 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed md:max-h-[260px]',
          error ? 'border-status-error/30' : 'border-border',
        )}>
          {text}
        </pre>
      </div>
    </div>
  );
}

// Edit hiện dạng diff: dòng thêm xanh, dòng bớt đỏ — dễ đọc hơn khối chữ xám phẳng
function DiffBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  let mode: 'del' | 'add' | '' = '';
  return (
    <div className="px-3 pb-2.5">
      <div className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground">THAY ĐỔI</div>
      <pre className="max-h-[200px] overflow-auto rounded-[10px] border border-border bg-background/60 py-1 font-mono text-[12.5px] leading-relaxed md:max-h-[260px]">
        {lines.map((l, i) => {
          if (l === '--- old') { mode = 'del'; return <div key={i} className="bg-status-error/10 px-3 py-0.5 text-[10px] font-semibold text-status-error">Trước</div>; }
          if (l === '+++ new') { mode = 'add'; return <div key={i} className="bg-status-ok/10 px-3 py-0.5 text-[10px] font-semibold text-status-ok">Sau</div>; }
          return (
            <div key={i} className={cn('whitespace-pre px-3',
              mode === 'del' && 'bg-status-error/[0.07] shadow-[inset_2px_0_0_var(--status-error)]',
              mode === 'add' && 'bg-status-ok/[0.07] shadow-[inset_2px_0_0_var(--status-ok)]')}>
              {l}
            </div>
          );
        })}
      </pre>
    </div>
  );
}


/* Nhãn ngôn ngữ theo đuôi file — port EXT_LANG/langOf (web/legacy/js/chat.js:117-128).
   Prop `lang` của CodeBlock vốn đã có nhưng KHÔNG AI TRUYỀN, tức là code chết:
   khối input của Read/Edit mất nhãn ngôn ngữ mà bản cũ vẫn hiện. */
const EXT_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', html: 'html', css: 'css',
  scss: 'scss', sql: 'sql', md: 'markdown', txt: '', log: '',
};
function langOf(summary: string) {
  const f = String(summary || '').split(' ')[0].split(':')[0];
  const ext = f.indexOf('.') > 0 ? (f.split('.').pop() || '').toLowerCase() : '';
  return EXT_LANG[ext] || '';
}

/* Ảnh trong kết quả tool. Trước đây bấm vào là `window.open` -> trên PWA đã "Thêm vào
   màn hình chính" thì nó BUNG RA trình duyệt ngoài, mất ngữ cảnh app. Và ảnh hỏng thì
   hiện icon vỡ câm lặng. Giờ mở overlay trong app + báo lỗi rõ ràng. */
function ToolImage({ src, n, onZoom }: { src: string; n: number; onZoom: (s: string) => void }) {
  const [bad, setBad] = useState(false);
  if (bad) {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-dashed border-status-error/40 px-3 py-2 text-[12px] text-status-error">
        <X className="size-3.5" /> Không tải được ảnh {n}
      </div>
    );
  }
  return (
    <img data-testid="tool-image" src={src} alt={`ảnh kết quả ${n}`} loading="lazy"
      onError={() => setBad(true)}
      onClick={(e) => { e.stopPropagation(); onZoom(src); }}
      className="max-h-[260px] max-w-full cursor-zoom-in rounded-[10px] border border-border object-contain" />
  );
}

// Overlay xem ảnh toàn màn — Esc hoặc chạm nền để đóng (bản cũ có, bản mới mất)
export function ImageZoom({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div data-testid="image-zoom" onClick={onClose}
      className="fixed inset-0 z-[140] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm">
      <img src={src} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
      <button onClick={onClose} title="Đóng"
        className="absolute right-4 top-4 rounded-full border border-border bg-card p-2">
        <X className="size-4" />
      </button>
    </div>
  );
}

/* Trạng thái mở/đóng do CHA giữ, khoá theo tool_use_id.
   Trước đây để useState ở đây: cứ 700ms poll một lần là React dựng lại cây, state cục
   bộ mất theo -> đang đọc kết quả lệnh thì thẻ TỰ ĐÓNG sau ~3 giây. Đo được:
   "vừa bấm mở: true -> sau 3s: false". Bản legacy không dính vì nó không rebuild DOM
   (reconcileToolStatus ở web/legacy/js/chat.js:555). */
export function ToolCard({ part, sid, open, onToggle }: {
  part: ToolPart; sid: string;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const setOpen = () => onToggle(part.id);
  const [zoom, setZoom] = useState<string | null>(null);
  const Icon = iconFor(part.name);
  const st = STATUS[part.status] || STATUS.pending;
  const isDiff = part.name === 'Edit' && part.input.startsWith('--- old');
  const isErr = part.status === 'error';

  return (
    <div
      data-testid="tool-card"
      data-status={part.status}
      data-tid={part.id}
      data-open={open}
      className={cn(
        'overflow-hidden rounded-xl border bg-card transition-colors',
        isErr ? 'border-status-error/55 bg-status-error/[0.06] shadow-[inset_3px_0_0_var(--status-error)]'
          : part.status === 'running' ? 'border-status-run/45 shadow-[inset_3px_0_0_var(--status-run)]'
            : 'border-border',
      )}
    >
      <button
        data-testid="tool-card-head"
        onClick={() => { setOpen(); navigator.vibrate?.(10); }}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors md:hover:bg-accent/40"
      >
        <Icon className="size-3.5 shrink-0 text-tool-accent" />
        <span className="shrink-0 truncate font-semibold" style={{ maxWidth: '52%' }} title={part.name}>
          {part.disp || part.name}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground" title={part.summary}>
          {part.summary}
        </span>
        <span data-testid="tool-card-status" className={cn('shrink-0', st.cls)} title={st.tip}>
          <st.Icon className={part.status === 'running' ? 'size-2.5 fill-current' : 'size-3.5'} />
        </span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {/* grid 0fr->1fr: transition mở/đóng MỘT LẦN 200ms, không phải keyframe lặp (RULES) */}
      <div className={cn('grid transition-[grid-template-rows] duration-200', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="min-h-0 overflow-hidden">
          {open && (
            <>
              {part.todos?.length ? (
                <div className="px-3 pb-2.5">
                  {/* Đếm + thanh tiến độ như bản cũ (chat.js:332-368). Và `in_progress`
                      phải có icon RIÊNG — trước đây nó hiện y hệt việc chưa làm, nhìn
                      không biết Claude đang ở bước nào. */}
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[10px] font-semibold tracking-wide text-muted-foreground">CÔNG VIỆC</span>
                    <span className="text-[10.5px] tabular-nums text-muted-foreground">
                      {part.todos.filter((t) => t.status === 'completed').length}/{part.todos.length}
                    </span>
                    <span className="ml-auto h-1 w-20 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-status-ok transition-[width] duration-500"
                        style={{ width: Math.round(part.todos.filter((t) => t.status === 'completed').length
                          / part.todos.length * 100) + '%' }} />
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {part.todos.map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-[12.5px]">
                        <span className={cn('mt-0.5 shrink-0',
                          t.status === 'completed' ? 'text-status-ok'
                            : t.status === 'in_progress' ? 'text-primary' : 'text-muted-foreground')}>
                          {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◈' : '○'}
                        </span>
                        <span className={cn(
                          t.status === 'completed' && 'text-muted-foreground line-through',
                          t.status === 'in_progress' && 'font-medium text-foreground')}>
                          {t.text}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : part.input ? (
                isDiff ? <DiffBlock text={part.input} /> : <CodeBlock label="INPUT" text={part.input} lang={langOf(part.summary)} />
              ) : null}

              {(part.result || part.status === 'ok' || isErr) && (
                <CodeBlock label={isErr ? 'LỖI' : 'KẾT QUẢ'} text={part.result || '(trống)'} error={isErr} />
              )}

              {part.images?.length > 0 && (
                <div className="px-3 pb-2.5">
                  <div className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
                    {part.images.length > 1 ? `${part.images.length} ẢNH` : 'ẢNH'}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {part.images.map((_, idx) => (
                      <ToolImage key={idx} src={`/api/toolimg/${sid}/${part.id}/${idx}`} n={idx + 1}
                        onZoom={setZoom} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {zoom && <ImageZoom src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
