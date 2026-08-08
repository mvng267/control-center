'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Render markdown trong bong bóng chat.
// react-markdown KHÔNG render HTML thô (không bật rehype-raw) nên an toàn XSS sẵn —
// không cần dompurify như bản cũ.
// Bảng và khối code phải cuộn ngang trong khung riêng, nếu không sẽ đội bong bóng
// rộng ra và làm vỡ layout ở 390px.

function CodeBlock({ text, lang }: { text: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative my-2">
      {lang && (
        <div className="mb-1 text-[10px] font-medium tracking-wide text-muted-foreground">
          {lang.toUpperCase()}
        </div>
      )}
      <button
        onClick={() => navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        })}
        className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <pre className="max-h-[320px] overflow-auto rounded-[10px] border border-border bg-background/60 px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('md-body', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
          h1: ({ children }) => <h1 className="mb-1.5 mt-3 text-[17px] font-bold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-1.5 mt-3 text-[15.5px] font-bold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-[14.5px] font-semibold first:mt-0">{children}</h3>,
          ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer"
              className="text-primary underline underline-offset-2">{children}</a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-primary/45 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          // bảng phải cuộn ngang trong khung riêng, không được đội bong bóng rộng ra
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-[10px] border border-border">
              <table className="w-full text-[12.5px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-border bg-muted/40">{children}</thead>,
          th: ({ children }) => <th className="px-2.5 py-1.5 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border-t border-border px-2.5 py-1.5 align-top">{children}</td>,
          code: ({ className: cls, children, ...props }) => {
            const text = String(children).replace(/\n$/, '');
            const lang = /language-(\w+)/.exec(cls || '')?.[1];
            // inline code: không có ngôn ngữ và không xuống dòng
            const inline = !cls && !text.includes('\n');
            if (inline) {
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12.5px]" {...props}>
                  {children}
                </code>
              );
            }
            return <CodeBlock text={text} lang={lang} />;
          },
          pre: ({ children }) => <>{children}</>,   // <code> đã tự bọc <pre> ở trên
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
