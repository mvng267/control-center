'use client';

import { useEffect, useState } from 'react';
import { Send, Sparkles, Wand2, Loader2, ShieldCheck, Shield, ShieldAlert, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { PermSwitch } from './perm-switch';
import { JobsPanel, type Job } from './jobs-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Ô giao task mới — chức năng cốt lõi. Không có nó thì dashboard chỉ để XEM phiên cũ.

const MODES = [
  { id: '', label: 'Normal' },
  { id: 'research', label: 'Research' },
  { id: 'coding', label: 'Coding' },
  { id: 'creative', label: 'Creative' },
] as const;

const MODE_PREFIX: Record<string, string> = {
  research: 'Nghiên cứu kỹ, đối chiếu nhiều nguồn rồi mới kết luận. ',
  coding: 'Tập trung vào code: đọc kỹ codebase trước, giữ đúng quy ước sẵn có. ',
  creative: 'Ưu tiên phương án sáng tạo, đề xuất vài hướng khác nhau. ',
};

// 4 nấc quyền, khớp PERM_MODES ở server
const PERMS = [
  { id: 'acceptEdits', label: 'Tự sửa file', Icon: ShieldCheck, cls: 'text-status-ok border-status-ok/35' },
  { id: 'plan', label: 'Duyệt trước', Icon: ClipboardList, cls: 'text-primary border-primary/35' },
  { id: 'default', label: 'Hỏi quyền', Icon: Shield, cls: 'text-muted-foreground' },
  { id: 'bypassPermissions', label: 'Bỏ kiểm tra', Icon: ShieldAlert, cls: 'text-status-error border-status-error/40' },
] as const;

const PERM_TOAST: Record<string, string> = {
  acceptEdits: 'Claude tự sửa/tạo file được; lệnh nguy hiểm vẫn bị chặn',
  plan: 'Claude trình bày kế hoạch rồi chờ bạn bấm Duyệt mới làm',
  default: 'Claude KHÔNG tự sửa được file (sẽ báo chưa có quyền)',
  bypassPermissions: 'CẨN THẬN: bỏ qua MỌI kiểm tra quyền',
};

export function TaskBar({ perm, onOpen }: { perm?: string; onOpen: (sid: string) => void }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [permMode, setPermMode] = useState(perm || 'acceptEdits');

  // server là nguồn thật, nhưng đang đổi dở thì đừng để tick cũ kéo ngược
  useEffect(() => { if (perm && !busy) setPermMode(perm); }, [perm, busy]);

  const cyclePerm = async () => {
    const i = PERMS.findIndex((p) => p.id === permMode);
    const next = PERMS[(i + 1) % PERMS.length].id;
    setPermMode(next);
    setBusy(true);
    try {
      const r = await api<{ mode: string }>('/api/perm', { method: 'POST', body: JSON.stringify({ mode: next }) });
      if (r.mode) setPermMode(r.mode);
      toast(PERM_TOAST[next]);
    } catch { toast.error('Không đổi được chế độ quyền'); }
    setBusy(false);
  };

  const submit = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      const r = await api<{ sid?: string; error?: string }>('/api/task', {
        method: 'POST', body: JSON.stringify({ task: (MODE_PREFIX[mode] || '') + v }),
      });
      if (r.sid) {
        setText('');
        toast.success('Đã giao task — đang mở phiên');
        navigator.vibrate?.(20);
        onOpen(r.sid);
      } else toast.error('Lỗi: ' + (r.error || '?'));
    } catch { toast.error('Không giao được task'); }
    setBusy(false);
  };

  // Làm đẹp câu lệnh: gửi câu thô, Claude viết lại thành prompt rõ ràng hơn.
  // Chạy nền (oneshot) nên phải hỏi lại kết quả; server giữ 10 phút.
  const [enhancing, setEnhancing] = useState(false);
  const enhance = async () => {
    const v = text.trim();
    if (!v) return;
    setEnhancing(true);
    try {
      const r = await api<{ ok?: boolean; id?: string; error?: string }>('/api/enhance', {
        method: 'POST', body: JSON.stringify({ text: v }),
      });
      if (!r.ok || !r.id) { toast.error(r.error || 'Không gọi được'); return; }
      for (let i = 0; i < 40; i++) {
        await new Promise((s) => setTimeout(s, 1500));
        const o = await api<{ status: string; output: string }>('/api/oneshot/' + r.id).catch(() => null);
        if (!o || o.status === 'running') continue;
        if (o.status === 'done' && o.output.trim()) {
          // Claude hay bọc prompt trong rào ``` — bóc ra, không thì gửi đi
          // nguyên cả dấu rào.
          const clean = o.output.trim()
            .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
          setText(clean);
          toast.success('Đã viết lại — xem rồi bấm gửi');
          navigator.vibrate?.(12);
        } else toast.error('Viết lại thất bại');
        return;
      }
      toast.error('Chờ quá lâu, thử lại sau');
    } catch { toast.error('Lỗi mạng'); }
    finally { setEnhancing(false); }
  };


  return (
    <div className="shrink-0 border-t border-border bg-card/40 px-3 py-3"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
      data-testid="task-bar">
      <div className="mx-auto flex max-w-[1000px] flex-col gap-2">
        <div className="flex items-center gap-2">
          {/* chế độ */}
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-lg border border-border p-0.5"
            style={{ scrollbarWidth: 'none' }} data-testid="mode-seg">
            {MODES.map((m) => (
              <button key={m.id} onClick={() => setMode(m.id)} data-active={mode === m.id}
                className={cn(
                  'shrink-0 rounded-md px-2.5 py-1 text-[12.5px] transition-colors',
                  mode === m.id ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground',
                )}>
                {m.label}
              </button>
            ))}
          </div>
          {/* Công tắc quyền — CÙNG component với khung chat, để hai nơi không lệch
              nhau về nhãn lẫn cách đổi. */}
          <PermSwitch perm={perm} />
        </div>

        <div className="flex items-center gap-2">
          {/* Textarea chứ không phải input 1 dòng: sau khi bấm "làm đẹp câu lệnh",
              prompt trả về dài vài nghìn ký tự nhiều đoạn — ô 1 dòng thì không đọc
              nổi. Tự giãn theo nội dung, tối đa ~40% màn rồi mới cuộn.
              Enter gửi, Shift+Enter xuống dòng. */}
          <Textarea value={text} onChange={(e) => setText(e.target.value)} data-testid="task-input"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault(); submit();
              }
            }}
            ref={(el) => {
              if (!el) return;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
            }}
            placeholder="Giao task mới cho Claude…"
            className="max-h-[40dvh] min-h-11 resize-none py-2.5 text-[16px]" />
          <Button size="icon" variant="ghost" className="size-11 shrink-0" onClick={enhance}
            disabled={enhancing || !text.trim()} data-testid="enhance-btn"
            title="Nhờ Claude viết lại câu lệnh cho rõ ràng hơn">
            {enhancing ? <Loader2 className="size-[18px] animate-spin" /> : <Wand2 className="size-[18px]" />}
          </Button>
          <Button size="icon" className="size-11 shrink-0" onClick={submit} disabled={busy || !text.trim()}
            data-testid="task-send" title="Giao task">
            {busy ? <Sparkles className="size-4 animate-pulse" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
