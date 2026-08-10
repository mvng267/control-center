'use client';

import { useEffect, useRef, useState } from 'react';
import { FileCode2, CornerDownLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/* Gõ "@" trong ô chat -> gợi ý file trong thư mục của phiên, đúng như Claude CLI.
   Trước đây muốn nhắc tới một file thì phải tự gõ trọn đường dẫn, sai một ký tự là
   Claude đi tìm nhầm chỗ.

   Khác `/` ở chỗ "@" có thể đứng GIỮA câu ("sửa @chat-view.tsx cho tao"), nên phải
   dò từ vị trí con trỏ ngược về trước chứ không xét mỗi đầu chuỗi. */

/** Tìm token "@..." mà con trỏ đang đứng trong đó. null nếu không có. */
export function timMention(text: string, caret: number): { tu: number; q: string } | null {
  const truoc = text.slice(0, caret);
  const at = truoc.lastIndexOf('@');
  if (at < 0) return null;
  // "@" phải đứng đầu câu hoặc sau khoảng trắng — email a@b.com không tính
  if (at > 0 && !/\s/.test(truoc[at - 1])) return null;
  const q = truoc.slice(at + 1);
  if (/\s/.test(q)) return null;         // đã gõ qua khoảng trắng -> hết token
  return { tu: at, q };
}

export function MentionHint({
  items, active, onPick,
}: {
  items: string[];
  active: number;
  onPick: (f: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div data-testid="mention-hint"
      className="mb-2 max-h-[42dvh] overflow-y-auto rounded-[12px] border border-border bg-popover p-1 shadow-lg">
      {items.map((f, i) => {
        const cat = f.lastIndexOf('/');
        return (
          <button key={f} data-testid="mention-item" data-file={f}
            onMouseDown={(e) => { e.preventDefault(); onPick(f); }}   // giữ focus ở ô nhập
            className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
              i === active ? 'bg-accent' : 'hover:bg-accent/50')}>
            <FileCode2 className="size-3.5 shrink-0 text-tool-accent" />
            <span className="shrink-0 font-mono text-[13px] font-medium">{f.slice(cat + 1)}</span>
            {cat > 0 && (
              <span className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-muted-foreground">
                {f.slice(0, cat)}
              </span>
            )}
            {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
          </button>
        );
      })}
    </div>
  );
}

export function useMention(
  sid: string,
  text: string,
  onFill: (s: string, caret: number) => void,
  caretRef: { current: number },
) {
  const [items, setItems] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  // Mỗi lần gõ là một lượt hỏi server; giữ số thứ tự để kết quả về CHẬM của lần gõ
  // trước không đè lên kết quả mới hơn.
  const luot = useRef(0);

  useEffect(() => {
    const t = timMention(text, caretRef.current);
    if (!t || closed) { setItems([]); return; }
    const n = ++luot.current;
    const h = setTimeout(() => {
      api<{ ok: boolean; files: string[] }>(
        `/api/files?sid=${encodeURIComponent(sid)}&q=${encodeURIComponent(t.q)}`)
        .then((r) => { if (n === luot.current) { setItems(r.files || []); setActive(0); } })
        .catch(() => { if (n === luot.current) setItems([]); });
    }, 120);   // gõ nhanh thì gộp lại, khỏi bắn một request mỗi ký tự
    return () => clearTimeout(h);
  }, [sid, text, closed]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Esc đóng gợi ý cho token "@" HIỆN TẠI thôi. Nếu chỉ mở lại khi chuỗi hết sạch
     "@" thì gõ "@abc" -> Esc -> xoá -> gõ "@xyz" vẫn câm, vì chuỗi vẫn còn dấu @ của
     lần trước. Nhớ vị trí token lúc đóng, rời sang token khác là mở lại. */
  const dongTai = useRef<number>(-1);
  useEffect(() => {
    const t = timMention(text, caretRef.current);
    if (!t || t.tu !== dongTai.current) setClosed(false);
  }, [text]);   // eslint-disable-line react-hooks/exhaustive-deps

  const dien = (f: string) => {
    const t = timMention(text, caretRef.current);
    if (!t) return;
    const sau = text.slice(caretRef.current);
    const moi = text.slice(0, t.tu) + '@' + f + ' ';
    onFill(moi + sau, moi.length);
    setItems([]);
  };

  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!items.length) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % items.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); return true; }
    if (e.key === 'Escape') {
      e.preventDefault();
      dongTai.current = timMention(text, caretRef.current)?.tu ?? -1;
      setClosed(true);
      return true;
    }
    if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); dien(items[active]); return true; }
    return false;
  };

  return { items, active, onKeyDown, pick: dien };
}
