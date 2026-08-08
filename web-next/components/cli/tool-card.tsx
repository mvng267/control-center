'use client';

import { useState } from 'react';
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
  todos?: { content: string; status: string }[];
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

export function ToolCard({ part, sid }: { part: ToolPart; sid: string }) {
  const [open, setOpen] = useState(false);
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
        onClick={() => { setOpen((o) => !o); navigator.vibrate?.(10); }}
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
                  <div className="mb-1 text-[10px] font-semibold tracking-wide text-muted-foreground">CÔNG VIỆC</div>
                  <div className="flex flex-col gap-1">
                    {part.todos.map((t, i) => (
                      <div key={i} className="flex items-start gap-2 text-[12.5px]">
                        <span className={cn('mt-0.5 shrink-0',
                          t.status === 'completed' ? 'text-status-ok' : 'text-muted-foreground')}>
                          {t.status === 'completed' ? '✓' : '○'}
                        </span>
                        <span className={t.status === 'completed' ? 'text-muted-foreground line-through' : ''}>
                          {t.content}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : part.input ? (
                isDiff ? <DiffBlock text={part.input} /> : <CodeBlock label="INPUT" text={part.input} />
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
                      <img
                        key={idx}
                        data-testid="tool-image"
                        src={`/api/toolimg/${sid}/${part.id}/${idx}`}
                        alt={`ảnh kết quả ${idx + 1}`}
                        loading="lazy"
                        className="max-h-[260px] max-w-full cursor-zoom-in rounded-[10px] border border-border object-contain"
                        onClick={(e) => { e.stopPropagation(); window.open((e.target as HTMLImageElement).src, '_blank'); }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
