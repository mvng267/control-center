'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PermSwitch } from './perm-switch';
import { EffortSwitch } from './effort-switch';
import { ManTaoTask } from './man-tao-task';

/* Thanh mở màn GIAO TASK — chức năng cốt lõi. Không có nó thì dashboard chỉ để XEM.

   Trước đây đây là cả một ô nhập + 4 nút chế độ + 2 công tắc quyền + 2 nút bấm, tất
   cả chen trong ~110px dưới đáy danh sách. Trên iPhone gõ vào là bàn phím ảo che gần
   hết, không thấy mình đang gõ gì.

   Giờ chỉ còn MỘT thanh bấm được; chạm vào là mở hẳn một màn riêng (man-tao-task.tsx)
   với ô gõ chiếm trọn màn hình. Hai công tắc quyền vẫn để lại ở đây vì chúng là
   trạng thái TOÀN CỤC — cần thấy được mà không phải mở màn nào. */

export function TaskBar({ perm, effort, onOpen }: {
  perm?: string; effort?: string; onOpen: (sid: string) => void;
}) {
  const [mo, setMo] = useState(false);

  return (
    <>
      <div className="shrink-0 border-t border-border bg-card/40 px-3 py-2.5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}
        data-testid="task-bar">
        <div className="mx-auto flex max-w-[1000px] items-center gap-2">
          {/* Trông như ô nhập nhưng là NÚT: chạm vào mở màn riêng thay vì gõ tại chỗ.
              Giữ hình dáng ô nhập để không phải học lại chỗ bấm. */}
          <button type="button" onClick={() => setMo(true)} data-testid="mo-tao-task"
            className="tap44 flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3 text-left text-[14px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
            <Plus className="size-4 shrink-0 opacity-70" />
            <span className="truncate">Giao task mới cho Claude…</span>
          </button>
          <PermSwitch perm={perm} />
          <EffortSwitch effort={effort} />
        </div>
      </div>

      {mo && (
        <ManTaoTask perm={perm} effort={effort} onOpen={onOpen} onDong={() => setMo(false)} />
      )}
    </>
  );
}
