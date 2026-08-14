'use client';

import { useState } from 'react';
import { ArrowLeft, Check, Loader2, X } from 'lucide-react';
import { TABS, type TabId } from './app-shell';
import { NutCapNhat } from './nut-cap-nhat';
import { useCauHinh, luuTabBat, chuDau } from '@/lib/use-cauhinh';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* Màn cấu hình — mở từ ô tên ở chân sidebar (desktop) hoặc nút cấu hình (điện thoại).

   KHÔNG làm thành tab thứ 6: thanh tab dưới ở 390px đã chật với 5 tab, thêm nữa là
   tràn ngang. Dùng màn phủ toàn màn, cùng lối với man-tao-task.tsx và xem-file.tsx.

   Gom luôn nút Cập nhật vào đây — trước nó nằm rời ở chân sidebar, mà cấu hình và
   cập nhật là cùng một loại việc: thứ thỉnh thoảng mới đụng tới. */

export function ManCauHinh({ onDong }: { onDong: () => void }) {
  const c = useCauHinh();
  const [luu, setLuu] = useState(false);

  const doi = async (id: TabId, bat: boolean) => {
    setLuu(true);
    try {
      const r = await luuTabBat({ ...c.tabBat, [id]: bat });
      if (!r.ok) toast.error('Không lưu được');
      else navigator.vibrate?.(10);
    } catch { toast.error('Lỗi mạng'); }
    finally { setLuu(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background" data-testid="man-cau-hinh">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <Button variant="ghost" size="icon" className="tap44 size-9" onClick={onDong}
          data-testid="cau-hinh-dong" title="Đóng" aria-label="Đóng">
          <ArrowLeft className="size-4" />
        </Button>
        <span className="flex-1 text-[14px] font-semibold">Cấu hình</span>
        {luu && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 pb-24 md:px-6">
        {/* ---- ai đang dùng ---- */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[12px] font-medium text-muted-foreground">Tài khoản</h2>
          <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[12px] font-semibold text-primary">
              {chuDau(c.nguoiDung)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium" data-testid="cau-hinh-ten">
                {c.nguoiDung}
              </span>
              {/* Nói rõ tên này ở đâu ra, không thì người dùng đi tìm chỗ đổi trong app */}
              <span className="block text-[11px] text-muted-foreground">
                lấy từ tài khoản máy — đổi bằng biến <code className="font-mono">DASH_USER</code>
              </span>
            </span>
          </div>
        </section>

        {/* ---- bật/tắt tab ---- */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[12px] font-medium text-muted-foreground">Tab hiển thị</h2>
          <div className="flex flex-col rounded-xl border border-border bg-card">
            {TABS.map(({ id, label, icon: Icon }) => {
              // 'cli' là lý do tồn tại của app — tắt nó thì mở ra không còn gì
              const batBuoc = id === 'cli';
              const co = c.tabCo[id] !== false;
              const bat = batBuoc || c.tabBat[id] !== false;
              return (
                <label key={id} data-testid={'cau-hinh-tab-' + id}
                  className={cn('flex items-center gap-2.5 border-b border-border px-3 py-2.5 last:border-0',
                    batBuoc ? 'cursor-default opacity-70' : 'cursor-pointer')}>
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{label}</span>
                    {/* Máy không có công cụ thì nói thẳng, đừng để người dùng bật lên
                        rồi mở ra thấy lỗi và tưởng dashboard hỏng. */}
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {batBuoc ? 'luôn bật — đây là màn chính'
                        : co ? 'có sẵn trên máy này'
                          : 'không tìm thấy công cụ này trên máy'}
                    </span>
                  </span>
                  {/* KHÔNG disable trong lúc lưu: giao diện đã đổi ngay (cập nhật lạc
                      quan), khoá thêm chỉ làm bấm nhanh hai tab liền bị nuốt mất một. */}
                  <input type="checkbox" className="size-4 shrink-0 cursor-pointer accent-primary"
                    data-testid={'cau-hinh-bat-' + id}
                    checked={bat} disabled={batBuoc}
                    onChange={(e) => doi(id, e.target.checked)} />
                </label>
              );
            })}
          </div>
          <p className="px-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Tắt tab nào thì nó biến khỏi thanh bên và thanh tab dưới. Bật lại lúc nào cũng được.
          </p>
        </section>

        {/* ---- cập nhật ---- */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[12px] font-medium text-muted-foreground">Phiên bản</h2>
          <div className="rounded-xl border border-border bg-card px-2 py-1.5">
            <NutCapNhat />
          </div>
        </section>
      </div>
    </div>
  );
}
