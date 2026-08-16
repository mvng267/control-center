'use client';

import { Shield, ShieldAlert, ShieldCheck, ClipboardList } from 'lucide-react';
import { CongTac, type MucChon } from './cong-tac';

/* Công tắc chế độ quyền — 4 nấc, khớp PERM_MODES ở server và --permission-mode của
   Claude CLI. Trước đây chỉ có ở màn danh sách, vào trong chat là mất, nên đang nhắn
   thì không biết Claude có tự sửa file được không. Giờ dùng chung cả hai chỗ.

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
  {
    id: 'default', label: 'Hỏi quyền', Icon: Shield,
    tone: 'text-muted-foreground', desc: 'KHÔNG tự sửa được file (sẽ báo chưa có quyền)',
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
