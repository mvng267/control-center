'use client';

import { useRef, useState } from 'react';
import { Download, Coins, Pencil, Gauge, X, MoreHorizontal, ImagePlus, Loader2, Braces, ClipboardCopy, FileText, Images } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { AnhPhien } from './anh-phien';
import { EffortSwitch } from './effort-switch';

export interface Attachment { path: string; name: string; thumb: string }

// Ảnh iPhone 12MP ~5MB: gửi thẳng thì nghẽn qua Tailscale. Thu nhỏ cạnh dài về 1600px,
// JPEG 0.85 — vẫn đủ nét để Claude đọc chữ trong ảnh chụp màn hình.
function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('không đọc được'));
    fr.onload = () => {
      const img = new window.Image();
      img.onerror = () => resolve(fr.result as string);   // HEIC… -> gửi nguyên bản
      img.onload = () => {
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const src = fr.result as string;
        if (scale === 1 && src.length < 3e6) return resolve(src);
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d')?.drawImage(img, 0, 0, cv.width, cv.height);
        try { resolve(cv.toDataURL('image/jpeg', 0.85)); } catch { resolve(src); }
      };
      img.src = fr.result as string;
    };
    fr.readAsDataURL(file);
  });
}

/* Thu nhỏ -> tải lên -> trả về thẻ đính kèm. Dùng chung cho CẢ BA đường vào ảnh:
   bấm nút, dán từ clipboard, kéo-thả. Trước logic này nằm trong AttachButton nên chỉ
   nút mới dùng được. Trả null khi hỏng (đã báo toast tại chỗ). */
export async function taiAnhLen(f: File): Promise<Attachment | null> {
  if (!f.type.startsWith('image/')) { toast.error('Chỉ gửi được ảnh'); return null; }
  try {
    const data = await shrink(f);
    const r = await api<{ ok: boolean; path: string; error?: string }>('/api/upload', {
      method: 'POST', body: JSON.stringify({ data }),
    });
    if (!r.ok) { toast.error('Gửi ảnh lỗi: ' + (r.error || '?')); return null; }
    navigator.vibrate?.(10);
    return { path: r.path, name: f.name || 'ảnh', thumb: data };
  } catch { toast.error('Không đọc được ảnh'); return null; }
}

/* Nút đính kèm ảnh — tách riêng để đặt CẠNH ô nhắn tin (soạn tin ở đâu thì nút ở đó),
   thay vì nằm chung với nhóm nút quản lý phiên trên header. */
export function AttachButton({ onAttach, render }: {
  onAttach: (a: Attachment) => void;
  /* Cho chỗ gọi tự vẽ nút. Cần vì đính ảnh giờ xuất hiện ở BA nơi khác kiểu nhau:
     nút icon ở hàng 2 (desktop), một dòng trong sheet chức năng (điện thoại), và một
     nút có chữ ở màn giao task. Nhân bản logic tải ảnh ra ba bản là ba nơi lệch nhau
     lúc nào không biết — chỉ phần VẼ khác, còn chọn-file/thu-nhỏ/tải-lên vẫn một. */
  render?: (moChon: () => void, busy: boolean) => React.ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';   // reset để chọn lại đúng ảnh đó vẫn kích hoạt
    if (!f) return;
    setBusy(true);
    const a = await taiAnhLen(f);
    if (a) onAttach(a);
    setBusy(false);
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick}
        data-testid="file-pick" />
      {render ? render(() => fileRef.current?.click(), busy) : (
        <Button variant="ghost" size="icon" className="size-11 shrink-0" title="Đính kèm ảnh"
          data-testid="attach-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? <Loader2 className="size-[18px] animate-spin" /> : <ImagePlus className="size-[18px]" />}
        </Button>
      )}
    </>
  );
}

