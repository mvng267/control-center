'use client';

import { Cpu } from 'lucide-react';
import { CongTac, type MucChon } from './cong-tac';

/* Chọn model cho Claude.

   Trước đây việc này chỉ nằm trong menu ⋯ của khung chat: giao task mới thì KHÔNG
   chọn được model, dù model là thứ ảnh hưởng tới chất lượng nhiều hơn cả mức nghĩ.
   Tách ra thành công tắc riêng để màn giao task và khung chat dùng CHUNG một chỗ —
   hai bản riêng là hai nơi lệch nhau lúc nào không biết.

   Dùng ĐÚNG tên rút gọn CLI nhận: `opus`/`sonnet`/`haiku`. Không ghi tên đầy đủ kèm
   ngày (`claude-opus-4-...`) vì bản cài trên máy nâng cấp thì chuỗi đó thành sai,
   còn tên rút gọn luôn trỏ tới bản mới nhất theo cấu hình Claude đang có.

   Khung dropdown dùng chung ở cong-tac.tsx. */

export const MODELS: readonly MucChon[] = [
  { id: '', label: 'Theo cấu hình', desc: 'Dùng model Claude CLI đang đặt sẵn' },
  { id: 'opus', label: 'Opus', desc: 'Mạnh nhất — việc khó, suy luận dài' },
  { id: 'sonnet', label: 'Sonnet', desc: 'Cân bằng — dùng hằng ngày' },
  { id: 'haiku', label: 'Haiku', desc: 'Nhanh và rẻ — việc vặt' },
] as const;

export function modelOf(id?: string) {
  return MODELS.find((m) => m.id === (id || '')) || MODELS[0];
}

/* model nhận cả null: server trả `model: null` khi phiên không đặt model riêng (theo
   model toàn cục). CongTac ép về mục đầu nên null hay undefined đều như nhau. */
export function ModelSwitch({ model, compact, sid, testid = 'model-btn' }: {
  model?: string | null;
  compact?: boolean;
  /** có sid = chỉ đổi model cho phiên đó; không có = đổi model chung */
  sid?: string;
  testid?: string;
}) {
  return (
    <CongTac muc={MODELS} giaTri={model || ''} endpoint="model" khoaBody="model" sid={sid}
      IconChung={Cpu} toneChung="text-primary" nhan="Model"
      testid={testid} compact={compact} rongMenu={250} rongNhan={86} />
  );
}
