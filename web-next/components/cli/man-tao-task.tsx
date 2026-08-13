'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, Sparkles, Wand2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PermSwitch } from './perm-switch';
import { EffortSwitch } from './effort-switch';
import { Segmented } from '@/components/ui/segmented';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

/* MÀN GIAO TASK — nguyên một màn, không phải cái ô nhét dưới đáy danh sách.

   Ô cũ cao 1 dòng nằm chung với 4 nút chế độ + 2 công tắc quyền, tất cả chen trong
   ~110px dưới cùng. Trên iPhone gõ vào là bàn phím ảo bung lên che gần hết, không
   thấy mình đang gõ gì; mà giao task lại là việc CHÍNH của dashboard.

   Ở đây: ô gõ chiếm trọn chiều cao còn lại, các lựa chọn nằm rõ ràng bên dưới kèm
   giải thích, và có chỗ cho nút "viết lại câu lệnh" thay vì một icon 11px. */

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

// Nói rõ mỗi chế độ THÊM GÌ vào câu lệnh — trước đây chỉ có 4 chữ tiếng Anh trần,
// không ai đoán được bấm vào thì khác gì nhau.
const MODE_DESC: Record<string, string> = {
  '': 'Gửi nguyên câu bạn gõ, không thêm gì',
  research: 'Nhắc Claude đối chiếu nhiều nguồn trước khi kết luận',
  coding: 'Nhắc Claude đọc kỹ codebase và giữ quy ước sẵn có',
  creative: 'Nhắc Claude đề xuất vài hướng khác nhau',
};

export function ManTaoTask({
  perm, effort, onDong, onOpen,
}: {
  perm?: string;
  effort?: string;
  onDong: () => void;
  onOpen: (sid: string) => void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const oGo = useRef<HTMLTextAreaElement | null>(null);

  // Mở màn ra là gõ được ngay — không phải chạm thêm một lần nữa vào ô
  useEffect(() => { oGo.current?.focus(); }, []);

  // Esc đóng màn, giống mọi hộp thoại khác trong app
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDong(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDong]);

  const gui = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      const r = await api<{ sid?: string; error?: string }>('/api/task', {
        method: 'POST', body: JSON.stringify({ task: (MODE_PREFIX[mode] || '') + v }),
      });
      if (r.sid) {
        toast.success('Đã giao task — đang mở phiên');
        navigator.vibrate?.(20);
        onOpen(r.sid);      // mở thẳng phiên vừa tạo
        onDong();
      } else toast.error('Lỗi: ' + (r.error || '?'));
    } catch { toast.error('Không giao được task'); }
    setBusy(false);
  };

  /* Làm đẹp câu lệnh: gửi câu thô, Claude viết lại rõ ràng hơn. Chạy nền (oneshot)
     nên phải hỏi lại kết quả; server giữ 10 phút. */
  const vietLai = async () => {
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
          // Claude hay bọc prompt trong rào ``` — bóc ra, không thì gửi đi cả dấu rào
          const sach = o.output.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
          setText(sach);
          toast.success('Đã viết lại — xem rồi bấm gửi');
          navigator.vibrate?.(12);
        } else toast.error('Không viết lại được');
        return;
      }
      toast.error('Chờ quá lâu, thử lại');
    } catch { toast.error('Lỗi mạng'); }
    finally { setEnhancing(false); }
  };

  return (
    /* z-[100] để nằm trên thanh tab dưới (z-[95]) — nếu không thanh tab đè lên nút gửi */
    <div className="fixed inset-0 z-[100] flex flex-col bg-background" data-testid="man-tao-task">
      {/* đầu màn: quay lại + tiêu đề */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <Button variant="ghost" size="icon" className="tap44 size-9" onClick={onDong}
          data-testid="tao-task-dong" title="Đóng" aria-label="Đóng">
          <ArrowLeft className="size-4" />
        </Button>
        <span className="text-[14px] font-semibold">Giao task mới</span>
        <span className="ml-auto text-[11.5px] text-muted-foreground">Claude sẽ mở phiên mới</span>
      </div>

      {/* Ô gõ chiếm TRỌN chỗ còn lại. Đây là điểm khác căn bản so với ô 1 dòng cũ:
          viết dài, đọc lại, sửa — làm được hết mà không phải cuộn trong một ô tí hon. */}
      <div className="flex min-h-0 flex-1 p-3">
        <Textarea ref={oGo} value={text} onChange={(e) => setText(e.target.value)}
          data-testid="task-input"
          onKeyDown={(e) => {
            // ⌘/Ctrl+Enter gửi. KHÔNG dùng Enter trần: ở đây người ta viết đoạn dài
            // nhiều dòng, Enter phải là xuống dòng như mọi trình soạn thảo.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); gui(); }
          }}
          placeholder="Mô tả việc cần Claude làm…&#10;&#10;Ví dụ: đọc src/server/index.js rồi liệt kê các endpoint chưa có test"
          /* h-full: ô gõ LẤP ĐẦY chỗ còn lại thay vì dừng ở 40% rồi bỏ trống nửa màn.
             text-[16px] là bắt buộc trên iOS — nhỏ hơn thì Safari tự phóng to trang
             khi chạm vào ô, đẩy bố cục lệch hẳn. */
          className="h-full w-full resize-none border-0 bg-transparent p-0 text-[16px] leading-relaxed shadow-none focus-visible:ring-0" />
      </div>

      {/* chân màn: lựa chọn + nút gửi */}
      <div className="shrink-0 space-y-2.5 border-t border-border bg-card/40 p-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <div className="overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <Segmented items={MODES} value={mode as (typeof MODES)[number]['id']}
            onChange={(v) => setMode(v)} testid="mode-seg" size="sm" />
        </div>
        <p className="px-0.5 text-[11.5px] text-muted-foreground" data-testid="mode-desc">
          {MODE_DESC[mode] || MODE_DESC['']}
        </p>

        <div className="flex items-center gap-2">
          {/* Cùng component với khung chat để hai nơi không lệch nhãn lẫn cách đổi */}
          <PermSwitch perm={perm} />
          <EffortSwitch effort={effort} />

          <Button variant="outline" size="sm" className="tap44 ml-auto h-10 gap-1.5"
            onClick={vietLai} disabled={enhancing || !text.trim()} data-testid="enhance-btn"
            title="Nhờ Claude viết lại câu lệnh cho rõ ràng hơn">
            {enhancing ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            <span className="hidden sm:inline">Viết lại</span>
          </Button>
          <Button size="sm" className="tap44 h-10 gap-1.5 px-4" onClick={gui}
            disabled={busy || !text.trim()} data-testid="task-send">
            {busy ? <Sparkles className="size-4 animate-pulse" /> : <Send className="size-4" />}
            Giao task
          </Button>
        </div>
      </div>
    </div>
  );
}