export function ChatToolbar({
  sid, title, model, effort, usage, onTitle, onModel,
}: {
  sid: string;
  title: string;
  model: string | null;
  /** mức nghĩ đang có hiệu lực cho phiên này */
  effort?: string;
  usage?: { turns: number; inTok: number; outTok: number; cacheRead: number; cacheWrite: number } | null;
  onTitle: (t: string) => void;
  onModel: (m: string | null) => void;
}) {
  const [dlg, setDlg] = useState<null | 'rename' | 'effort' | 'cost' | 'export' | 'summary' | 'anh'>(null);
  const [summary, setSummary] = useState('');
  const [name, setName] = useState('');

  const short = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  };

  const saveName = async () => {
    try {
      const r = await api<{ title: string }>('/api/title/' + sid, {
        method: 'POST', body: JSON.stringify({ title: name }),
      });
      onTitle(r.title || '');
      setDlg(null);
      toast.success(r.title ? 'Đã đổi tên phiên' : 'Đã bỏ tên tự đặt');
    } catch { toast.error('Đổi tên thất bại'); }
  };

  const acts = [
    { id: 'effort', icon: Gauge, label: 'Mức suy nghĩ', run: () => setDlg('effort'), on: !!effort },
    { id: 'cost', icon: Coins, label: 'Token đã dùng', run: () => setDlg('cost') },
    { id: 'rename', icon: Pencil, label: 'Đổi tên phiên', run: () => { setName(title); setDlg('rename'); } },
    /* Ảnh CẢ PHIÊN — khung chat chỉ đọc 30 tin cuối nên ảnh cũ không với tới được.
       Đo trên phiên 58MB: 128 ảnh, KHÔNG cái nào nằm trong cửa sổ đó. */
    { id: 'anh', icon: Images, label: 'Ảnh trong phiên', run: () => setDlg('anh') },
    // Bấm mở hộp chọn .md / .json / chép — gộp lại vì bày 3 nút riêng trên header
    // thì tên phiên lại bị bóp như lần trước (còn 54px trên iPhone).
    { id: 'export', icon: Download, label: 'Tải / chép phiên', run: () => setDlg('export') },
    // /api/summary/:sid có sẵn ở server (index.js:1476) nhưng giao diện mới CHƯA HỀ gọi
    { id: 'summary', icon: FileText, label: 'Tóm tắt phiên', run: async () => {
      setDlg('summary'); setSummary('');
      try {
        const r = await api<{ ok?: boolean; id?: string; error?: string }>('/api/summary/' + sid, { method: 'POST' });
        if (!r.ok || !r.id) { setSummary('LỖI: ' + (r.error || 'không gọi được')); return; }
        for (let i = 0; i < 40; i++) {
          await new Promise((s) => setTimeout(s, 1500));
          const o = await api<{ status: string; output: string }>('/api/oneshot/' + r.id).catch(() => null);
          if (!o || o.status === 'running') continue;
          setSummary(o.status === 'done' ? o.output.trim() : 'Tóm tắt thất bại');
          return;
        }
        setSummary('Chờ quá lâu, thử lại sau');
      } catch { setSummary('LỖI: mất kết nối'); }
    } },
  ];

  return (
    <>
      {/* MỘT menu duy nhất cho mọi bề rộng.
          Bản cũ bày cả 5 nút icon TRẦN trên desktop; cộng với nút quyền và effort là
          7 hình vuông xám cạnh nhau, không nhãn — nhìn ảnh chụp không đoán nổi cái nào
          làm gì, phải rê chuột từng cái đọc tooltip. Menu có chữ đọc được ngay, và
          header còn chỗ cho tên phiên. */}
      <DropdownMenu>
        {/* Base UI dùng prop `render` chứ không có `asChild` như Radix */}
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className="tap44 size-8 shrink-0"
              title="Công cụ phiên" aria-label="Công cụ phiên" data-testid="chat-more">
              <MoreHorizontal className="size-4" />
            </Button>
          } />
        <DropdownMenuContent align="end" className="w-52">
          {acts.map((a) => (
            <DropdownMenuItem key={a.id} onClick={a.run}
              data-testid={a.id === 'model' ? 'model-chip' : 'm-' + a.id}>
              <a.icon className={a.on ? 'size-4 text-tool-accent' : 'size-4'} />
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {dlg === 'anh' && <AnhPhien sid={sid} onClose={() => setDlg(null)} />}

      {dlg === 'summary' && (
        <Dialog open onOpenChange={() => setDlg(null)}>
          <DialogContent className="max-h-[80dvh] max-w-[620px] overflow-hidden" data-testid="summary-dialog">
            <DialogHeader><DialogTitle>Tóm tắt phiên</DialogTitle></DialogHeader>
            {summary ? (
              <div className="max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                {summary}
              </div>
            ) : (
              <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" /> Claude đang đọc lại phiên…
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {dlg === 'export' && (
        <Dialog open onOpenChange={() => setDlg(null)}>
          <DialogContent className="max-w-[360px]" data-testid="export-dialog">
            <DialogHeader><DialogTitle>Tải hoặc chép phiên</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-2">
              <Button variant="outline" size="sm" data-testid="exp-md"
                onClick={() => { location.href = '/api/export/' + sid + '?fmt=md'; setDlg(null); }}>
                <Download className="size-3.5" /> Tải .md — để đọc
              </Button>
              <Button variant="outline" size="sm" data-testid="exp-json"
                onClick={() => { location.href = '/api/export/' + sid + '?fmt=json'; setDlg(null); }}>
                <Braces className="size-3.5" /> Tải .json — để xử lý tiếp
              </Button>
              <Button variant="outline" size="sm" data-testid="exp-copy"
                onClick={async () => {
                  try {
                    const t = getToken();
                    const r = await fetch('/api/export/' + sid + '?fmt=md',
                      { headers: t ? { 'X-Dash-Token': t } : {} });
                    await navigator.clipboard.writeText(await r.text());
                    toast.success('Đã chép cả phiên');
                  } catch { toast.error('Không chép được'); }
                  setDlg(null);
                }}>
                <ClipboardCopy className="size-3.5" /> Chép vào bộ nhớ tạm
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {dlg === 'rename' && (
        <Dialog open onOpenChange={() => setDlg(null)}>
          <DialogContent className="max-w-[380px]">
            <DialogHeader><DialogTitle>Đổi tên phiên</DialogTitle></DialogHeader>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
              placeholder="Tên phiên…" className="text-[16px]" data-testid="rename-input" />
            <p className="text-[11.5px] text-muted-foreground">
              Để trống rồi Lưu = quay về tên Claude CLI tự đặt.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDlg(null)}>Hủy</Button>
              <Button size="sm" onClick={saveName} data-testid="rename-save">Lưu</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* MỨC NGHĨ chuyển vào đây, đổi chỗ cho model — model giờ nằm ở hàng nút chính
          vì nó ảnh hưởng chất lượng nhiều hơn và cần liếc thấy khi đang nhắn.
          Dùng thẳng EffortSwitch chứ không vẽ lại hàng nút riêng: trước đây model ở
          đây là dialog với mấy nút phẳng, trong khi ngoài kia là dropdown — cùng một
          loại lựa chọn mà hai kiểu bày. */}
      {dlg === 'effort' && (
        <Dialog open onOpenChange={() => setDlg(null)}>
          <DialogContent className="max-w-[380px]" data-testid="effort-dialog">
            <DialogHeader><DialogTitle>Mức suy nghĩ cho phiên này</DialogTitle></DialogHeader>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Chỉ áp dụng cho phiên này. Chọn “Tự động” để dùng lại mức chung —
              hoặc mức Claude CLI đang đặt sẵn nếu có.
            </p>
            <EffortSwitch effort={effort} sid={sid} />
          </DialogContent>
        </Dialog>
      )}

      {dlg === 'cost' && (
        <Dialog open onOpenChange={() => setDlg(null)}>
          <DialogContent className="max-w-[380px]" data-testid="cost-dialog">
            <DialogHeader><DialogTitle>Token đã dùng</DialogTitle></DialogHeader>
            {usage?.turns ? (
              <div className="flex flex-col gap-2 text-[13px]">
                {[
                  ['Số lượt', String(usage.turns), false],
                  ['Token gửi đi', short(usage.inTok), false],
                  ['Token nhận về', short(usage.outTok), false],
                  ['Đọc từ cache', short(usage.cacheRead), true],
                  ['Ghi vào cache', short(usage.cacheWrite), true],
                ].map(([k, v, dim]) => (
                  <div key={k as string}
                    className={'flex justify-between gap-4' + (dim ? ' text-muted-foreground' : '')}>
                    <span>{k}</span><span className="tabular-nums">{v}</span>
                  </div>
                ))}
                <p className="mt-1 border-t border-border pt-2 text-[11.5px] leading-relaxed text-muted-foreground">
                  Token đọc từ cache rẻ hơn nhiều so với token gửi mới, nên con số lớn ở dòng đó là bình thường.
                </p>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">Phiên này chưa có dữ liệu token.</p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// Khay ảnh đã đính kèm, hiện trên ô nhập
export function AttachBar({ items, onRemove }: { items: Attachment[]; onRemove: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2" data-testid="attach-bar">
      {items.map((a, i) => (
        <div key={i} data-testid="attach-item"
          className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.thumb} alt="" className="size-8 shrink-0 rounded-md object-cover" />
          <span className="truncate text-[12px]">{a.name}</span>
          <button onClick={() => onRemove(i)} className="shrink-0 text-muted-foreground hover:text-status-error"
            title="Bỏ ảnh này">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
