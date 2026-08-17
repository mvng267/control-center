'use client';

import { Shield, ShieldAlert, ShieldCheck, ClipboardList } from 'lucide-react';
import { CongTac, type MucChon } from './cong-tac';

/* Công tắc chế độ quyền — 6 nấc, khớp PERM_MODES ở server và --permission-mode của
   Claude CLI. Trước đây chỉ có ở màn danh sách, vào trong chat là mất, nên đang nhắn
   thì không biết Claude có tự sửa file được không. Giờ dùng chung cả hai chỗ.

   CLI còn nhận `manual` nhưng đó là ALIAS của `default` nên không đưa vào — hai mục
   cùng nghĩa trong một menu chỉ làm người dùng phân vân.

   Khung dropdown dùng chung ở cong-tac.tsx. */

export const PERMS: readonly MucChon[] = [
  {
    id: 'acceptEdits', label: 'Tự sửa file', Icon: ShieldCheck,
    tone: 'text-status-ok', desc: 'Claude tự sửa/tạo file; lệnh nguy hiểm vẫn bị chặn',
  },
  {
    id: 'plan', label: 'Duyệt trước', Icon: ClipboardList,
    tone: 'text-primary', desc: 'Trình bày kế hoạch rồi chờ bạn bấm Duyệt mới làm',
  },
  /* `auto`: CLI tự xét từng hành động — việc an toàn cho chạy, việc nguy hiểm (xoá,
     đẩy git, gọi mạng) tự chặn, không cần ai bấm. Đây là chế độ hợp với dashboard
     nhất vì `claude -p` chạy với stdio ignore nên không có kênh nào để hỏi. */
  {
    id: 'auto', label: 'Tự xét', Icon: ShieldCheck,
    tone: 'text-status-ok', desc: 'CLI tự xét từng việc: an toàn thì làm, nguy hiểm thì chặn',
  },
  {
    id: 'default', label: 'Hỏi quyền', Icon: Shield,
    tone: 'text-muted-foreground', desc: 'KHÔNG tự sửa được file (sẽ báo chưa có quyền)',
  },
  /* `dontAsk`: chỉ chạy tool đã nằm trong permissions.allow của settings.json (máy này
     có 17 quy tắc) cộng lệnh chỉ-đọc; còn lại lặng lẽ bỏ qua, không hỏi. Chặt hơn
     'Tự xét' nhưng đoán trước được. */
  {
    id: 'dontAsk', label: 'Chỉ việc đã duyệt', Icon: Shield,
    tone: 'text-muted-foreground', desc: 'Chỉ chạy tool đã cho phép sẵn; việc khác bỏ qua, không hỏi',
  },
  {
    id: 'bypassPermissions', label: 'Bỏ kiểm tra', Icon: ShieldAlert,
    tone: 'text-status-error', desc: 'CẨN THẬN: bỏ qua MỌI kiểm tra quyền',
  },
] as const;

export function permOf(id?: string) {
  return PERMS.find((p) => p.id === id) || PERMS[0];
}

export function PermSwitch({
  perm, compact, testid = 'perm-btn', sid,
}: {
  perm?: string;
  compact?: boolean;   // chỉ hiện icon (dùng trong khung chat cho đỡ chật)
  testid?: string;
  /** có sid = chỉ đổi cho phiên đó; không có = đổi mặc định chung */
  sid?: string;
}) {
  return (
    <CongTac muc={PERMS} giaTri={perm} endpoint="perm" khoaBody="mode" sid={sid}
      nhan="Chế độ quyền" testid={testid} compact={compact}
      rongMenu={268} rongNhan={92} />
  );
}
