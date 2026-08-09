// Bảng lệnh — mục tiêu: dùng app không khác gì dùng CLI trên terminal.
//
// Đã CHẠY THỬ từng lệnh qua `claude -p` để biết cái nào thật sự hoạt động:
//   chạy được : /context /cost /mcp /doctor /config /init /agents
//   CLI chặn  : /status /permissions /memory /resume /rewind /export
// 4/6 lệnh bị chặn thì dashboard đã tự làm được bằng endpoint riêng, nên định tuyến
// sang đó thay vì gửi xuống CLI rồi báo lỗi. Lệnh không làm được trên điện thoại
// (/login, /terminal-setup…) thì KHÔNG đưa vào bảng — để bấm rồi báo lỗi là tệ nhất.

export type CmdKind =
  | 'claude-run'    // gọi CLI, hiện văn bản trả về
  | 'claude-chat'   // gửi vào phiên đang mở như một tin nhắn
  | 'hermes-run'    // gọi lệnh con của Hermes
  | 'ui';           // dashboard tự xử lý

export interface Cmd {
  id: string;
  label: string;
  desc: string;
  group: 'Claude' | 'Hermes' | 'Dashboard';
  kind: CmdKind;
  cmd?: string;         // lệnh gửi đi (mặc định = id)
  needSession?: boolean; // phải mở một phiên trước
}

export const COMMANDS: Cmd[] = [
  // ---- Claude: xem thông tin (chạy được qua -p, trả văn bản) ----
  { id: '/context', label: '/context', desc: 'Ngữ cảnh đã dùng bao nhiêu', group: 'Claude', kind: 'claude-run' },
  { id: '/cost', label: '/cost', desc: 'Hạn mức và chi phí phiên', group: 'Claude', kind: 'claude-run' },
  { id: '/mcp', label: '/mcp', desc: 'Trạng thái các MCP server', group: 'Claude', kind: 'claude-run' },
  { id: '/doctor', label: '/doctor', desc: 'Kiểm tra môi trường cài đặt', group: 'Claude', kind: 'claude-run' },
  { id: '/config', label: '/config', desc: 'Xem cấu hình Claude Code', group: 'Claude', kind: 'claude-run' },
  { id: '/agents', label: '/agents', desc: 'Danh sách subagent', group: 'Claude', kind: 'claude-run' },
  { id: '/release-notes', label: '/release-notes', desc: 'Có gì mới ở bản này', group: 'Claude', kind: 'claude-run' },
  { id: '/privacy-settings', label: '/privacy-settings', desc: 'Cài đặt riêng tư', group: 'Claude', kind: 'claude-run' },

  // ---- Claude: gửi vào phiên đang mở ----
  { id: '/init', label: '/init', desc: 'Tạo CLAUDE.md cho dự án', group: 'Claude', kind: 'claude-chat', needSession: true },
  { id: '/compact', label: '/compact', desc: 'Dọn ngữ cảnh khi hội thoại quá dài', group: 'Claude', kind: 'claude-chat', needSession: true },
  { id: '/review', label: '/review', desc: 'Review thay đổi hiện tại', group: 'Claude', kind: 'claude-chat', needSession: true },
  { id: '/security-review', label: '/security-review', desc: 'Rà soát bảo mật', group: 'Claude', kind: 'claude-chat', needSession: true },
  { id: '/pr-comments', label: '/pr-comments', desc: 'Đọc comment của PR', group: 'Claude', kind: 'claude-chat', needSession: true },
  { id: '/bug', label: '/bug', desc: 'Báo lỗi cho Anthropic', group: 'Claude', kind: 'claude-chat', needSession: true },

  // ---- Hermes: lệnh con an toàn (whitelist ở server) ----
  { id: 'h:status', label: 'hermes status', desc: 'Trạng thái toàn bộ thành phần', group: 'Hermes', kind: 'hermes-run', cmd: 'status' },
  { id: 'h:doctor', label: 'hermes doctor', desc: 'Chẩn đoán sự cố', group: 'Hermes', kind: 'hermes-run', cmd: 'doctor' },
  { id: 'h:sessions', label: 'hermes sessions', desc: 'Lịch sử phiên', group: 'Hermes', kind: 'hermes-run', cmd: 'sessions' },
  { id: 'h:skills', label: 'hermes skills', desc: 'Skill đang cài', group: 'Hermes', kind: 'hermes-run', cmd: 'skills' },
  { id: 'h:memory', label: 'hermes memory', desc: 'Cấu hình bộ nhớ ngoài', group: 'Hermes', kind: 'hermes-run', cmd: 'memory' },
  { id: 'h:cron', label: 'hermes cron', desc: 'Cron job của agent', group: 'Hermes', kind: 'hermes-run', cmd: 'cron' },
  { id: 'h:model', label: 'hermes model', desc: 'Model và provider mặc định', group: 'Hermes', kind: 'hermes-run', cmd: 'model' },
  { id: 'h:tools', label: 'hermes tools', desc: 'Tool bật/tắt theo nền tảng', group: 'Hermes', kind: 'hermes-run', cmd: 'tools' },
  { id: 'h:mcp', label: 'hermes mcp', desc: 'MCP server của Hermes', group: 'Hermes', kind: 'hermes-run', cmd: 'mcp' },
  { id: 'h:insights', label: 'hermes insights', desc: 'Thống kê sử dụng', group: 'Hermes', kind: 'hermes-run', cmd: 'insights' },
  { id: 'h:version', label: 'hermes version', desc: 'Hermes đang chạy bản nào', group: 'Hermes', kind: 'hermes-run', cmd: 'version' },
  { id: 'h:config', label: 'hermes config', desc: 'Cấu hình hiện tại', group: 'Hermes', kind: 'hermes-run', cmd: 'config' },

  // ---- Dashboard tự làm (gồm cả 4 lệnh CLI chặn ở chế độ -p) ----
  { id: 'ui:export', label: '/export', desc: 'Tải phiên ra .md / .json', group: 'Dashboard', kind: 'ui', needSession: true },
  { id: 'ui:cost', label: 'Token đã dùng', desc: 'Đọc từ file phiên, không gọi CLI', group: 'Dashboard', kind: 'ui', needSession: true },
  { id: 'ui:rename', label: 'Đổi tên phiên', desc: 'Đặt tên riêng cho phiên đang mở', group: 'Dashboard', kind: 'ui', needSession: true },
  { id: 'ui:model', label: 'Model cho phiên này', desc: 'Ghi đè model toàn cục', group: 'Dashboard', kind: 'ui', needSession: true },
  { id: 'ui:perm', label: 'Đổi chế độ quyền', desc: 'Tự sửa file / Duyệt trước / Hỏi quyền', group: 'Dashboard', kind: 'ui' },
  { id: 'ui:compare', label: 'So sánh 2 phiên', desc: 'Xem song song hai phiên', group: 'Dashboard', kind: 'ui' },
  { id: 'ui:stop', label: 'Dừng Claude', desc: 'Dừng phiên đang chạy', group: 'Dashboard', kind: 'ui', needSession: true },
  { id: 'ui:theme', label: 'Đổi giao diện sáng/tối', desc: 'Chuyển theme', group: 'Dashboard', kind: 'ui' },
];
