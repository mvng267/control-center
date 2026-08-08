'use client';

import { useRef, useState } from 'react';
import { Download, Coins, Pencil, Cpu, X, MoreHorizontal, ImagePlus, Loader2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

const MODELS = ['opus', 'sonnet', 'haiku'];

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

/* Nút đính kèm ảnh — tách riêng để đặt CẠNH ô nhắn tin (soạn tin ở đâu thì nút ở đó),
   thay vì nằm chung với nhóm nút quản lý phiên trên header. */
export function AttachButton({ onAttach }: { onAttach: (a: Attachment) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';   // reset để chọn lại đúng ảnh đó vẫn kích hoạt
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast.error('Chỉ gửi được ảnh');
    setBusy(true);
    try {
      const data = await shrink(f);
      const r = await api<{ ok: boolean; path: string; error?: string }>('/api/upload', {
        method: 'POST', body: JSON.stringify({ data }),
      });
      if (!r.ok) return toast.error('Gửi ảnh lỗi: ' + (r.error || '?'));
      onAttach({ path: r.path, name: f.name || 'ảnh', thumb: data });
      navigator.vibrate?.(10);
    } catch { toast.error('Không đọc được ảnh'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pick}
        data-testid="file-pick" />
      <Button variant="ghost" size="icon" className="size-11 shrink-0" title="Đính kèm ảnh"
        data-testid="attach-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? <Loader2 className="size-[18px] animate-spin" /> : <ImagePlus className="size-[18px]" />}
      </Button>
    </>
  );
}

export function ChatToolbar({
  sid, title, model, usage, onTitle, onModel,
}: {
  sid: string;
  title: string;
  model: string | null;
  usage?: { turns: number; inTok: number; outTok: number; cacheRead: number; cacheWrite: number } | null;
  onTitle: (t: string) => void;
  onModel: (m: string | null) => void;
}) {
  const [dlg, setDlg] = useState<null | 'rename' | 'model' | 'cost'>(null);
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

  const setM = async (m: string) => {
    try {
      const r = await api<{ model: string | null }>('/api/model/' + sid, {
        method: 'POST', body: JSON.stringify({ model: m }),
      });
      onModel(r.model);
      setDlg(null);
      toast.success(r.model ? 'Phiên này dùng ' + r.model : 'Phiên này dùng model mặc định');
    } catch { toast.error('Không đổi được model'); }
  };

  const acts = [
    { id: 'model', icon: Cpu, label: 'Model cho phiên này', run: () => setDlg('model'), on: !!model },
    { id: 'cost', icon: Coins, label: 'Token đã dùng', run: () => setDlg('cost') },
    { id: 'rename', icon: Pencil, label: 'Đổi tên phiên', run: () => { setName(title); setDlg('rename'); } },
    { id: 'export', icon: Download, label: 'Tải phiên (.md)', run: () => { location.href = '/api/export/' + sid + '?fmt=md'; } },
  ];

  return (
    <>
      {/* Màn rộng: bày hết ra cho bấm một chạm */}
      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        {acts.map((a) => (
          <Button key={a.id} variant="ghost" size="icon" className="size-8" title={a.label}
            data-testid={a.id === 'model' ? 'model-chip' : a.id + '-btn'} onClick={a.run}>
            <a.icon className={a.on ? 'size-4 text-tool-accent' : 'size-4'} />
          </Button>
        ))}
      </div>

      {/* Điện thoại: 5 nút bóp tên phiên còn ~54px, không biết đang ở phiên nào.
          Gom vào menu ⋯ để tên phiên có chỗ thở. */}
      <DropdownMenu>
        {/* Base UI dùng prop `render` chứ không có `asChild` như Radix */}
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon" className="size-8 shrink-0 sm:hidden"
              title="Thêm" data-testid="chat-more">
              <MoreHorizontal className="size-4" />
            </Button>
          } />
        <DropdownMenuContent align="end" className="w-52">
          {acts.map((a) => (
            <DropdownMenuItem key={a.id} onClick={a.run} data-testid={'m-' + a.id}>
              <a.icon className={a.on ? 'size-4 text-tool-accent' : 'size-4'} />
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

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

      {dlg === 'model' && (
        <Dialog open onOpenChange={() => setDlg(null)}>
          <DialogContent className="max-w-[380px]">
            <DialogHeader><DialogTitle>Model cho phiên này</DialogTitle></DialogHeader>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Chỉ áp dụng cho phiên này. Chọn “Mặc định” để dùng lại model chung.
            </p>
            <div className="flex flex-wrap gap-2">
              {MODELS.concat(['default']).map((m) => (
                <Button key={m} size="sm" variant={model === m ? 'default' : 'outline'}
                  onClick={() => setM(m === 'default' ? '' : m)}>
                  {m === 'default' ? 'Mặc định' : m}
                </Button>
              ))}
            </div>
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
        <div key={i} className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5">
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
