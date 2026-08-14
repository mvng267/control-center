'use client';

import { useEffect, useState } from 'react';
import { Images, Loader2 } from 'lucide-react';
import { api, imgUrl } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ImageZoom } from './tool-card';

/* Xem MỌI ảnh trong phiên, không giới hạn cửa sổ 30 tin.

   Vì sao cần: khung chat chỉ đọc 30 tin CUỐI để payload nhẹ (25KB mỗi 2 giây khi
   phiên đang chạy). Ảnh cũ nằm ngoài cửa sổ nên không cách nào xem lại — đo trên
   phiên 58MB thật: 128 ảnh, KHÔNG cái nào nằm trong 30 tin cuối. Người dùng báo "chưa xem
   được ảnh" chính là chuyện này; ảnh không hỏng, chỉ là không với tới.

   Chỉ tải khi MỞ bảng (endpoint quét cả file, đo được 285ms trên file 58MB) — không
   gọi nền theo nhịp poll. */

interface Anh { id: string; i: number; mt: string; bytes: number; ts: string | null }

const gonByte = (n: number) => (n >= 1 << 20
  ? (n / (1 << 20)).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');

const gioNgan = (ts: string | null) => {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(+d) ? '' : `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function AnhPhien({ sid, onClose }: { sid: string; onClose: () => void }) {
  const [anh, setAnh] = useState<Anh[] | null>(null);
  const [hong, setHong] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ ok: boolean; anh?: Anh[] }>('/api/imgs/' + sid)
      .then((r) => { if (alive) setAnh(r.ok && r.anh ? r.anh : []); })
      .catch(() => { if (alive) setHong('không đọc được phiên'); });
    return () => { alive = false; };
  }, [sid]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85dvh] max-w-[820px] overflow-hidden" data-testid="anh-phien">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <Images className="size-4" />
            Ảnh trong phiên
            {!!anh?.length && (
              <span className="rounded bg-muted px-1.5 py-px text-[11px] font-normal text-muted-foreground">
                {anh.length}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {hong ? (
          <p className="py-8 text-center text-[13px] text-status-error">{hong}</p>
        ) : anh === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" /> Đang quét cả phiên…
          </div>
        ) : !anh.length ? (
          <p className="py-8 text-center text-[13px] text-muted-foreground" data-testid="anh-trong">
            Phiên này chưa có ảnh nào
          </p>
        ) : (
          // auto-rows-max: hàng lưới phải cao theo NỘI DUNG. Không có nó thì trình
          // duyệt chia đều chiều cao khung cho 33 hàng — đo được 10.78px/hàng trong
          // khi ô cao 144px, nên các ô tràn xuống đè lên nhau, phần lớn nhìn ra ô rỗng.
          // Đếm số ảnh vẫn đúng 128 nên chỉ đếm thì KHÔNG bắt được lỗi này.
          <div className="grid max-h-[68dvh] auto-rows-max grid-cols-2 items-start gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
            {/* Ô ảnh KHÔNG dùng lớp tap44: đo được ô co lại còn 11px trong khi ảnh
                bên trong cao 104px — ảnh tràn ra ngoài, nhìn ra một dãy ô rỗng chỉ có
                dòng chữ kích thước. h-fit + shrink-0 để ô ôm đúng nội dung; ô đã cao
                104px nên vùng chạm vượt 44px sẵn. */}
            {anh.map((a, k) => {
              // imgUrl gắn ?t= — <img> không gửi được header token (xem lib/api.ts)
  const src = imgUrl(`/api/toolimg/${sid}/${a.id}/${a.i}`);
              return (
                <button key={a.id + ':' + a.i + ':' + k} onClick={() => setZoom(src)}
                  data-testid="anh-o"
                  className="group flex h-fit shrink-0 flex-col overflow-hidden rounded-[10px] border border-border bg-card text-left transition-colors hover:border-primary/50">
                  {/* loading=lazy: 128 ảnh × ~100KB là 12MB, tải hết một lúc thì
                      nghẽn Tailscale và treo cả bảng. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy"
                    className="h-[104px] w-full bg-background/40 object-cover" />
                  <span className="flex items-center gap-1.5 px-2 py-1 text-[10.5px] text-muted-foreground">
                    <span className="tabular-nums">{gonByte(a.bytes)}</span>
                    <span className="ml-auto shrink-0 tabular-nums">{gioNgan(a.ts)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {zoom && <ImageZoom src={zoom} onClose={() => setZoom(null)} />}
      </DialogContent>
    </Dialog>
  );
}
