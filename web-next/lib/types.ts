// Kiểu dữ liệu khớp với những gì src/server/index.js trả về.

export type Status = 'RUNNING' | 'ACTIVE' | 'IDLE';

/* Dự án của một phiên, dựng từ trường cwd trong chính file .jsonl.
   Trước đây tên dự án được SUY từ tên thư mục ~/.claude/projects nên ra "agy/proxy",
   "perfume/com" (mất đoạn đầu), "plastic/". */
// Không export: chỉ dùng làm kiểu của Session.duAn, không ai import tên này.
interface DuAn {
  ten: string;        // tên thư mục thật: "agy-proxy"
  khoa: string;       // cwd đã chuẩn hoá — khoá gom nhóm và lọc, KHÔNG hiện ra
  duongDan: string;   // đã rút gọn: "~/Desktop/project/agy-proxy"
  repo: string;       // "chu-repo/ten-repo", rỗng nếu không phải repo git
  nhanh: string;      // "main"
  conTonTai: boolean; // thư mục còn trên đĩa không (xoá rồi thì --resume trượt)
  laNhap: boolean;    // phiên nháp trong /tmp/claude-*
}

export interface Session {
  sid: string;
  // Vẫn là CHUỖI (= duAn.ten) cho giao diện cũ web/legacy đọc làm khoá gom nhóm.
  project: string;
  duAn?: DuAn;
  title: string;
  msgs: number;
  unread: number;
  mtimeMs: number;
  status: Status;
  model?: string | null;
  effort?: string;     // mức nghĩ của lượt gần nhất: 'high' | 'medium' | …
  /* Thẻ phiên: đủ thông tin để xem lướt là biết phiên nào đáng mở.
     Đều do parseSessionFile tính sẵn, không tốn thêm lần đọc file nào. */
  vaiCuoi?: string;    // ai nói câu cuối: 'user' | 'assistant'
  tinCuoi?: string;    // trích câu cuối (đã cắt gọn)
  tok?: number;        // token cả phiên (vào + ra)
  tokDoc?: number;     // token đọc từ cache
  tokGhi?: number;     // token ghi vào cache
  luot?: number;       // số lượt hỏi-đáp
  choDuyet?: boolean;  // đang ĐỨNG IM chờ người bấm (giữ boolean cho giao diện cũ)
  cho?: string;        // lý do chờ: 'ke-hoach' (duyệt kế hoạch) | 'cau-hoi' (Claude hỏi)
  /* NỘI DUNG thứ đang chờ — có nó mới duyệt/chọn được ngay ở danh sách, khỏi mở
     phiên. Server đã cắt ngắn vì danh sách đi qua SSE mỗi 2 giây. */
  choND?: {
    cho: 'ke-hoach' | 'cau-hoi';
    id: string;              // tool_use_id — khoá để nhớ "đã bấm rồi"
    tomTat?: string;         // 300 ký tự đầu của kế hoạch
    hoi?: {
      hoi: string; nhan: string; nhieu: boolean;
      chon: { nhan: string }[];
      them: number;          // còn mấy câu nữa (thẻ chỉ hiện câu đầu)
    } | null;
  };
  dangChay?: string;   // lệnh đang chạy dở, vd "Bash(npm test)"
  /* Agent con (Task/Agent) ĐANG chạy. SSE chỉ gửi số đếm + tên 3 cái đầu — danh sách
     đầy đủ lấy ở /api/history khi mở phiên (128 agent trên máy này, gửi hết mỗi 2
     giây cho 155 phiên là phí). */
  agentChay?: number;
  agentTen?: string[];
  /* Đã ghim chưa. Danh sách xoay theo thời gian nên phiên đang làm dở tụt xuống ngay
     khi mở phiên khác — ghim để nó luôn nằm đầu. */
  fav?: boolean;
  /* Số PHÚT đã im lặng nếu phiên CÓ VẺ TREO (tiến trình còn sống mà .jsonl không được
     ghi thêm quá 15 phút). Vắng mặt = bình thường — server chỉ gửi khi khác 0. */
  treo?: number;
  /* Đã ẩn khỏi danh sách chưa. Ẩn là ghi riêng của dashboard — KHÔNG xoá .jsonl, phiên
     vẫn mở được bằng link và vẫn hiện khi bật "Hiện cả phiên đã ẩn". */
  an?: boolean;
  /* Nhịp token 20 mốc gần nhất (CHÊNH LỆCH giữa hai nhịp SSE, không phải số tổng).
     Server CHỈ gửi cho phiên đang chạy — phiên nghỉ token không đổi nên đường vẽ ra
     phẳng lì, gửi đi chỉ tốn băng thông. */
  nhip?: number[];
}

export interface Job {
  id: string;
  kind: 'loop' | 'cron';
  spec: string;
  prompt: string;
  runs: number;
  lastSid?: string | null;
}

export interface StreamData {
  sessions: Session[];
  jobs: Job[];
  model: string | null;
  perm: string;
  effort?: string;   // mức suy nghĩ (--effort), '' = để CLI tự quyết
}

// ---- agy-proxy ----
export interface AgyAccounts {
  total: number;
  status: Record<string, number>;
  kiro: Record<string, number>;
  recent24h: number;
}

export interface AgyUsage {
  ok: boolean;
  reqs: number;
  errs: number;
  tokens: number;
  avgMs: number;
  models: { model: string; n: number; e: number }[];
  codes: { status: number | null; n: number }[];
  hours: { h: string; n: number; e: number }[];
}

export interface AgyStatus {
  running: boolean;
  port: number;
  accounts: number;
  models: string[];
  modelGroups: { name: string; items: string[] }[];
  acc: AgyAccounts;
  /* Không đọc được state.db của agy thì trả { ok:false, error } — có LÝ DO để giao
     diện báo ra, thay vì ẩn khối im lặng làm người dùng tưởng dashboard hỏng. */
  usage: AgyUsage | { ok: false; error?: string };
  external: boolean;
  dev: { pid: number; startedAt: number } | null;
  task: { name: string; startedAt: number } | null;
  last: Record<string, { ok: boolean; at: number; ms?: number } | null>;
}
