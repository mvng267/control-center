'use client';

import { Gauge } from 'lucide-react';
import { CongTac, type MucChon } from './cong-tac';

/* Mức suy nghĩ (--effort của Claude CLI). Dashboard trước đây KHÔNG truyền cờ này,
   nên mọi task giao từ app đều chạy mức mặc định — dù trên terminal có đổi gì đi nữa.
   Đây là chế độ điều khiển ảnh hưởng nhiều nhất tới chất lượng câu trả lời, đứng
   sau model.

   Khung dropdown dùng chung ở cong-tac.tsx — ba công tắc từng là ba bản chép, lệch
   nhau lúc nào không biết. */

export const EFFORTS: readonly MucChon[] = [
  { id: '', label: 'Tự động', desc: 'Để Claude tự chọn theo độ khó của việc' },
  { id: 'low', label: 'Thấp', desc: 'Nhanh, hợp việc đơn giản, tốn ít token' },
  { id: 'medium', label: 'Vừa', desc: 'Cân bằng giữa nhanh và kỹ' },
  { id: 'high', label: 'Cao', desc: 'Nghĩ kỹ hơn, hợp việc cần suy luận' },
  { id: 'xhigh', label: 'Rất cao', desc: 'Rất kỹ, chậm và tốn token' },
  { id: 'max', label: 'Tối đa', desc: 'Kỹ nhất có thể — chậm nhất, tốn nhất' },
] as const;

export function effortOf(id?: string) {
  return EFFORTS.find((e) => e.id === (id || '')) || EFFORTS[0];
}

export function EffortSwitch({ effort, compact, sid, testid = 'effort-btn' }: {
  effort?: string;
  compact?: boolean;
  /** có sid = chỉ đổi cho phiên đó; không có = đổi mặc định chung */
  sid?: string;
  testid?: string;
}) {
  return (
    <CongTac muc={EFFORTS} giaTri={effort} endpoint="effort" khoaBody="effort" sid={sid}
      IconChung={Gauge} toneChung="text-tool-accent" nhan="Mức suy nghĩ"
      testid={testid} compact={compact} rongMenu={260} rongNhan={74} />
  );
}
