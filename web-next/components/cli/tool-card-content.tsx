'use client';

import { useState } from 'react';
import { Square, SquareCheck, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { imgUrl } from '@/lib/api';
import type { ToolPart } from './tool-card';

function loiQuyen(s: string): string {
  const t = s.trim();
  if (/^Contains command_substitution/i.test(t)) {
    return 'Lệnh có $(…) hoặc dấu backtick — cần bạn duyệt. Dashboard không hỏi quyền được, chạy tay hoặc đổi chế độ quyền sang "Tự sửa file".';
  }
  if (/requires approval/i.test(t)) {
    return 'Lệnh này cần bạn duyệt. Dashboard không hỏi quyền được — chạy tay trên máy, hoặc đổi chế độ quyền ở cuối khung chat.';
  }
  if (/have permission to use|not allowed/i.test(t)) {
    return 'Lệnh không nằm trong danh sách cho phép. Thêm vào `.claude/settings.local.json` hoặc chạy tay.';
  }
  return '';
}

const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  md: 'markdown',
  txt: '',
  log: '',
};

function langOf(summary: string) {
  const f = String(summary || '')
    .split(' ')[0]
    .split(':')[0];
  const ext = f.indexOf('.') > 0 ? (f.split('.').pop() || '').toLowerCase() : '';
  return EXT_LANG[ext] || '';
}

function KhoiChu({ nhan, text, error, lang }: { nhan: string; text: string; error?: boolean; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1">
      <div
        className={cn(
          'mb-1 flex items-center gap-1.5 text-[12px] font-semibold tracking-wide',
          error ? 'text-status-error' : 'text-muted-foreground/70'
        )}
      >
        {nhan}
        {lang && <span className="text-muted-foreground/50">{lang}</span>}
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            });
          }}
          className="ml-auto flex items-center gap-1 text-[12px] font-normal text-muted-foreground/60 hover:text-foreground"
        >
          <X className="size-3" />
          {copied ? 'đã chép' : 'chép'}
        </button>
      </div>
      <pre
        className={cn(
          'min-w-0 max-h-[220px] overflow-auto whitespace-pre border-l pl-3 text-[12px] leading-relaxed md:max-h-[300px]',
          error ? 'border-status-error/40 text-status-error/90' : 'border-border text-muted-foreground'
        )}
      >
        {text}
      </pre>
    </div>
  );
}

function KhoiDiff({ text }: { text: string }) {
  const lines = text.split('\n');
  let mode: 'del' | 'add' | '' = '';
  return (
    <div className="mt-1">
      <div className="mb-1 text-[12px] font-semibold tracking-wide text-muted-foreground/70">THAY ĐỔI</div>
      <pre className="min-w-0 max-h-[220px] overflow-auto border-l border-border text-[12px] leading-relaxed md:max-h-[300px] -mx-3 px-0">
        {lines.map((l, i) => {
          if (l === '--- old') {
            mode = 'del';
            return (
              <div key={i} className="w-max min-w-full px-3 text-[12px] font-semibold text-status-error">
                Trước
              </div>
            );
          }
          if (l === '+++ new') {
            mode = 'add';
            return (
              <div key={i} className="w-max min-w-full px-3 text-[12px] font-semibold text-status-ok">
                Sau
              </div>
            );
          }
          return (
            <div
              key={i}
              className={cn(
                'w-max min-w-full whitespace-pre px-3',
                mode === 'del' && 'bg-status-error/12 text-status-error',
                mode === 'add' && 'bg-status-ok/12 text-status-ok'
              )}
            >
              {l}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function ToolImage({ src, n, onZoom }: { src: string; n: number; onZoom: (s: string) => void }) {
  const [bad, setBad] = useState(false);
  if (bad) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-status-error">
        <X className="size-3.5" /> Không tải được ảnh {n}
      </div>
    );
  }
  return (
    <img
      data-testid="tool-image"
      src={src}
      alt={`ảnh kết quả ${n}`}
      loading="lazy"
      onError={() => setBad(true)}
      onClick={(e) => {
        e.stopPropagation();
        onZoom(src);
      }}
      className="max-h-[260px] max-w-full cursor-zoom-in rounded border border-border object-contain"
    />
  );
}

export function ImageZoom({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div
      data-testid="image-zoom"
      onClick={onClose}
      className="fixed inset-0 z-[140] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm"
    >
      <img src={src} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
      <button
        onClick={onClose}
        title="Đóng"
        className="absolute right-4 top-4 rounded-full border border-border bg-card p-2"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function ToolCardContent({
  part,
  sid,
  open,
}: {
  part: ToolPart;
  sid: string;
  open: boolean;
}) {
  const [zoom, setZoom] = useState<string | null>(null);
  const isDiff = part.name === 'Edit' && part.input.startsWith('--- old');
  const isErr = part.status === 'error';
  const soTodo = part.todos?.length || 0;
  const tt = { dong: [''], con: 0 }; // reuse tomTat result từ ToolCardResult

  if (!open) return null;

  return (
    <div className="min-w-0 pl-[18px]">
        {soTodo ? (
          <div className="mt-1 flex flex-col gap-0.5">
            {part.todos!.map((t, i) => (
              <div key={i} className="flex items-start gap-2">
                <span
                  className={cn(
                    'mt-[3px] shrink-0 select-none',
                    t.status === 'completed'
                      ? 'text-status-ok'
                      : t.status === 'in_progress'
                        ? 'text-primary'
                        : 'text-muted-foreground/60'
                  )}
                >
                  {t.status === 'completed' ? (
                    <SquareCheck className="size-3.5" />
                  ) : (
                    <Square className="size-3.5" />
                  )}
                </span>
                <span
                  className={cn(
                    t.status === 'completed' && 'text-muted-foreground line-through',
                    t.status === 'in_progress' && 'text-foreground',
                    t.status !== 'completed' && t.status !== 'in_progress' && 'text-muted-foreground'
                  )}
                >
                  {t.text}
                </span>
              </div>
            ))}
          </div>
        ) : part.input ? (
          isDiff ? (
            <KhoiDiff text={part.input} />
          ) : (
            <KhoiChu nhan="INPUT" text={part.input} lang={langOf(part.summary)} />
          )
        ) : null}

        {!soTodo && (part.result || part.status === 'ok' || isErr) && (
          <KhoiChu
            nhan={isErr ? 'LỖI' : 'KẾT QUẢ'}
            text={part.result || '(trống)'}
            error={isErr}
          />
        )}

        {!soTodo && isErr && !!loiQuyen(String(part.result || '')) && (
          <KhoiChu nhan="NGUYÊN VĂN" text={String(part.result)} error />
        )}

        {part.images?.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {part.images.map((_, idx) => (
              <ToolImage
                key={idx}
                src={imgUrl(`/api/toolimg/${sid}/${part.id}/${idx}`)}
                n={idx + 1}
                onZoom={setZoom}
              />
            ))}
          </div>
        )}

        {zoom && <ImageZoom src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
