'use client';

import { useEffect, useRef, useState } from 'react';
import { ScrollText, Pause, Play, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Server đẩy mỗi dòng dưới dạng CHUỖI đã gắn sẵn tag: "[dev] listening on 7788"
// (xem agyLogPush trong src/server/index.js) — không phải object.
interface LogRes { next: number; lines: string[] }

const MAX_KEEP = 500;   // giữ 500 dòng gần nhất, cũ hơn thì bỏ để trang không phình

// Tô màu theo mức độ để lướt mắt là thấy ngay dòng hỏng, thay vì đọc từng dòng
function levelOf(s: string) {
  if (/\b(error|fail|failed|fatal|refused|denied|exception)\b/i.test(s)) return 'err';
  if (/\b(warn|warning|retry|retrying|timeout|slow)\b/i.test(s)) return 'warn';
  if (/\b(ok|ready|listening|started|success|connected)\b/i.test(s)) return 'ok';
  return 'plain';
}

const TONE: Record<string, string> = {
  err: 'text-status-error',
  warn: 'text-amber-500',
  ok: 'text-status-ok',
  plain: 'text-muted-foreground',
};

export function AgyLog() {
  const [lines, setLines] = useState<{ text: string; lv: string }[]>([]);
  const [live, setLive] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const since = useRef(0);
  const atBottom = useRef(true);

  useEffect(() => {
    if (!live) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await api<LogRes>('/api/agy/log?since=' + since.current);
        if (!alive || !r.lines?.length) { since.current = r?.next ?? since.current; return; }
        since.current = r.next;
        setLines((old) => {
          const add = r.lines.map((text) => ({ text, lv: levelOf(text) }));
          return [...old, ...add].slice(-MAX_KEEP);
        });
      } catch { /* mất mạng thì lượt sau thử lại */ }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(id); };
  }, [live]);

  // Chỉ tự cuộn khi người dùng ĐANG ở đáy — đang đọc lại log cũ mà bị giật xuống
  // thì rất khó chịu.
  useEffect(() => {
    const el = boxRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <Card className="gap-0 p-4" data-testid="agy-log">
      <div className="mb-3 flex items-center gap-2">
        <ScrollText className="size-4 text-muted-foreground" />
        <span className="text-[14px] font-semibold">Log thời gian thực</span>
        <span className="text-[12px] text-muted-foreground">{lines.length} dòng</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="tap44 size-7" data-testid="log-toggle"
            title={live ? 'Tạm dừng' : 'Chạy tiếp'} onClick={() => setLive((v) => !v)}>
            {live ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="tap44 size-7" title="Xoá màn hình"
            data-testid="log-clear" onClick={() => setLines([])}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div ref={boxRef} data-testid="agy-log-box"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="max-h-[260px] min-h-[120px] overflow-auto rounded-[10px] border border-border bg-background/60 p-2.5 font-mono text-[12px] leading-relaxed">
        {lines.length ? lines.map((l, i) => (
          <div key={i} className={cn('whitespace-pre-wrap break-words', TONE[l.lv])}>{l.text}</div>
        )) : (
          <p className="py-6 text-center text-muted-foreground">
            Chưa có log. Log chỉ ghi lại khi agy-proxy được bật từ dashboard —
            tiến trình chạy sẵn bên ngoài thì dashboard không đọc được đầu ra của nó.
          </p>
        )}
      </div>
    </Card>
  );
}
