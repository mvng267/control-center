#!/usr/bin/env node
// claude-dashboard.js — Hybrid Control Center: Claude CLI sessions + Hermes stream
// UI hiện đại kiểu Linear/Vercel dark: Tailwind + daisyUI + Lucide (CDN), KHÔNG hiệu ứng nháy.
// Render ổn định: diff DOM theo key, chỉ update node thay đổi — không full-repaint.
// Usage: node claude-dashboard.js   (http://localhost:7799)

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
// Giải mã UTF-8 an toàn khi đọc từng đoạn: giữ byte lẻ ở ranh giới ký tự (xem docPhanThem)
const { StringDecoder } = require('string_decoder');

const PORT = +(process.env.PORT || 7799);
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const HERMES_DB = path.join(os.homedir(), '.hermes', 'state.db');
const HERMES_LOG = path.join(os.homedir(), '.hermes', 'logs', 'agent.log');
// Hermes CLI: chat 2 chiều — server gọi trực tiếp binary, đợi stdout trả về client
const HERMES_BIN = process.env.HERMES_BIN || path.join(os.homedir(), '.hermes', 'hermes-agent', 'venv', 'bin', 'hermes');
const HERMES_MODEL = process.env.HERMES_MODEL || 'tencent/hy3:free';

// sid -> { proc, project, startedAt, task }
const procs = new Map();
// sid -> timestamp lần cuối user mở chat view (để tính unread badge)
const lastSeen = new Map();
// Model áp dụng cho task mới (--model khi spawn), set qua lệnh /model. null = default
let currentModel = null;
/* Chế độ quyền khi spawn Claude.
   Dashboard chạy `claude -p` với stdio ignore -> KHÔNG có kênh nào để hỏi quyền:
   Claude im lặng bỏ qua việc cần quyền rồi trả lời "bạn chưa cấp quyền", nhìn như
   đã làm mà thật ra không làm gì. acceptEdits = tự cho phép sửa file (lệnh nguy hiểm
   vẫn bị chặn). Ghi ra file để giữ nguyên lựa chọn sau khi restart dashboard. */
/* ---- ghi file cấu hình ----
   Ghi JSON có TẠO THƯ MỤC CHA trước. Trên máy chưa từng chạy Claude CLI thì ~/.claude
   không tồn tại, nên mọi writeFileSync ném ENOENT — mà chỗ nào cũng bọc catch{} nên
   hỏng IM LẶNG. Đã thử với HOME trống: đặt mã khoá trả về {"ok":true} mà không tạo
   file nào (người dùng tưởng đã khoá, thật ra không), còn mã truy cập thì đổi mỗi lần
   khởi động lại nên link ?t= đã lưu trên điện thoại chết theo.
   KHÔNG bắt lỗi ở đây: để nó ném ra cho chỗ gọi báo thật. */
function ghiJson(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), mode ? { mode } : undefined);
}

const PERM_FILE = path.join(os.homedir(), '.claude', 'dashboard-perm.json');
// 'plan' = Claude trình bày kế hoạch rồi DỪNG chờ duyệt (không đụng file). Đây là cách
// duyệt-trước-khi-làm khả thi duy nhất: CLI không có kênh uỷ quyền để dashboard bấm
// "cho phép" từng tool (đã thử stream-json: không phát sự kiện xin quyền).
const PERM_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
let permMode = 'acceptEdits'; // mặc định: hết cảnh "làm như không làm"
try {
  const saved = JSON.parse(fs.readFileSync(PERM_FILE, 'utf8'));
  if (PERM_MODES.indexOf(saved.mode) >= 0) permMode = saved.mode;
} catch {}
// Cờ --permission-mode cho mọi lần spawn ('default' = để CLI tự quyết, không truyền cờ)
function permArgs() {
  return permMode === 'default' ? [] : ['--permission-mode', permMode];
}

/* Mức suy nghĩ (--effort). CLI nhận low|medium|high|xhigh|max; càng cao Claude càng
   nghĩ kỹ nhưng càng lâu và tốn token. Dashboard trước đây KHÔNG truyền cờ này, nên
   dù người dùng có đổi ở terminal thì task giao từ app vẫn chạy mức mặc định.
   Lưu chung file với chế độ quyền cho gọn. */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
let effort = '';   // '' = để CLI tự quyết
try {
  const saved = JSON.parse(fs.readFileSync(PERM_FILE, 'utf8'));
  if (EFFORTS.indexOf(saved.effort) >= 0) effort = saved.effort;
} catch {}
function effortArgs() {
  return effort ? ['--effort', effort] : [];
}
function saveModes() {
  try { ghiJson(PERM_FILE, { mode: permMode, effort }); return true; }
  catch { return false; }   // chỗ gọi báo cho người dùng, đừng nuốt
}
// Loop/cron jobs: id -> { id, kind: 'loop'|'cron', spec, prompt, runs, lastSid, timer?, lastKey? }
const jobs = new Map();
// One-shot claude runs (enhance prompt / summary): id -> { status, output }
const oneshots = new Map();
// jsonl parse cache: file -> { mtimeMs, size, data }
const cache = new Map();

/* ---------------- JSONL parsing (Claude CLI sessions) ---------------- */
// Helper biến tool_use/tool_result thành dữ liệu có cấu trúc -> src/server/tools.js
const {
  extractText, clampText, base, toolDisplayName, summarizeToolInput, extractTodos,
  extractHoi, extractKeHoach, extractFileKeHoach,
  buildInputDetail, toolResultPreview, findToolImage, listSessionImages, flattenParts, mdForMessage,
  TOOL_SUMMARY_CAP, TOOL_INPUT_CAP, TOOL_RESULT_CAP, THINK_CAP, TOOL_ST_LABEL,
} = require('./tools');


/* Lần đọc này có RẺ không? Dùng để biết có cần nhả event loop hay không (xem
   listSessions). Rẻ = không đổi gì (trả cache luôn), hoặc chỉ ghi thêm vào đuôi
   (chỉ đọc phần mới, thường vài KB). Đắt = phải parse lại cả file. */
function docReTien(file) {
  const c = cache.get(file);
  if (!c) return false;
  try {
    const st = fs.statSync(file);
    if (c.mtimeMs === st.mtimeMs && c.size === st.size) return true;
    // dài ra + phần đầu còn nguyên -> chỉ đọc đuôi
    return st.size > c.size && !!c.state && mocCuoi(file, c.size) === c.moc;
  } catch { return false; }
}

/* ĐỌC THÊM PHẦN ĐUÔI, không parse lại cả file.
   File .jsonl của Claude CLI chỉ GHI THÊM vào cuối. Trước đây mỗi lần mtime đổi là
   parse lại từ đầu — đo thật: hai phiên đang chạy (89MB + 80MB) khiến 169MB bị parse
   lại MỖI NHỊP SSE (2 giây), tốn ~700ms mỗi nhịp vĩnh viễn, và làm API nhẹ đợi theo.
   Giờ chỉ đọc từ byte thứ `size cũ` trở đi.

   Điều kiện an toàn: file phải DÀI RA và phần đầu không đổi. Kiểm bằng cách so
   64 byte cuối của phần cũ — CLI ghi nối đuôi thì đoạn đó bất biến. Không khớp
   (file bị ghi đè, /clear, CLI viết lại) -> parse lại toàn bộ như cũ. */
const MOC_KIEM = 64;

function docPhanThem(file, cu, st) {
  if (!cu || st.size <= cu.size || !cu.state) return null;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    // 1) phần đầu còn nguyên? so MOC_KIEM byte cuối của lần đọc trước
    const off = Math.max(0, cu.size - MOC_KIEM);
    const n = cu.size - off;
    const moc = Buffer.alloc(n);
    fs.readSync(fd, moc, 0, n, off);
    if (moc.toString('latin1') !== cu.moc) { fs.closeSync(fd); return null; }
    // 2) đọc đúng phần mới thêm
    const them = Buffer.alloc(st.size - cu.size);
    fs.readSync(fd, them, 0, them.length, cu.size);
    fs.closeSync(fd);
    /* Trả BUFFER, không phải chuỗi. Cắt theo BYTE có thể rơi vào GIỮA một ký tự
       UTF-8 nhiều byte — tiếng Việt có dấu toàn 2-3 byte nên chuyện này chạm được.
       `them.toString('utf8')` khi đó sinh ký tự hỏng "�" ngay đầu đoạn:
         Buffer.from('xin chào').subarray(giữa 'à')  ->  "�o"
       Dòng JSON dính ký tự hỏng thì parse trượt -> mất hẳn tin nhắn đó, im lặng.
       Chỗ gọi dùng StringDecoder để nối byte lẻ sang lần đọc sau. */
    return them;
  } catch { try { if (fd !== undefined) fs.closeSync(fd); } catch {} return null; }
}

function mocCuoi(file, size) {
  if (!size) return '';
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const off = Math.max(0, size - MOC_KIEM);
    const n = size - off;
    const b = Buffer.alloc(n);
    fs.readSync(fd, b, 0, n, off);
    fs.closeSync(fd);
    return b.toString('latin1');
  } catch { try { if (fd !== undefined) fs.closeSync(fd); } catch {} return ''; }
}

function parseSessionFile(file) {
  let st;
  try { st = fs.statSync(file); } catch { cache.delete(file); return null; }
  const c = cache.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.data;

  /* Trạng thái tích luỹ. Tách ra khỏi thân hàm để lần đọc sau nối tiếp được:
     toolIndex phải sống qua các lần đọc, nếu không tool_result nằm ở phần mới sẽ
     không tìm thấy tool_use của nó ở phần cũ và thẻ tool đứng mãi ở "pending". */
  const them = docPhanThem(file, c, st);
  // So với null tường minh: `them` là Buffer, mà Buffer rỗng vẫn là object (truthy),
  // còn null mới nghĩa là "phải parse lại toàn bộ".
  const S = them !== null ? c.state : {
    msgs: [],
    // tool_use_id -> part object; ghép result vào call. Ghép trên TOÀN file trước khi
    // slice window 30 -> call ở đầu window vẫn nhận được result nằm sau.
    toolIndex: new Map(),
    usage: { inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0, turns: 0 },
    aiTitle: '',   // Claude CLI tự sinh tiêu đề (dòng type=ai-title), lấy bản MỚI NHẤT
    /* Tên NGƯỜI DÙNG tự đặt trên Claude CLI (dòng type=custom-title). Trước đây bị bỏ
       qua hoàn toàn nên dashboard hiện tên máy sinh thay vì tên đã đặt — đếm thật:
       1.236 dòng trên máy Debian ("EDMICRO SSO", "video-library"…). */
    customTitle: '',
    firstUser: '', // dự phòng khi session chưa có ai-title: câu đầu của user
    model: '',     // model + mức nghĩ của lượt assistant mới nhất
    effort: '',
    du: '',        // dòng cuối bị cắt giữa chừng, ghép với phần đọc lần sau
    /* Ký tự UTF-8 bị cắt đôi ở ranh giới byte. StringDecoder giữ lại byte lẻ và nối
       vào lần decode sau, nên "xin chào" cắt giữa chữ "à" vẫn ra đúng chữ thay vì "�". */
    bd: new StringDecoder('utf8'),
    // "hook + nội dung lỗi" -> part đã hiện. Phải sống qua các lần đọc thêm, nếu
    // không mỗi lần đọc đuôi lại đẻ ra một dòng lỗi mới cho cùng một lỗi cũ.
    hookDaThay: new Map(),
  };
  const { msgs, toolIndex, usage } = S;
  let { aiTitle, customTitle, firstUser, model, effort } = S;

  let raw;
  if (them !== null) {
    // decoder.write() trả phần giải mã ĐƯỢC, giữ lại byte lẻ cuối cho lần sau
    raw = S.du + S.bd.write(them);
  } else {
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  }
  /* Phần mới có thể kết thúc giữa một dòng đang được ghi dở. Giữ lại đoạn thừa cho
     lần sau thay vì vứt (vứt là mất hẳn tin nhắn đó). Chỉ giữ khi file KHÔNG kết
     thúc bằng xuống dòng — kết thúc bằng \n nghĩa là dòng cuối đã trọn vẹn. */
  const dong = raw.split('\n');
  S.du = raw.endsWith('\n') ? '' : (dong.pop() ?? '');

  for (const line of dong) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type === 'ai-title') { if (obj.aiTitle) aiTitle = obj.aiTitle; continue; }
    // Tên do NGƯỜI DÙNG đặt trên CLI — thắng ai-title do máy sinh (xem titleOf)
    if (obj.type === 'custom-title') { if (obj.customTitle) customTitle = obj.customTitle; continue; }

    /* Các dòng dưới đây TRƯỚC ĐÂY BỊ BỎ HẾT bởi một câu `continue`. Đếm trên 180 file
       .jsonl thật: 11.881 hook chạy LỖI, 4.023 dòng subagent, 16 lỗi API (có cả 401
       hết hạn đăng nhập), 7 mốc /compact — không thứ nào hiện ra trên dashboard, nên
       phiên tự dưng đứt đoạn hoặc im lặng hỏng mà không biết vì sao. */

    /* Các dạng attachment KHÁC mà terminal có hiện còn dashboard thì không.
       Đếm thật trên phiên 58MB: 3.239 hook lỗi, 121 file vừa sửa, 20 lệnh xếp hàng,
       10 mốc thoát chế độ kế hoạch, 3 lần sang ngày mới. Terminal in hết; dashboard
       trước đây chỉ nhận mỗi hook lỗi, phần còn lại rơi vào hư không. */
    if (obj.type === 'attachment' && obj.attachment && !obj.attachment.hookName) {
      const a = obj.attachment;
      const ts = obj.timestamp || null;
      const note = (kind, title, body) => msgs.push({
        role: 'system', text: '', ts,
        parts: [{ t: 'note', kind, title, body: body ? clampText(String(body).trim(), 600) : '' }],
      });

      // Sang ngày mới — terminal in một vạch ngăn ngày
      if (a.type === 'date_change' && a.newDate) note('ngay', 'Sang ngày ' + a.newDate, '');
      // Lệnh gõ trong lúc Claude đang chạy -> xếp hàng, chạy sau
      else if (a.type === 'queued_command') {
        const t = Array.isArray(a.prompt)
          ? a.prompt.filter(x => x && x.type === 'text').map(x => x.text).join(' ')
          : String(a.prompt || '');
        note('hang-doi', 'Lệnh xếp hàng chờ tới lượt', t);
      }
      // Vào / ra chế độ kế hoạch
      else if (a.type === 'plan_mode') note('ke-hoach', 'Bật chế độ lập kế hoạch', '');
      else if (a.type === 'plan_mode_exit') note('ke-hoach', 'Thoát chế độ lập kế hoạch', '');
      // File Vinh kéo vào / dán vào khung chat
      else if (a.type === 'file' && a.filename) {
        note('dinh-kem', 'Đính kèm ' + base(a.filename), '');
      }
      continue;
    }

    /* Hook chạy lỗi: giữ lại để hiện; hook chạy OK thì bỏ (nhiều nghìn dòng, chỉ gây nhiễu).

       GỘP TOÀN PHIÊN, không gộp theo vị trí liền kề. Một hook cấu hình sai thì lỗi
       ở MỌI lần gọi tool: đếm thật trên phiên này được 548 dòng "Hook lỗi:
       PreToolUse:Bash" y hệt nhau trong 3000 dòng cuối. Nhưng chúng KHÔNG liền nhau
       (mỗi lỗi nằm cạnh một lần gọi tool khác nhau) — đã đo: 0/548 dòng liền kề,
       nên gộp kiểu "trùng với dòng ngay trước" hoàn toàn vô dụng.
       Vậy: giữ LẦN ĐẦU của mỗi lỗi (cùng hook + cùng nội dung), các lần sau chỉ
       tăng bộ đếm trên chính dòng đó. Vẫn biết có lỗi gì và lặp bao nhiêu lần,
       mà màn chat không bị chữ đỏ nuốt mất nội dung thật. */
    if (obj.type === 'attachment' && obj.attachment && obj.attachment.hookName) {
      const a = obj.attachment;
      if (a.exitCode) {
        const body = clampText(String(a.stderr || a.stdout || '').trim(), 600);
        const khoa = a.hookName + ' ' + body;
        const da = S.hookDaThay.get(khoa);
        if (da) {
          da.lap++;   // cùng lỗi đã hiện ở trên -> chỉ đếm thêm
        } else {
          const part = {
            t: 'note', kind: 'hook-error',
            title: 'Hook lỗi: ' + a.hookName,
            hook: a.hookName, lap: 1,
            body,
          };
          S.hookDaThay.set(khoa, part);
          msgs.push({ role: 'system', text: '', ts: obj.timestamp || null, parts: [part] });
        }
      }
      continue;
    }

    // Mốc /compact: hội thoại bị dọn ngữ cảnh ở đây, không phải tự dưng mất tin
    if (obj.type === 'system' && obj.subtype === 'compact_boundary') {
      msgs.push({
        role: 'system', text: '', ts: obj.timestamp || null,
        parts: [{ t: 'note', kind: 'compact', title: 'Đã dọn ngữ cảnh tại đây', body: '' }],
      });
      continue;
    }

    // Lỗi từ phía API (401 hết hạn đăng nhập, quá tải…) — trước đây im lặng hoàn toàn
    if (obj.type === 'system' && (obj.subtype === 'api_error' || obj.level === 'error')) {
      const em = (obj.error && obj.error.message) || obj.content || '';
      msgs.push({
        role: 'system', text: '', ts: obj.timestamp || null,
        parts: [{ t: 'note', kind: 'api-error', title: 'Lỗi từ máy chủ Claude', body: clampText(String(em).trim(), 400) }],
      });
      continue;
    }

    if (obj.type !== 'user' && obj.type !== 'assistant') continue;
    /* Model + mức nghĩ của phiên: mỗi dòng assistant ghi sẵn, lấy dòng MỚI NHẤT.
       Đếm trên 8.000 dòng đầu phiên control: 2.734 dòng có message.model, 2.732 có
       effort. Lưu ý effort nằm ở CẤP CAO NHẤT của dòng, không nằm trong message. */
    if (obj.message && obj.message.model) model = obj.message.model;
    if (obj.effort) effort = obj.effort;
    // token đã dùng: CLI ghi sẵn usage mỗi lượt assistant -> cộng dồn, khỏi gọi /cost
    const u = obj.message && obj.message.usage;
    if (u) {
      usage.inTok += u.input_tokens || 0;
      usage.outTok += u.output_tokens || 0;
      usage.cacheRead += u.cache_read_input_tokens || 0;
      usage.cacheWrite += u.cache_creation_input_tokens || 0;
      usage.turns++;
    }
    const m = obj.message || obj;
    const content = m.content;
    const parts = [];

    if (Array.isArray(content)) {
      for (const b of content) {
        if (typeof b === 'string') { if (b.trim()) parts.push({ t: 'text', text: b }); continue; }
        if (!b) continue;
        if (b.type === 'text') { if ((b.text || '').trim()) parts.push({ t: 'text', text: b.text }); }
        else if (b.type === 'tool_use') {
          const part = {
            t: 'tool',
            id: b.id || '',
            name: b.name || 'tool',
            disp: toolDisplayName(b.name),
            summary: summarizeToolInput(b.name, b.input),
            input: buildInputDetail(b.name, b.input),
            status: 'pending',
            result: '',
            images: [],
          };
          // TodoWrite: gửi kèm danh sách có cấu trúc để client vẽ checklist thật,
          // thay vì đổ JSON thô ra khối code như mọi tool khác
          if (b.name === 'TodoWrite') part.todos = extractTodos(b.input);

          /* AskUserQuestion / ExitPlanMode: trên terminal đây là bảng chọn có phím số
             và khung kế hoạch, còn trên dashboard chúng rơi vào thẻ tool chung nên
             hiện ra JSON THÔ với dấu ngoặc thoát chồng chất — không đọc nổi.
             Tách dữ liệu có cấu trúc để client vẽ đúng như CLI. */
          if (b.name === 'AskUserQuestion') part.hoi = extractHoi(b.input);
          if (b.name === 'ExitPlanMode') {
            part.ke = extractKeHoach(b.input);
            part.keFile = extractFileKeHoach(b.input);
          }
          parts.push(part);
          if (b.id) toolIndex.set(b.id, part);
        } else if (b.type === 'tool_result') {
          // Gắn vào card của call tương ứng; message user thuần tool_result KHÔNG phát ra bubble
          const target = toolIndex.get(b.tool_use_id);
          if (target) {
            const pv = toolResultPreview(b.content);
            target.status = b.is_error ? 'error' : 'ok';
            target.result = pv.text;
            target.images = pv.images;
          }
          // orphan (call đã trôi khỏi file / jsonl hỏng) -> bỏ im lặng
        } else if (b.type === 'thinking') {
          // Claude CLI có hiện phần suy nghĩ; dashboard trước đây vứt sạch.
          // Giữ lại nhưng CLAMP: thinking dài hàng chục KB, nhồi hết vào payload poll 2s là phí.
          const tk = String(b.thinking || '').trim();
          if (tk) parts.push({ t: 'think', text: clampText(tk, THINK_CAP) });
        }
        // block lạ khác: bỏ
      }
    } else {
      const text = extractText(content);
      if (text.trim()) parts.push({ t: 'text', text });
    }

    if (!parts.length) continue;
    const text = flattenParts(parts);
    if (!text.trim()) continue;
    if (!firstUser && obj.type === 'user') {
      // bỏ lệnh slash / output hệ thống, lấy câu người thật gõ
      const t = text.trim();
      if (t[0] !== '/' && t.indexOf('<') !== 0) firstUser = t;
    }
    // isSidechain = lượt của subagent (Task/Agent), không phải hội thoại chính.
    // 4.023 dòng trên máy này. Không đánh dấu thì lời của subagent trộn lẫn vào
    // lời Claude, đọc không hiểu ai đang nói.
    msgs.push({ role: obj.type, text, ts: obj.timestamp || null, parts, sub: !!obj.isSidechain });
  }
  // tsMs: timestamp (ms) từng message — precompute 1 lần để đếm unread không tốn Date.parse mỗi tick
  /* Tiêu đề: tên NGƯỜI DÙNG đặt trên CLI thắng ai-title do máy sinh. Trước đây chỉ
     đọc ai-title nên phiên Vinh đặt tên "video-library" vẫn hiện
     "Kiểm tra job video và huỷ đồng bộ Dailymotion". */
  const title = customTitle || aiTitle
    || (firstUser ? firstUser.replace(/\s+/g, ' ').slice(0, 70) : '');
  // Chế độ plan: Claude ghi kế hoạch ra ~/.claude/plans/*.md rồi DỪNG, không đụng file đích.
  // Lượt cuối là assistant + có nhắc tới file kế hoạch => đang chờ người duyệt.
  const lastMsg = msgs[msgs.length - 1];
  const planFile = lastMsg && lastMsg.role === 'assistant'
    ? (lastMsg.text.match(/[^\s`'"]*\.claude\/plans\/[^\s`'")]+\.md/) || [null])[0]
    : null;

  /* Phiên đang ĐỨNG IM CHỜ NGƯỜI BẤM — thứ phải đập vào mắt ở danh sách.
     Trước đây chỉ dò chuỗi ".claude/plans/*.md" trong văn bản lượt cuối, bỏ sót nhiều:
     đếm trên .jsonl thật có 201 lần ExitPlanMode và 101 lần AskUserQuestion.
     Dò theo TÊN TOOL chưa có kết quả thì chắc hơn hẳn khớp chuỗi. */
  const cho = (() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'system') continue;
      if (m.role !== 'assistant') return '';   // người dùng đã trả lời -> hết chờ
      for (const p of (m.parts || [])) {
        if (p.t !== 'tool' || p.status !== 'pending') continue;
        if (p.name === 'ExitPlanMode') return 'ke-hoach';
        if (p.name === 'AskUserQuestion') return 'cau-hoi';
      }
      return '';   // lượt assistant cuối không có tool chờ -> không chờ gì
    }
    return '';
  })();

  /* Lệnh Claude ĐANG chạy dở: tool_use chưa có tool_result ở lượt cuối.
     Khác `tinCuoi`: chỗ đó ưu tiên câu chữ nên tool bị `break` nuốt mất, thực tế gần
     như không bao giờ hiện được "đang chạy Bash". */
  const dangChay = (() => {
    const m = msgs[msgs.length - 1];
    if (!m || m.role !== 'assistant') return '';
    const t = (m.parts || []).find(p => p.t === 'tool' && p.status === 'pending');
    if (!t) return '';
    return (t.disp || t.name || '') + (t.summary ? '(' + t.summary + ')' : '');
  })();

  const data = {
    msgs, mtimeMs: st.mtimeMs, title, planFile, usage, model, effort, cho, dangChay,
    tsMs: msgs.map(m => Date.parse(m.ts) || 0),
  };
  // Ghi lại giá trị đã cập nhật trong vòng lặp để lần đọc thêm sau nối tiếp đúng.
  S.aiTitle = aiTitle; S.customTitle = customTitle;
  S.firstUser = firstUser; S.model = model; S.effort = effort;
  // moc = MOC_KIEM byte cuối file, dùng lần sau để chắc phần đầu chưa bị ghi đè.
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, data, state: S, moc: mocCuoi(file, st.size) });
  return data;
}

// Đọc lịch sử chat 1 session (30 message cuối) — dùng chung cache mtime của parseSessionFile,
// tránh đọc + parse lại cả file JSONL mỗi lần client poll (2s/lần khi mở chat).
function getHistory(sid) {
  const file = findSessionFile(sid);
  if (!file) return null;
  const parsed = parseSessionFile(file);
  if (!parsed) return null;
  return parsed.msgs.slice(-30).map(m => ({ role: m.role, content: m.text, ts: m.ts, parts: m.parts }));
}

/* ---- tên tự đặt: ghi riêng của dashboard, ĐÈ ai-title của Claude CLI ----
   Không sửa file .jsonl của Claude CLI (nó là dữ liệu gốc, CLI có thể ghi đè bất cứ lúc nào). */
const TITLES_FILE = path.join(os.homedir(), '.claude', 'dashboard-titles.json');
let customTitles = null;
function loadTitles() {
  if (customTitles) return customTitles;
  try { customTitles = JSON.parse(fs.readFileSync(TITLES_FILE, 'utf8')); }
  catch { customTitles = {}; }
  return customTitles;
}
function setTitle(sid, name) {
  const t = loadTitles();
  if (name) t[sid] = name; else delete t[sid]; // xoá tên tự đặt -> quay về ai-title
  try { ghiJson(TITLES_FILE, t); } catch { return false; }
  return true;
}
// Tiêu đề hiển thị: tên tự đặt > ai-title (Claude CLI) > câu đầu của user > rỗng
function titleOf(sid, parsedTitle) {
  return loadTitles()[sid] || parsedTitle || '';
}

/* ---- model riêng từng phiên ----
   /model trước đây đổi model TOÀN CỤC, nên đang chạy Opus cho việc khó mà mở phiên
   khác là dính theo. Lưu riêng theo sid, ưu tiên hơn model toàn cục. */
const MODELS_FILE = path.join(os.homedir(), '.claude', 'dashboard-models.json');
let sessionModels = null;
function loadModels() {
  if (sessionModels) return sessionModels;
  try { sessionModels = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8')); } catch { sessionModels = {}; }
  return sessionModels;
}
function setSessionModel(sid, model) {
  const t = loadModels();
  if (model) t[sid] = model; else delete t[sid]; // xoá = quay về model toàn cục
  try { ghiJson(MODELS_FILE, t); } catch { return false; }
  return true;
}
function modelFor(sid) { return loadModels()[sid] || currentModel || null; }

// Nhãn cho thông báo đẩy: ưu tiên tiêu đề, không có mới rơi về ID
// (thông báo "Claude 7e31e9e3 đã trả lời xong" đọc xong vẫn không biết là phiên nào)
function sessionLabel(sid) {
  let t = loadTitles()[sid];
  if (!t) {
    const file = findSessionFile(sid);
    const parsed = file ? parseSessionFile(file) : null;
    t = parsed && parsed.title;
  }
  return t ? (t.length > 60 ? t.slice(0, 60) + '…' : t) : 'Claude ' + sid.slice(0, 8);
}

/* ---- thư mục làm việc của phiên ----
   Claude CLI tìm phiên theo CWD: chạy `--resume <sid>` từ thư mục khác sẽ báo
   "No conversation found with session ID" và tin nhắn RƠI VÀO HƯ KHÔNG.
   Dashboard trước đây luôn spawn từ home -> mọi phiên không thuộc home đều không
   nhắn được. Mỗi dòng .jsonl có sẵn trường cwd -> đọc ra để spawn đúng chỗ. */
const cwdCache = new Map(); // sid|file -> { duongDan, conTonTai } (bất biến trong 1 phiên)

/* Đọc cwd thô + cho biết thư mục còn không.
   Tách khỏi sessionCwd() vì hai bên cần hai thứ khác nhau: spawn cần "chỗ chạy được"
   (thư mục xoá rồi thì phải rơi về home), còn danh sách cần "chỗ ĐÁNG LẼ chạy" để in
   cảnh báo. Gộp làm một là mất đúng cái đường dẫn cần cảnh báo. */
function docCwd(file) {
  if (!file) return { duongDan: null, conTonTai: false };
  if (cwdCache.has(file)) return cwdCache.get(file);
  let r = { duongDan: null, conTonTai: false };
  try {
    // cwd nằm ngay dòng user đầu tiên — đọc 64KB đầu là đủ, khỏi nạp file 30MB
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(65536);
    const n = fs.readSync(fd, buf, 0, 65536, 0);
    fs.closeSync(fd);
    const m = buf.toString('utf8', 0, n).match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    if (m) {
      const p = JSON.parse('"' + m[1] + '"');
      r = { duongDan: p, conTonTai: fs.existsSync(p) };
    }
  } catch {}
  cwdCache.set(file, r);
  return r;
}

// Giữ NGUYÊN ngữ nghĩa cũ: thư mục đã bị xoá -> null, spawnClaude rơi về home.
function sessionCwd(sid) {
  const r = docCwd(findSessionFile(sid));
  return r.conTonTai ? r.duongDan : null;
}

/* ---- thông tin dự án của một phiên ----
   Trước đây tên dự án được SUY từ tên thư mục ~/.claude/projects (cắt 2 đoạn cuối nối
   bằng "/"), cho ra "agy/proxy", "dalianperfume/com" (mất chữ volvo), "plastic/".
   cwd là dữ liệu thật, có sẵn ở mọi phiên -> lấy thẳng. */

// Thư mục nháp do chính Claude sinh ra cho phiên tạm. Kiểm TIỀN TỐ, không dùng
// includes('scratchpad') — một dự án thật tên ~/project/scratchpad sẽ bị xếp nhầm.
// Phải liệt kê cả /tmp và /private/tmp: macOS symlink /tmp -> /private/tmp nên cwd
// ghi ra dạng nào cũng có. Không dùng os.tmpdir(): trên macOS nó trả /var/folders/...
const TIEN_TO_NHAP = ['/private/tmp/claude-', '/tmp/claude-'];

function laDuongDanNhap(p) {
  return TIEN_TO_NHAP.some(t => p.startsWith(t));
}

function gonNha(p) {
  const h = os.homedir();
  return p === h ? '~' : p.startsWith(h + path.sep) ? '~' + p.slice(h.length) : p;
}

/* ---- repo GitHub + nhánh, chạy NỀN ----
   Đo thật: đọc git 20 thư mục mất 370ms. listSessions() chạy đồng bộ trong tay xử lý
   request, nên gọi git ở đó là chặn cả event loop mỗi chu kỳ SSE (2s/lần).
   Vậy: listSessions CHỈ ĐỌC cache, không bao giờ chờ. Cache trống -> repo rỗng, giao
   diện rơi về hiện đường dẫn; vài trăm ms sau có repo. Khoá theo cwd (20 thư mục),
   không theo sid (133 phiên) — cùng một việc, làm 20 lần thay vì 133. */
const gitCache = new Map(); // cwd -> { repo, nhanh }
let dangDocGit = false;

// git@github.com:mvng267/control-center.git | https://github.com/mvng267/control-center
// -> mvng267/control-center
function gonRepo(url) {
  const m = String(url).trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1] : '';
}

function chayGit(cwd, args) {
  return new Promise(ok => {
    // execFile không qua shell: đường dẫn có dấu cách ("amc video") vẫn an toàn.
    // timeout phòng thư mục nằm trên ổ mạng bị treo.
    execFile('git', ['-C', cwd, ...args], { timeout: 3000 }, (e, out) => ok(e ? '' : String(out).trim()));
  });
}

async function docGitMotThuMuc(cwd) {
  // BẪY ĐÃ ĐO: `git -C agy-proxy/web remote get-url origin` trả về repo của THƯ MỤC CHA
  // (agy-proxy) vì web/ nằm trong cùng repo. Chỉ nhận khi gốc repo TRÙNG KHỚP cwd.
  const goc = await chayGit(cwd, ['rev-parse', '--show-toplevel']);
  if (!goc || path.resolve(goc) !== path.resolve(cwd)) return { repo: '', nhanh: '' };
  const [url, nhanh] = await Promise.all([
    chayGit(cwd, ['remote', 'get-url', 'origin']),
    chayGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ]);
  return { repo: gonRepo(url), nhanh: nhanh === 'HEAD' ? '' : nhanh };
}

async function napGit(dsCwd) {
  if (dangDocGit) return; // chống hai chu kỳ chồng nhau
  dangDocGit = true;
  try {
    for (const cwd of dsCwd) {
      // GHI CẢ KHI THẤT BẠI: thư mục không phải repo mà không ghi thì mỗi chu kỳ lại
      // thử lại vô ích.
      gitCache.set(cwd, await docGitMotThuMuc(cwd));
    }
  } finally { dangDocGit = false; }
}

const DU_AN_MOI = { ten: '(mới)', khoa: '(new)', duongDan: '', repo: '', nhanh: '', conTonTai: true, laNhap: false };

function duAnCho(cwd) {
  if (!cwd.duongDan) return { ...DU_AN_MOI, ten: '(không rõ)', khoa: '(unknown)' };
  const p = cwd.duongDan;
  /* Bỏ dấu cách/gạch chéo thừa ở CUỐI khi gom nhóm. Đã gặp thật:
     ".../Van thong plastic" (repo mvng267/nhua-van-thong, 12 mục) và
     ".../Van thong plastic " (rỗng hoàn toàn) là hai thư mục có thật trên đĩa —
     macOS cho phép tên kết thúc bằng dấu cách — nhưng cùng MỘT dự án, chỉ là một lần
     gõ nhầm. Không chuẩn hoá thì danh sách lọc có hai mục trùng tên y hệt nhau. */
  const khoa = p.replace(/[\s/]+$/, '') || p;
  // Tra git theo khoa (đã chuẩn hoá) -> bản gõ nhầm dùng chung repo với bản đúng.
  const g = gitCache.get(khoa) || {};
  return {
    ten: path.basename(khoa) || khoa,
    khoa,                          // gom theo cwd (đã chuẩn hoá): hai dự án có thể trùng basename
    duongDan: gonNha(p),
    repo: g.repo || '',
    nhanh: g.nhanh || '',
    conTonTai: cwd.conTonTai,
    laNhap: laDuongDanNhap(p),
  };
}

/* ---- danh sách file trong thư mục dự án, phục vụ gợi ý "@" ----
   Quét cây thư mục mỗi lần gõ một chữ thì repo vài chục nghìn file sẽ treo cả server,
   nên nhớ tạm 30 giây. Bỏ qua nhóm thư mục sinh tự động (node_modules, .git, build…):
   chúng chiếm phần lớn số file mà không bao giờ là thứ muốn nhắc tới.
   Chặn trần 4000 file để repo khổng lồ không nuốt hết RAM. */
const BO_QUA = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out',
  'coverage', '.cache', '.venv', '__pycache__', 'vendor', '.turbo']);
const QUET_TRAN = 4000;
const quetCache = new Map(); // root -> { at, files }

function quetFile(root) {
  const cu = quetCache.get(root);
  if (cu && Date.now() - cu.at < 30000) return cu.files;
  const files = [];
  const di = (dir, sau) => {
    if (files.length >= QUET_TRAN || sau > 6) return;
    let ds;
    try { ds = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ds) {
      if (files.length >= QUET_TRAN) return;
      if (e.name.startsWith('.') && e.name !== '.env.example') continue;
      if (e.isDirectory()) {
        if (!BO_QUA.has(e.name)) di(path.join(dir, e.name), sau + 1);
      } else if (e.isFile()) {
        files.push(path.relative(root, path.join(dir, e.name)));
      }
    }
  };
  di(root, 0);
  files.sort();
  quetCache.set(root, { at: Date.now(), files });
  return files;
}

function findSessionFile(sid) {
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(PROJECTS_DIR, d, sid + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function statusOf(sid, mtimeMs) {
  if (procs.has(sid)) return 'RUNNING';
  if (mtimeMs && Date.now() - mtimeMs < 15000) return 'ACTIVE';
  return 'IDLE';
}

/* BẤT ĐỒNG BỘ có chủ đích. parseSessionFile đọc + parse TOÀN BỘ file .jsonl; máy này
   có 453MB, file lớn nhất 126MB. Lần quét lạnh mất ~2 giây, và vì trước đây hàm chạy
   đồng bộ ngay trong tay xử lý request nên nó CHẶN CẢ EVENT LOOP: đo được
   /api/passcode/status (API rỗng) mất 2.069ms mới trả lời.
   Nhả nhịp sau mỗi phiên NẶNG (chưa có trong cache) để request khác chen vào được.
   Phiên đã cache thì bỏ qua, không nhả — nếu không mỗi tick SSE tốn 133 lần setImmediate
   vô ích. */
const nhaNhip = () => new Promise(r => setImmediate(r));

async function listSessions() {
  const out = [];
  const canDocGit = new Set(); // thư mục chưa có trong gitCache -> để vòng nền đọc sau
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_DIR); } catch { return out; }
  for (const d of dirs) {
    const dir = path.join(PROJECTS_DIR, d);
    let files;
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    } catch { continue; }
    for (const f of files) {
      const full = path.join(dir, f);
      const sid = f.replace(/\.jsonl$/, '');
      const re = docReTien(full);
      const parsed = parseSessionFile(full);
      if (!parsed) continue;
      if (!re) await nhaNhip();
      /* Tên dự án lấy từ cwd trong chính file, KHÔNG suy từ tên thư mục nữa.
         Tên thư mục là cwd đã bị thay mọi ký tự đặc biệt bằng "-", nên không khôi phục
         ngược được: "agy-proxy" và "agy/proxy" cho ra cùng một tên thư mục. */
      const duAn = duAnCho(docCwd(full));
      // Thư mục còn tồn tại mới đáng hỏi git; thư mục đã xoá hỏi cũng chỉ tốn 3s timeout.
      if (duAn.conTonTai && !gitCache.has(duAn.khoa)) canDocGit.add(duAn.khoa);
      // lần đầu server thấy session -> coi như đã xem hết (không báo unread cũ)
      if (!lastSeen.has(sid)) lastSeen.set(sid, parsed.mtimeMs);
      const seen = lastSeen.get(sid);
      const unread = parsed.tsMs.reduce((n, t) => n + (t > seen ? 1 : 0), 0);
      /* Thẻ phiên cần nhiều hơn một dòng tiêu đề: xem lướt là biết phiên nào đáng mở.
         Mấy trường dưới đây parseSessionFile ĐÃ tính sẵn, trước giờ chỉ bị bỏ không.
         Không đọc thêm file nào, nên danh sách không chậm đi. */
      /* Lấy tin cuối ĐỌC ĐƯỢC. Hai cái bẫy:
         - tin cuối tuyệt đối rất hay là dòng system rỗng (hook lỗi, mốc /compact);
         - lượt chỉ chạy tool bị đè phẳng thành "[tool: Bash]", vô nghĩa với người đọc.
         Nên: ưu tiên câu chữ thật; không có thì mới nói phiên đang chạy tool gì. */
      let cuoi = null;
      let toolCuoi = '';
      for (let i = parsed.msgs.length - 1; i >= 0 && !cuoi; i--) {
        const m = parsed.msgs[i];
        if (m.role === 'system') continue;
        const chu = (m.parts || []).filter(p => p.t === 'text')
          .map(p => p.text).join(' ').replace(/\s+/g, ' ').trim();
        if (chu) { cuoi = { role: m.role, text: chu }; break; }
        if (!toolCuoi) {
          const tl = (m.parts || []).find(p => p.t === 'tool');
          if (tl) toolCuoi = tl.disp || tl.name || '';
        }
      }
      if (!cuoi && toolCuoi) cuoi = { role: 'assistant', text: 'đang chạy ' + toolCuoi };
      out.push({
        sid,
        // GIỮ project là CHUỖI: giao diện cũ (web/legacy) và tab Thống kê đọc nó làm
        // khoá gom nhóm. Đổi sang object thì donut gom theo "[object Object]" — hỏng
        // âm thầm, không ném lỗi, test không bắt được.
        project: duAn.ten,
        duAn,
        title: titleOf(sid, parsed.title),
        msgs: parsed.msgs.length,
        unread,
        mtimeMs: parsed.mtimeMs,
        status: statusOf(sid, parsed.mtimeMs),
        // ai nói câu cuối + trích câu đó -> biết phiên dừng ở đâu mà chưa cần mở
        vaiCuoi: cuoi ? cuoi.role : '',
        tinCuoi: cuoi ? clampText(String(cuoi.text || '').replace(/\s+/g, ' '), 160) : '',
        // token của cả phiên (CLI ghi sẵn mỗi lượt) — biết phiên nào đang ngốn
        tok: (parsed.usage.inTok || 0) + (parsed.usage.outTok || 0),
        // cacheRead/cacheWrite parseSessionFile đã cộng sẵn, trước giờ bị vứt đi
        tokDoc: parsed.usage.cacheRead || 0,
        tokGhi: parsed.usage.cacheWrite || 0,
        luot: parsed.usage.turns || 0,
        // model + mức nghĩ lấy từ chính .jsonl (dòng assistant cuối), không phải từ
        // dashboard-models.json — file đó chỉ có rác test, không ứng với phiên nào
        model: parsed.model || '',
        effort: parsed.effort || '',
        /* Đang ĐỨNG IM chờ người bấm — phải nhìn thấy NGAY ở danh sách.
           choDuyet giữ kiểu boolean cho giao diện cũ (web/legacy) khỏi vỡ;
           `cho` mang lý do cụ thể: 'ke-hoach' | 'cau-hoi'. */
        choDuyet: !!(parsed.cho || parsed.planFile),
        cho: parsed.cho || (parsed.planFile ? 'ke-hoach' : ''),
        // lệnh Claude đang chạy dở (tool chưa có kết quả) — chỉ có nghĩa khi RUNNING
        dangChay: parsed.dangChay || '',
      });
    }
  }
  // sessions we spawned that have no jsonl yet
  for (const [sid, p] of procs) {
    if (!out.find(s => s.sid === sid)) {
      // Hai chỗ gọi spawnClaude chỉ truyền { task, project }, KHÔNG có cwd -> không suy
      // ra dự án được. Vẫn phải có duAn, nếu không giao diện vỡ khi đọc s.duAn.ten.
      out.push({
        sid, project: p.project || '(new)', duAn: { ...DU_AN_MOI },
        msgs: 0, unread: 0, mtimeMs: p.startedAt, status: 'RUNNING',
      });
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  // Đọc git ở NỀN, sau khi đã trả kết quả — không chặn request nào.
  if (canDocGit.size) setTimeout(() => napGit([...canDocGit]), 0);
  // KHÔNG cắt 100: máy có 133 phiên, 33 phiên biến mất mà không báo gì. Phân trang lo.
  return out;
}

/* ---------------- spawning claude ---------------- */

// sid -> thông báo lỗi lần chạy gần nhất (client hiện lên thay vì im lặng)
const spawnErrors = new Map();

function spawnClaude(args, sid, meta) {
  // CWD phải đúng thư mục của phiên, nếu không `--resume` báo "No conversation found"
  // và tin nhắn rơi vào hư không (API vẫn trả ok -> nhìn như gửi được mà chẳng có gì xảy ra)
  const cwd = (meta && meta.cwd) || sessionCwd(sid) || os.homedir();
  const proc = spawn('claude', args, {
    cwd,
    // KHÔNG detached: tiến trình tách nhóm thì Node không nhận được sự kiện exit/stderr,
    // nên mọi lỗi của CLI (vd resume trượt) bị nuốt sạch — đúng cái làm chat "gửi mà
    // không có gì xảy ra". Server sống lâu nên không cần detach để tiến trình chạy tiếp.
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  spawnErrors.delete(sid);
  let errBuf = '', outBuf = '';
  if (proc.stderr) {
    proc.stderr.on('data', d => { errBuf = (errBuf + d.toString()).slice(-2000); });
    proc.stderr.on('error', () => {});
  }
  if (proc.stdout) {
    /* Chữ Claude đang trả về, hiện NGAY thay vì đợi cả lượt xong.
       .jsonl chỉ được ghi KHI LƯỢT XONG, nên trước đây màn hình đứng im rồi bung ra
       một cục. Đo thật: `claude -p` thường xả stdout ĐÚNG MỘT LẦN lúc kết thúc
       (5747ms/1 lần) — nên đọc stdout trần là vô ích. Phải có `--output-format
       stream-json --include-partial-messages` mới nhận được từng đoạn: đo lại thấy
       chữ tới rải rác từ 5209ms qua 13 lần.
       Gom `delta.text` của các `stream_event`; phần còn lại là siêu dữ liệu, bỏ. */
    let du = '';
    proc.stdout.on('data', d => {
      /* Giữ 2000 ký tự ĐẦU, không phải cuối. Ở chế độ stream-json mỗi sự kiện là một
         khối JSON dài, nên cửa sổ trượt-về-cuối đẩy trôi mất câu báo lỗi nằm ở đầu —
         đo thật: gửi vào sid không tồn tại thì banner lỗi biến mất hoàn toàn, tin
         nhắn rơi vào hư không đúng như bệnh cũ. */
      if (outBuf.length < 2000) outBuf = (outBuf + d.toString()).slice(0, 2000);
      const e = procs.get(sid);
      if (!e || !meta || !meta.stream) return;
      du += d.toString();
      const dong = du.split('\n');
      du = dong.pop() || '';                  // dòng cuối có thể còn dở
      for (const L of dong) {
        if (!L.trim()) continue;
        let o; try { o = JSON.parse(L); } catch { continue; }
        const t = o.type === 'stream_event' && o.event && o.event.delta && o.event.delta.text;
        if (t) e.nhap = (String(e.nhap || '') + t).slice(-8000);
      }
    });
    proc.stdout.on('error', () => {});
  }
  proc.on('error', e => {
    procs.delete(sid);
    spawnErrors.set(sid, { at: Date.now(), msg: 'Không chạy được claude: ' + e.message });
  });
  proc.on('exit', (code, signal) => {
    procs.delete(sid);
    if (signal) return; // bị kill chủ động (nút Kill) -> không báo gì
    const err = errBuf.trim();
    // soi cả 2 luồng cho chắc (CLI có thể đổi chỗ in giữa các phiên bản)
    const failedResume = /No conversation found with session ID/i.test(errBuf + outBuf);
    if (code !== 0 || err || failedResume) {
      const msg = failedResume
        ? 'Claude CLI không tìm thấy phiên này (thư mục dự án gốc có thể đã bị xoá/đổi tên) — tin nhắn chưa được gửi.'
        : (err || 'claude thoát với mã ' + code);
      spawnErrors.set(sid, { at: Date.now(), msg: msg.split('\n').slice(0, 3).join(' ').slice(0, 300) });
      notifyPush(sessionLabel(sid) + ': ' + (failedResume ? 'không gửi được tin' : 'chạy lỗi'), sid);
      return; // thất bại thì đừng báo "đã trả lời xong"
    }
    notifyPush(sessionLabel(sid) + ' đã trả lời xong', sid);
  });
  procs.set(sid, { proc, startedAt: Date.now(), ...meta });
  return proc;
}

/* ---------------- oneshot / jobs ---------------- */

// Chạy claude 1-shot lấy stdout — dùng cho enhance/summary. Timeout 120s.
function runOneshot(prompt) {
  const id = crypto.randomUUID();
  const rec = { status: 'running', output: '' };
  oneshots.set(id, rec);
  try {
    const proc = spawn('claude', ['-p', prompt], { cwd: os.homedir(), env: process.env });
    let errBuf = '';
    proc.stdout.on('data', d => { rec.output += d.toString(); });
    proc.stderr.on('data', d => { errBuf += d.toString(); });
    proc.on('error', e => { rec.status = 'error'; rec.output += '[spawn error] ' + e.message; });
    const killer = setTimeout(() => {
      if (rec.status === 'running') {
        try { proc.kill('SIGTERM'); } catch {}
        rec.status = 'error';
        rec.output += '\n[timeout 120s]';
      }
    }, 120000);
    proc.on('close', code => {
      clearTimeout(killer);
      if (rec.status === 'running') rec.status = code === 0 ? 'done' : 'error';
      if (rec.status === 'error' && errBuf) rec.output += '\n' + errBuf.slice(-2000);
    });
  } catch (e) { rec.status = 'error'; rec.output = e.message; }
  // client poll xong trong <=120s (timeout) — dọn record sau 10 phút, tránh Map lớn dần mãi
  setTimeout(() => oneshots.delete(id), 600000).unref();
  return id;
}

// Parse interval kiểu '30s' / '5m' / '1h' -> ms, sai cú pháp trả null
function parseInterval(s) {
  const m = /^(\d+)([smh])$/.exec((s || '').trim());
  if (!m) return null;
  const n = +m[1];
  if (!n) return null;
  return m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60000 : n * 3600000;
}

// Chạy 1 lượt của loop/cron job: mỗi lượt là 1 session claude mới
function runJob(job) {
  const sid = crypto.randomUUID();
  const args = ['-p', job.prompt, '--session-id', sid].concat(permArgs(), effortArgs());
  if (currentModel) args.push('--model', currentModel);
  spawnClaude(args, sid, { task: job.prompt, project: '(job:' + job.id + ')' });
  job.runs++;
  job.lastSid = sid;
}

// ---- cron tối giản: 5 trường "phút giờ ngày tháng thứ", hỗ trợ * , */n , a-b , a,b ----
function cronFieldMatch(field, val) {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    const step = /^\*\/(\d+)$/.exec(part);
    if (step) { if (+step[1] > 0 && val % +step[1] === 0) return true; continue; }
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) { if (val >= +range[1] && val <= +range[2]) return true; continue; }
    if (String(+part) === part && +part === val) return true;
  }
  return false;
}
function cronMatch(spec, d) {
  const f = spec.trim().split(/\s+/);
  if (f.length !== 5) return false;
  return cronFieldMatch(f[0], d.getMinutes()) && cronFieldMatch(f[1], d.getHours())
    && cronFieldMatch(f[2], d.getDate()) && cronFieldMatch(f[3], d.getMonth() + 1)
    && cronFieldMatch(f[4], d.getDay());
}
// Ticker 30s check cron jobs — mỗi phút khớp chỉ chạy đúng 1 lần (lastKey)
setInterval(() => {
  const d = new Date();
  const key = d.toISOString().slice(0, 16);
  for (const job of jobs.values()) {
    if (job.kind !== 'cron' || job.lastKey === key) continue;
    if (cronMatch(job.spec, d)) { job.lastKey = key; runJob(job); }
  }
}, 30000);

// Danh sách jobs gọn cho client
function listJobs() {
  return [...jobs.values()].map(j => ({
    id: j.id, kind: j.kind, spec: j.spec,
    prompt: j.prompt.slice(0, 80), runs: j.runs, lastSid: j.lastSid,
  }));
}

/* ---------------- Hermes (state.db SQLite qua sqlite3 CLI) ---------------- */

// Cache 1.5s — client poll 2.5s (realtime), vẫn tránh spawn sqlite3 dồn dập khi nhiều client
let hermesCache = { at: 0, data: null };
let hermesSending = 0; // số hermes CLI process đang chờ reply — client hiện typing indicator thật

function sqliteJson(sql) {
  return new Promise(resolve => {
    execFile('sqlite3', ['-readonly', '-json', HERMES_DB, sql],
      { maxBuffer: 16 * 1024 * 1024, timeout: 8000 },
      (err, out) => {
        if (err) return resolve(null);
        try { resolve(JSON.parse(out || '[]')); } catch { resolve(null); }
      });
  });
}

// Fallback khi không đọc được SQLite: parse agent.log ([USER]/[ASSISTANT])
function hermesFromLog() {
  let raw;
  try { raw = fs.readFileSync(HERMES_LOG, 'utf8'); } catch { return []; }
  const messages = [];
  for (const line of raw.split('\n').slice(-2000)) {
    let role = null;
    if (line.includes('[USER]')) role = 'user';
    else if (line.includes('[ASSISTANT]')) role = 'assistant';
    if (!role) continue;
    const content = line.replace(/^.*\[(USER|ASSISTANT)\]\s*/, '').trim();
    if (content) messages.push({ role, content, ts: 0 });
  }
  if (!messages.length) return [];
  return [{ id: 'agent.log', title: 'agent.log (fallback)', source: 'log', count: messages.length, lastTs: 0, messages: messages.slice(-50) }];
}

// GET /api/hermes -> { conversations: [{id,title,source,count,lastTs,messages:[{role,content,ts}]}] }
async function getHermesData() {
  if (hermesCache.data && Date.now() - hermesCache.at < 1500) return hermesCache.data;
  let conversations = null;

  if (fs.existsSync(HERMES_DB)) {
    const sess = await sqliteJson(
      "SELECT id, source, display_name, title, message_count, last_activity_at " +
      "FROM sessions WHERE message_count > 0 ORDER BY last_activity_at DESC LIMIT 15;");
    if (sess && sess.length) {
      // 1 query duy nhất lấy 30 message cuối của mỗi session (window function)
      const ids = sess.map(s => "'" + String(s.id).replace(/'/g, "''") + "'").join(',');
      const msgs = await sqliteJson(
        "SELECT session_id, role, substr(COALESCE(content,''),1,4000) AS content, timestamp FROM (" +
        "  SELECT session_id, role, content, timestamp," +
        "         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp DESC) rn" +
        "  FROM messages WHERE active=1 AND role IN ('user','assistant','tool')" +
        "  AND session_id IN (" + ids + ")" +
        ") WHERE rn <= 30 ORDER BY session_id, timestamp;");
      if (msgs) {
        const bySid = {};
        for (const m of msgs) {
          (bySid[m.session_id] = bySid[m.session_id] || []).push({
            role: m.role,
            content: m.content || '',
            ts: Math.round((m.timestamp || 0) * 1000), // epoch giây -> ms
          });
        }
        conversations = sess.map(s => ({
          id: s.id,
          title: s.title || s.display_name || s.id,
          source: s.source || '?',
          count: s.message_count || 0,
          lastTs: Math.round((s.last_activity_at || 0) * 1000),
          messages: bySid[s.id] || [],
        }));
      }
    } else if (sess) {
      conversations = [];
    }
  }
  if (conversations === null) conversations = hermesFromLog();

  const data = { conversations };
  hermesCache = { at: Date.now(), data };
  return data;
}

/* ---------------- AGY-PROXY: điều khiển CLI qua child_process ----------------
 * Dashboard KHÔNG implement logic proxy — chỉ spawn npm trong folder agy-proxy,
 * capture stdout/stderr vào ring buffer để client poll hiển thị realtime. */

const AGY_DIR = process.env.AGY_DIR || path.join(os.homedir(), 'Desktop', 'project', 'agy-proxy');
const AGY_ENV = path.join(AGY_DIR, '.env');

// data dir theo đúng logic paths.ts của agy-proxy: <ROOT>/data nếu tồn tại, không thì ~/.agyproxy
function agyDataDir() {
  const local = path.join(AGY_DIR, 'data');
  return fs.existsSync(local) ? local : path.join(os.homedir(), '.agyproxy', 'data');
}

// CHỈ các key KHÔNG nhạy cảm mới được đọc/ghi từ dashboard (không bao giờ trả
// DASHBOARD_PASSWORD / GATEWAY_API_KEY / OMNIROUTE_PASSWORD... về client).
const AGY_EDIT_KEYS = {
  PORT: { desc: 'Cổng gateway — đổi xong phải Restart', check: v => /^\d+$/.test(v) && +v >= 1 && +v <= 65535 },
  HOST: { desc: '127.0.0.1 (chỉ máy này) | 0.0.0.0 (LAN) — cần Restart', check: v => /^[\w.:-]+$/.test(v) },
  GATEWAY_ROTATION: {
    desc: 'Chiến lược xoay account: round-robin | full-first | failover | highest-first | smart',
    check: v => ['round-robin', 'full-first', 'failover', 'highest-first', 'smart'].includes(v),
  },
  GATEWAY_COOLDOWN_SEC: { desc: 'Cooldown (giây) khi account dính 429/hết quota', check: v => /^\d+$/.test(v) && +v >= 1 && +v <= 86400 },
  HEADLESS: { desc: 'true/false — browser ẩn hay hiện khi login Google', check: v => v === 'true' || v === 'false' },
  TOKEN_HEALTH_HOURS: { desc: 'Chu kỳ tự kiểm token health (giờ, 0 = tắt)', check: v => /^\d+$/.test(v) && +v <= 720 },
};

function readAgyEnv() {
  const out = {};
  let raw;
  try { raw = fs.readFileSync(AGY_ENV, 'utf8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// Ghi 1 key vào .env: thay đúng dòng KEY=..., giữ nguyên comment và các dòng khác
function writeAgyEnv(key, value) {
  let raw = fs.readFileSync(AGY_ENV, 'utf8');
  const re = new RegExp('^' + key + '=.*$', 'm');
  raw = re.test(raw)
    ? raw.replace(re, () => key + '=' + value)
    : raw + (raw.endsWith('\n') ? '' : '\n') + key + '=' + value + '\n';
  fs.writeFileSync(AGY_ENV, raw);
}

// Port thực tế: settings DB của agy-proxy (đổi từ UI riêng, đè env) -> .env PORT -> 7788
/* ---------------- cầu nối API agy-proxy ----------------
   Dashboard vốn đọc THẲNG file SQLite của agy-proxy. Cách đó lấy được dữ liệu lịch
   sử nhưng thiếu hẳn nhóm chỉ API mới có: rps, tỉ lệ lỗi, độ trễ p50/p95/p99, phân
   rã theo API key, và mọi lệnh điều khiển.

   Xác thực: CLI token qua HTTP Basic với username RỖNG — `Basic base64(':' + token)`.
   Dấu ':' phía trước là chỗ dễ sai nhất; đã thử: thiếu nó là 401 không kèm giải
   thích gì. Token nằm ở SQLite settings.cliToken (32 ký tự). */
/* Cache token. Dùng CHUNG một promise cho các lệnh gọi song song: bản đầu đánh dấu
   `at = Date.now()` NGAY TRƯỚC khi await đọc sqlite, nên hai lệnh chạy cùng lúc thấy
   cache "còn mới" rồi nhận `val` vẫn rỗng. Đo được: 3 lệnh song song -> 2 lệnh lấy
   token rỗng. Đây chính là lý do stats/quota trống ở lần mở tab đầu tiên. */
let agyTokenCache = { at: 0, val: '' };
let agyTokenDang = null;
async function agyToken() {
  if (process.env.AGY_TOKEN) return process.env.AGY_TOKEN;
  if (agyTokenCache.at && Date.now() - agyTokenCache.at < 60000) return agyTokenCache.val;
  if (agyTokenDang) return agyTokenDang;          // đang đọc dở -> chờ chung
  agyTokenDang = _docToken().finally(() => { agyTokenDang = null; });
  return agyTokenDang;
}
async function _docToken() {
  const db = path.join(agyDataDir(), 'state.db');
  if (!fs.existsSync(db)) { agyTokenCache = { at: Date.now(), val: '' }; return ''; }
  const rows = await new Promise(resolve => {
    execFile('sqlite3', ['-readonly', '-json', db, "SELECT value FROM settings WHERE key='cliToken';"],
      { timeout: 4000 }, (err, out) => {
        if (err) return resolve(null);
        try { resolve(JSON.parse(out || '[]')); } catch { resolve(null); }
      });
  });
  const val = (rows && rows[0] && rows[0].value) ? String(rows[0].value) : '';
  agyTokenCache = { at: Date.now(), val };   // đánh dấu SAU khi đã có giá trị thật
  return val;
}

/* Gọi API agy. Trả { ok, status, data } — KHÔNG ném lỗi, vì agy tắt là chuyện
   thường và tab phải rơi về dữ liệu SQLite chứ không được vỡ. */
async function agyApi(apiPath, opts = {}) {
  const token = await agyToken();
  if (!token) return { ok: false, status: 0, error: 'chưa có CLI token của agy-proxy' };
  const port = await agyPort();
  const auth = 'Basic ' + Buffer.from(':' + token).toString('base64');
  const url = 'http://127.0.0.1:' + port + apiPath;
  try {
    const r = await fetch(url, {
      method: opts.method || 'GET',
      headers: Object.assign({ authorization: auth },
        opts.body ? { 'content-type': 'application/json' } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeout || 15000),
    });
    // 404 = server agy đang chạy bản CŨ hơn mã nguồn (đã gặp với /api/metrics/history).
    // Không phải lỗi -> báo riêng để client ẩn mục đó thay vì hiện báo lỗi đỏ.
    if (r.status === 404) return { ok: false, status: 404, error: 'agy-proxy chưa hỗ trợ mục này' };
    if (r.status === 401) return { ok: false, status: 401, error: 'CLI token không đúng' };
    if (!r.ok) return { ok: false, status: r.status, error: 'agy trả lỗi ' + r.status };
    return { ok: true, status: 200, data: await r.json() };
  } catch (e) {
    // e có thể không phải Error (AbortSignal ném DOMException, hoặc reject giá trị trần)
    const msg = String((e && e.message) || e || '');
    return { ok: false, status: 0, error: /timeout|abort/i.test(msg) ? 'agy không phản hồi' : 'không kết nối được agy' };
  }
}

async function agyPort() {
  const db = path.join(agyDataDir(), 'state.db');
  if (fs.existsSync(db)) {
    const rows = await new Promise(resolve => {
      execFile('sqlite3', ['-readonly', '-json', db, "SELECT value FROM settings WHERE key='port';"],
        { timeout: 4000 }, (err, out) => {
          if (err) return resolve(null);
          try { resolve(JSON.parse(out || '[]')); } catch { resolve(null); }
        });
    });
    if (rows && rows[0] && /^\d+$/.test(String(rows[0].value))) return +rows[0].value;
  }
  const env = readAgyEnv();
  return /^\d+$/.test(env.PORT || '') ? +env.PORT : 7788;
}

// ---- log ring buffer (dev + build/test/typecheck gộp chung 1 panel) ----
const agyLogBuf = [];
let agyLogStart = 0; // absolute index của agyLogBuf[0] — client poll bằng ?since=<abs index>
function agyLogPush(tag, chunk) {
  const lines = String(chunk).split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const l of lines) agyLogBuf.push('[' + tag + '] ' + l);
  const over = agyLogBuf.length - 800;
  if (over > 0) { agyLogBuf.splice(0, over); agyLogStart += over; }
}

let agyDev = null;  // { proc, startedAt } — npm run dev do dashboard spawn
let agyTask = null; // { name, proc, startedAt } — build/test/typecheck đang chạy (1 lúc 1 cái)
const agyLast = {}; // name -> { ok, code, at, ms } kết quả lần chạy cuối
let agyStatusCache = { at: 0, data: null };
let dockerCache = { at: 0, data: null };   // docker ps chậm ~200ms, client poll 3s // cache 3s — client poll 3s, probe HTTP không dồn dập
// Tên container Postgres — tìm bằng `docker ps` nên nhớ tạm 10s, khỏi gọi mỗi nhịp
let pgCache = { at: 0, ten: '' };

function agyPipe(proc, tag) {
  proc.stdout.on('data', d => agyLogPush(tag, d));
  proc.stderr.on('data', d => agyLogPush(tag, d));
}

function agyStartDev() {
  if (agyDev) return { error: 'dev server đã chạy (pid ' + agyDev.proc.pid + ')' };
  const proc = spawn('npm', ['run', 'dev'], { cwd: AGY_DIR, detached: true, env: process.env });
  const rec = { proc, startedAt: Date.now() };
  agyDev = rec;
  agyLogPush('dev', '$ npm run dev (pid ' + proc.pid + ')');
  agyPipe(proc, 'dev');
  // chỉ null-out khi agyDev vẫn là record này — exit muộn của proc cũ (sau Stop→Start
  // nhanh / Restart) không được xóa record của proc MỚI
  proc.on('error', e => { agyLogPush('dev', '[spawn error] ' + e.message); if (agyDev === rec) agyDev = null; });
  proc.on('exit', code => { agyLogPush('dev', '[exit code=' + code + ']'); if (agyDev === rec) agyDev = null; agyStatusCache.at = 0; });
  agyStatusCache.at = 0;
  return { ok: true, pid: proc.pid };
}

function agyStopDev() {
  if (!agyDev) return { error: 'dev server không do dashboard start — nếu agy-proxy chạy ngoài, dừng thủ công' };
  const p = agyDev.proc;
  // detached:true -> kill cả process group (tsx watch spawn con)
  try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill('SIGTERM'); } catch {} }
  agyLogPush('dev', '[stop] SIGTERM pid ' + p.pid);
  agyDev = null;
  agyStatusCache.at = 0;
  return { ok: true };
}

const AGY_TASKS = {
  build: { args: ['run', 'build'], cwd: 'web' },      // cd web && npm run build
  test: { args: ['test'], cwd: '' },                  // npm test
  typecheck: { args: ['run', 'typecheck'], cwd: '' }, // tsc --noEmit
};

function agyRun(name) {
  const t = AGY_TASKS[name];
  if (!t) return { error: 'cmd không hợp lệ (build | test | typecheck)' };
  if (agyTask) return { error: 'đang chạy ' + agyTask.name + ' — đợi xong đã' };
  const started = Date.now();
  let proc;
  try {
    proc = spawn('npm', t.args, { cwd: path.join(AGY_DIR, t.cwd), env: process.env });
  } catch (e) { return { error: e.message }; }
  const rec = { name, proc, startedAt: started };
  agyTask = rec;
  agyLogPush(name, '$ npm ' + t.args.join(' ') + (t.cwd ? ' (trong ' + t.cwd + '/)' : ''));
  agyPipe(proc, name);
  const killer = setTimeout(() => { try { proc.kill('SIGTERM'); } catch {} agyLogPush(name, '[timeout 10m]'); }, 600000);
  // spawn fail phát CẢ 'error' lẫn 'close' -> settle đúng 1 lần, không ghi đè kết quả
  // và không null-out agyTask của lần chạy sau
  let settled = false;
  const settle = (ok, code, log) => {
    if (settled) return;
    settled = true;
    clearTimeout(killer);
    agyLogPush(name, log);
    agyLast[name] = { ok, code, at: Date.now(), ms: Date.now() - started };
    if (agyTask === rec) agyTask = null;
    agyStatusCache.at = 0;
  };
  proc.on('error', e => settle(false, -1, '[spawn error] ' + e.message));
  proc.on('close', code => settle(code === 0, code,
    '[done code=' + code + ' trong ' + Math.round((Date.now() - started) / 1000) + 's]'));
  return { ok: true };
}

// GET JSON ngắn gọn có timeout — probe status + lấy models từ gateway
function httpGetJson(urlStr, headers, timeoutMs) {
  return new Promise(resolve => {
    const req = http.get(urlStr, { headers, timeout: timeoutMs }, r => {
      let buf = '';
      r.on('data', c => { buf += c; if (buf.length > 1e6) req.destroy(); });
      r.on('end', () => {
        try { resolve({ code: r.statusCode, json: JSON.parse(buf) }); }
        catch { resolve({ code: r.statusCode, json: null }); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/* ---- sức khoẻ tài khoản: đọc accounts.csv (1.9MB) -> cache theo mtime,
   client poll 3s nên KHÔNG được parse lại mỗi lần ---- */
let agyAccCache = { mtimeMs: 0, size: 0, data: null };
function readAgyAccounts() {
  const f = path.join(agyDataDir(), 'accounts.csv');
  let st;
  try { st = fs.statSync(f); } catch { return { total: 0, status: {}, kiro: {}, recent24h: 0 }; }
  if (agyAccCache.data && agyAccCache.mtimeMs === st.mtimeMs && agyAccCache.size === st.size) return agyAccCache.data;
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch { return { total: 0, status: {}, kiro: {}, recent24h: 0 }; }
  const lines = raw.split('\n').filter(l => l.trim());
  const hdr = (lines[0] || '').split(',');
  const iAgy = hdr.indexOf('status_agy');
  const iKiro = hdr.indexOf('status_kiro');
  const iLast = hdr.indexOf('last_run');
  const status = {}, kiro = {};
  let recent24h = 0;
  const now = Date.now();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (iAgy >= 0) { const v = c[iAgy] || 'unknown'; status[v] = (status[v] || 0) + 1; }
    if (iKiro >= 0) { const v = c[iKiro] || 'unknown'; kiro[v] = (kiro[v] || 0) + 1; }
    if (iLast >= 0) { const t = Date.parse(c[iLast]); if (t && now - t < 86400000) recent24h++; }
  }
  const data = { total: lines.length - 1, status, kiro, recent24h };
  agyAccCache = { mtimeMs: st.mtimeMs, size: st.size, data };
  return data;
}

// Gom model theo nhà cung cấp: "agy/gemini-3-pro-high" -> nhóm "gemini"
function groupModels(models) {
  const g = {};
  for (const m of models) {
    const body = String(m).indexOf('/') >= 0 ? String(m).split('/').slice(1).join('/') : String(m);
    const key = (body.split('-')[0] || 'khác').toLowerCase();
    (g[key] = g[key] || []).push(m);
  }
  // nhóm chỉ có 1 model -> dồn vào "khác", tránh 20 nhóm vụn mỗi nhóm 1 dòng
  const keys = Object.keys(g).sort((a, b) => g[b].length - g[a].length);
  const out = [], rest = [];
  for (const k of keys) { if (g[k].length > 1) out.push({ name: k, items: g[k] }); else rest.push(g[k][0]); }
  if (rest.length) out.push({ name: 'khác', items: rest });
  return out;
}

/* ---- lưu lượng thật: bảng gateway_usage trong state.db của agy-proxy ----
   Mỗi request 1 dòng (ts, model, token, ok, ms, status) -> thống kê được tỉ lệ lỗi,
   model dùng nhiều, biểu đồ theo giờ. Dùng sqlite3 CLI readonly như phần Hermes
   (dự án zero-dependency, không thêm module). */
let agyUsageCache = { at: 0, data: null };

function agySqlite(sql) {
  const db = path.join(agyDataDir(), 'state.db');
  return new Promise(resolve => {
    execFile('sqlite3', ['-readonly', '-json', db, sql],
      { maxBuffer: 8 * 1024 * 1024, timeout: 5000 },
      (err, out) => {
        if (err) return resolve(null);
        try { resolve(JSON.parse(out || '[]')); } catch { resolve(null); }
      });
  });
}

async function getAgyUsage() {
  // cache 15s: số liệu 24h không đổi theo từng giây, client poll 3s
  if (agyUsageCache.data && Date.now() - agyUsageCache.at < 15000) return agyUsageCache.data;
  const DAY = "ts > (strftime('%s','now')*1000 - 86400000)";
  const [sum, models, codes, hours] = await Promise.all([
    agySqlite('SELECT COUNT(*) reqs, SUM(ok=0) errs, SUM(prompt_tokens+completion_tokens) tokens,'
      + ' CAST(AVG(ms) AS INT) avgMs FROM gateway_usage WHERE ' + DAY + ';'),
    agySqlite('SELECT model, COUNT(*) n, SUM(ok=0) e FROM gateway_usage WHERE ' + DAY
      + ' GROUP BY model ORDER BY n DESC LIMIT 5;'),
    agySqlite('SELECT status, COUNT(*) n FROM gateway_usage WHERE ok=0 AND ' + DAY
      + ' GROUP BY status ORDER BY n DESC LIMIT 5;'),
    // 12 giờ gần nhất cho biểu đồ cột mini
    agySqlite("SELECT strftime('%H',ts/1000,'unixepoch','localtime') h, COUNT(*) n, SUM(ok=0) e"
      + ' FROM gateway_usage WHERE ts > (strftime(\'%s\',\'now\')*1000 - 43200000) GROUP BY h ORDER BY h;'),
  ]);
  const s = (sum && sum[0]) || {};
  const data = sum ? {
    ok: true,
    reqs: s.reqs || 0,
    errs: s.errs || 0,
    tokens: s.tokens || 0,
    avgMs: s.avgMs || 0,
    models: models || [],
    codes: codes || [],
    hours: hours || [],
  } : { ok: false }; // không đọc được DB (thiếu sqlite3 CLI / file khoá) -> client ẩn khối này
  agyUsageCache = { at: Date.now(), data };
  return data;
}

async function getAgyStatus() {
  if (agyStatusCache.data && Date.now() - agyStatusCache.at < 3000) return agyStatusCache.data;
  const port = await agyPort();
  const env = readAgyEnv();
  const headers = env.GATEWAY_API_KEY ? { Authorization: 'Bearer ' + env.GATEWAY_API_KEY } : {};
  const r = await httpGetJson('http://127.0.0.1:' + port + '/proxy/v1/models', headers, 1500);
  const running = !!r; // có phản hồi HTTP (kể cả 401) = process đang listen
  const models = (r && r.json && Array.isArray(r.json.data)) ? r.json.data.map(x => x.id) : [];
  let accounts = 0;
  try {
    const csv = fs.readFileSync(path.join(agyDataDir(), 'accounts.csv'), 'utf8');
    accounts = Math.max(0, csv.split('\n').filter(l => l.trim()).length - 1); // trừ header
  } catch {}
  const acc = readAgyAccounts();
  const usage = await getAgyUsage();
  const data = {
    running, port, accounts, models, usage,
    modelGroups: groupModels(models),
    acc,                       // sức khoẻ tài khoản: ok/new/failed/needs_human + chạy 24h
    external: running && !agyDev, // proxy đang chạy NGOÀI dashboard -> Stop/Restart không tác dụng
    dev: agyDev ? { pid: agyDev.proc.pid, startedAt: agyDev.startedAt } : null,
    task: agyTask ? { name: agyTask.name, startedAt: agyTask.startedAt } : null,
    last: agyLast,
  };
  agyStatusCache = { at: Date.now(), data };
  return data;
}

/* ---------------- http helpers ---------------- */

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req, maxBytes) {
  const cap = maxBytes || 1e6;
  return new Promise((resolve, reject) => {
    // Bắt buộc Content-Type JSON: fetch cross-origin với JSON header phải qua CORS preflight
    // (server này không trả CORS header) -> chặn CSRF kiểu gửi text/plain từ trang web lạ.
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      return reject(new Error('content-type must be application/json'));
    }
    let buf = '';
    let overflow = false;
    req.on('data', c => {
      buf += c;
      if (buf.length > cap) { overflow = true; reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (overflow) return;
      try { resolve(buf ? JSON.parse(buf) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// Chặn DNS rebinding: chỉ nhận request có Host là localhost / IP LAN riêng / *.local.
// Attacker rebind domain -> IP nội bộ sẽ gửi Host: evil.com và bị chặn ở đây.
function hostAllowed(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
    || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)
    // Tailscale: CGNAT 100.64.0.0/10 + IPv6 fd7a::/16 + MagicDNS *.ts.net
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)
    || /^fd7a:/i.test(host)
    || host.endsWith('.ts.net')
    || host.endsWith('.local');
}

/* ---------------- Web Push: VAPID + RFC 8291 aes128gcm (zero deps) ---------------- */
// Push THẬT qua push service của browser (FCM/APNs/Mozilla) — notification hiện trên
// điện thoại kể cả khi đã đóng tab. Yêu cầu phía client: secure context (https/localhost).

// Neo vào GỐC DỰ ÁN, không phải __dirname: khi tách file vào src/server/ thì __dirname
// đổi -> sinh khoá VAPID mới -> mọi đăng ký thông báo trên máy người dùng chết im lặng.
const ROOT_DIR = path.join(__dirname, '..', '..');
const PUSH_STATE_FILE = process.env.PUSH_STATE_FILE || path.join(ROOT_DIR, '.push-state.json');
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:claude@onluyen.edu.vn';
const b64u = buf => Buffer.from(buf).toString('base64url');

// Keypair ưu tiên env VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (base64url); không có thì
// generate 1 lần rồi persist — đổi key là MỌI subscription cũ chết nên phải giữ ổn định
// qua restart. Subscriptions cũng persist cùng file (gitignored).
let pushState = { publicKey: '', privateKey: '', subs: [] };
try { pushState = { ...pushState, ...JSON.parse(fs.readFileSync(PUSH_STATE_FILE, 'utf8')) }; } catch {}
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  pushState.publicKey = process.env.VAPID_PUBLIC_KEY;
  pushState.privateKey = process.env.VAPID_PRIVATE_KEY;
} else if (!pushState.publicKey || !pushState.privateKey) {
  const jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    .privateKey.export({ format: 'jwk' });
  // public = điểm uncompressed 65B (0x04 || X || Y), private = scalar D 32B
  pushState.publicKey = b64u(Buffer.concat([
    Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url'),
  ]));
  pushState.privateKey = jwk.d;
  savePushState();
}

function savePushState() {
  try { ghiJson(PUSH_STATE_FILE, pushState); } catch {}
}

function removeSub(endpoint) {
  const n = pushState.subs.length;
  pushState.subs = pushState.subs.filter(s => s.endpoint !== endpoint);
  if (pushState.subs.length !== n) savePushState();
}

// Authorization header VAPID (RFC 8292): JWT ES256 ký bằng private key, aud = origin push service
function vapidAuth(endpoint) {
  const pub = Buffer.from(pushState.publicKey, 'base64url');
  const key = crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: pushState.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
  });
  const seg = o => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = seg({ typ: 'JWT', alg: 'ES256' }) + '.'
    + seg({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT });
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + unsigned + '.' + b64u(sig) + ', k=' + pushState.publicKey;
}

// Mã hoá payload theo RFC 8291 (ECDH P-256 + HKDF + AES-128-GCM, content coding aes128gcm)
function encryptPush(sub, payload) {
  const uaPub = Buffer.from(sub.keys.p256dh, 'base64url'); // public key browser (65B)
  const authSecret = Buffer.from(sub.keys.auth, 'base64url'); // auth secret 16B
  const ecdh = crypto.createECDH('prime256v1');
  const asPub = ecdh.generateKeys(); // ephemeral keypair phía server
  const shared = ecdh.computeSecret(uaPub);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // record cuối: plaintext + delimiter 0x02, không pad thêm
  const cipher = Buffer.concat([c.update(Buffer.concat([payload, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  // header aes128gcm: salt(16) + rs(4, 4096) + idlen(1) + keyid(as_public 65B)
  return Buffer.concat([salt, Buffer.from([0, 0, 16, 0, 65]), asPub, cipher]);
}

function sendPush(sub, dataObj) {
  return new Promise(resolve => {
    let u;
    try { u = new URL(sub.endpoint); } catch { return resolve({ status: 0, error: 'bad endpoint' }); }
    // push service thật luôn https; http chỉ cho loopback (test local)
    const mod = u.protocol === 'https:' ? https
      : (u.hostname === '127.0.0.1' || u.hostname === 'localhost') ? http : null;
    if (!mod) return resolve({ status: 0, error: 'endpoint phải là https' });
    let body;
    try { body = encryptPush(sub, Buffer.from(JSON.stringify(dataObj))); } catch (e) { return resolve({ status: 0, error: e.message }); }
    const req2 = mod.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length': body.length,
        TTL: '3600',
        Urgency: 'high',
        Authorization: vapidAuth(sub.endpoint),
      },
      timeout: 10000,
    }, r => {
      r.resume();
      // 404/410 = subscription đã chết (user gỡ app / revoke quyền) -> tự dọn
      if (r.statusCode === 404 || r.statusCode === 410) removeSub(sub.endpoint);
      resolve({ status: r.statusCode });
    });
    req2.on('timeout', () => req2.destroy(new Error('timeout')));
    req2.on('error', e => resolve({ status: 0, error: e.message }));
    req2.end(body);
  });
}

async function pushAll(dataObj) {
  const subs = pushState.subs.slice();
  const results = await Promise.all(subs.map(s => sendPush(s, dataObj)));
  return {
    total: subs.length,
    sent: results.filter(r => r.status >= 200 && r.status < 300).length,
    results: results.map((r, i) => ({ endpoint: subs[i].endpoint.slice(0, 60), ...r })),
  };
}

// Bắn push khi Claude/Hermes trả lời xong. SW phía client quyết định hiển thị:
// có tab visible thì bỏ qua (toast/beep local đã lo), tab ẩn/đóng mới hiện notification.
function notifyPush(msg, sid) {
  if (!pushState.subs.length) return;
  pushAll({ title: 'Claude Control Center', body: msg, tag: 'ccc-done', sid: sid || null, url: '/' }).catch(() => {});
}

/* ---------------- ảnh gửi từ điện thoại ----------------
   Lưu ra đĩa rồi đưa Claude đường dẫn (CLI đọc ảnh qua tool Read). Tự dọn ảnh cũ
   để thư mục không phình vô hạn. */
const UPLOAD_DIR = path.join(os.homedir(), '.claude', 'dashboard-uploads');
const UPLOAD_KEEP_MS = 7 * 24 * 3600 * 1000; // giữ 7 ngày
const UPLOAD_KEEP_N = 200;                    // hoặc tối đa 200 ảnh gần nhất
function pruneUploads() {
  let files;
  try {
    files = fs.readdirSync(UPLOAD_DIR)
      .map(f => { const p2 = path.join(UPLOAD_DIR, f); try { return { p: p2, t: fs.statSync(p2).mtimeMs }; } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => b.t - a.t);
  } catch { return; }
  const now = Date.now();
  files.forEach((f, i) => {
    if (i >= UPLOAD_KEEP_N || now - f.t > UPLOAD_KEEP_MS) { try { fs.unlinkSync(f.p); } catch {} }
  });
}

/* ---------------- token truy cập ----------------
   hostAllowed() KHÔNG phải cơ chế bảo mật: nó đọc header Host do client tự khai,
   `curl -H "Host: fake.ts.net"` là vượt qua. Mà /api/task giao việc cho Claude ở chế độ
   acceptEdits = chạy lệnh tuỳ ý trên máy. Nên mọi endpoint GHI dữ liệu phải có token. */
const TOKEN_FILE = path.join(os.homedir(), '.claude', 'dashboard-token.json');
let dashToken = process.env.DASH_TOKEN || '';
if (!dashToken) {
  try { dashToken = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token || ''; } catch {}
}
if (!dashToken) {
  dashToken = crypto.randomBytes(18).toString('base64url');
  /* Ghi hỏng ở đây là mã truy cập ĐỔI mỗi lần khởi động lại -> link ?t= đã lưu trên
     điện thoại chết theo, phải mở terminal đọc log mới vào được. Báo ra màn hình chứ
     đừng nuốt: chỉ có dòng này mới cho biết vì sao mã cứ đổi. */
  try { ghiJson(TOKEN_FILE, { token: dashToken }, 0o600); }
  catch (e) { console.error('  ! không lưu được mã truy cập (' + e.code + ') — mã sẽ đổi sau mỗi lần khởi động lại:', TOKEN_FILE); }
}

// Request từ chính máy này (loopback) khỏi cần token — curl/script local vẫn tiện dùng
function isLoopback(req) {
  const a = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function tokenOk(req, url) {
  const h = req.headers['x-dash-token'];
  if (h && String(h) === dashToken) return true;
  const q = url.searchParams.get('t');
  return !!(q && q === dashToken);
}

/* ---------------- mã khoá (passcode) ----------------
   Token ở trên chặn NGƯỜI TỪ MẠNG (LAN/Tailscale). Nhưng loopback được miễn hoàn
   toàn, nghĩa là ai cầm chính chiếc máy này mở Chrome vào localhost:7799 là vào
   thẳng — không rào nào. Passcode bịt đúng chỗ đó: bật rồi thì loopback cũng phải
   nhập mã.

   Ba điều bắt buộc, thiếu cái nào là passcode thành vô nghĩa:
   1. scrypt chứ không phải SHA-256 trần — PIN 4 số chỉ có 10.000 khả năng, hash
      nhanh thì dò xong trong tích tắc.
   2. timingSafeEqual — so sánh không lộ thời gian.
   3. Đếm số lần sai + chờ tăng dần — không có thì cứ thử lần lượt 10.000 mã.

   ĐƯỜNG THOÁT nếu quên mã: xoá ~/.claude/dashboard-passcode.json rồi khởi động lại. */
const PASS_FILE = path.join(os.homedir(), '.claude', 'dashboard-passcode.json');
let passState = null;   // { salt, hash, at } | null = chưa đặt mã
let passAt = 0;         // lần cuối đọc file, để không đọc đĩa mỗi request

/* Đọc lại file mỗi 2 giây thay vì cache vĩnh viễn trong RAM.
   Vì sao: đường thoát khi quên mã là "xoá ~/.claude/dashboard-passcode.json", nhưng
   nếu chỉ đọc một lần lúc khởi động thì xoá xong server VẪN báo còn mã — phải restart
   mới ăn. Mà lúc đang bị khoá ngoài ý muốn thì restart là việc không phải ai cũng
   làm được (ví dụ đang ở xa, chỉ có điện thoại). */
function docPass() {
  const now = Date.now();
  if (now - passAt < 2000) return passState;
  passAt = now;
  try { passState = JSON.parse(fs.readFileSync(PASS_FILE, 'utf8')); }
  catch { passState = null; }
  return passState;
}
docPass();

function savePass(st) {
  passState = st;
  passAt = Date.now();   // vừa ghi -> đừng đọc đè trong 2s tới
  try {
    if (st) ghiJson(PASS_FILE, st, 0o600);
    else fs.rmSync(PASS_FILE, { force: true });
    return true;
  } catch { return false; }
}
function hashPass(code, saltHex) {
  return crypto.scryptSync(String(code), Buffer.from(saltHex, 'hex'), 32).toString('hex');
}
function passMatch(code) {
  if (!docPass()) return false;
  const got = Buffer.from(hashPass(code, passState.salt), 'hex');
  const want = Buffer.from(passState.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/* ---- phiên đã mở khoá ----
   Cookie TỰ CHỨNG MINH: "<hạn dùng>.<chữ ký HMAC>" — server chỉ cần kiểm chữ ký,
   không phải nhớ gì.

   Trước đây giữ danh sách token trong một Map ở RAM, nên MỖI LẦN restart server là
   mọi thiết bị bị đá ra: cookie cũ không còn trong Map -> /stream trả 423 -> iPhone
   hiện "mất kết nối" và danh sách phiên TRỐNG TRƠN. Gặp thật đúng lúc triển khai bản
   mới, và sẽ gặp lại sau mỗi lần cập nhật hoặc máy khởi động lại.

   Bí mật ký nằm chung file mã khoá (đã 0600). Đổi/gỡ mã khoá thì sinh bí mật mới,
   nên mọi phiên cũ mất hiệu lực ngay — đúng thứ cần khi đổi mã. */
const UNLOCK_TTL = 12 * 3600e3;

function biMatKy() {
  const st = docPass();
  if (!st) return '';
  if (!st.sess) {
    // File mã khoá tạo từ bản cũ chưa có trường này -> bổ sung, giữ nguyên mã đã đặt
    st.sess = crypto.randomBytes(32).toString('hex');
    savePass(st);
  }
  return st.sess;
}

function kyUnlock(hetHan, khoa) {
  return crypto.createHmac('sha256', khoa).update(String(hetHan)).digest('base64url');
}

function unlockOk(req) {
  if (!docPass()) return true;                 // chưa đặt mã thì không khoá gì
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)dashUnlock=([\w.-]+)/);
  if (!m) return false;
  const [hetHan, chuKy] = String(m[1]).split('.');
  if (!hetHan || !chuKy) return false;
  if (!(+hetHan > Date.now())) return false;   // hết hạn (NaN cũng rơi vào đây)
  const mong = kyUnlock(hetHan, biMatKy());
  const a = Buffer.from(chuKy), b = Buffer.from(mong);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function newUnlock() {
  const hetHan = Date.now() + UNLOCK_TTL;
  return hetHan + '.' + kyUnlock(hetHan, biMatKy());
}
// Đếm nhập sai theo IP; sai càng nhiều chờ càng lâu (2^n giây, tối đa 5 phút)
const passFail = new Map();
function failWait(ip) {
  const f = passFail.get(ip);
  if (!f || f.n < 5) return 0;
  const wait = Math.min(300e3, 1000 * Math.pow(2, f.n - 4));
  const left = f.at + wait - Date.now();
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/* ---------------- phục vụ giao diện tĩnh ----------------
   Hai giao diện song song trong lúc di trú:
     web-next/out  — bản mới (Next.js + shadcn, kiểu Atlas)
     web/legacy    — bản cũ, giữ nguyên làm đường lui
   NEW_UI=0 để quay về bản cũ tức thì nếu bản mới có vấn đề. */
const LEGACY_DIR = path.join(__dirname, '..', '..', 'web', 'legacy');
const NEXT_DIR = path.join(__dirname, '..', '..', 'web-next', 'out');
// icon nguồn: web-next/public (được Next copy sang out khi build, nhưng đọc thẳng
// public thì dùng được cả khi chưa build)
const NEXT_PUBLIC = path.join(__dirname, '..', '..', 'web-next', 'public');
const USE_NEW_UI = process.env.NEW_UI !== '0' && fs.existsSync(path.join(NEXT_DIR, 'index.html'));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
               '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
               '.json': 'application/json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
               '.woff2': 'font/woff2', '.png': 'image/png' };
function sendFile(res, f, cache) {
  let buf;
  try { buf = fs.readFileSync(f); } catch { return json(res, 404, { error: 'not found' }); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
                       'Cache-Control': cache || 'no-cache' });
  return res.end(buf);
}
function serveWeb(res, name) {
  return sendFile(res, path.join(LEGACY_DIR, name)); // no-cache: sửa file là thấy ngay
}
// Tài nguyên Next: /_next/... đặt tên theo hash nội dung nên cache vĩnh viễn được.
// Chặn ../ bằng cách kiểm tra đường dẫn thật vẫn nằm trong NEXT_DIR.
function serveNext(res, urlPath) {
  const f = path.join(NEXT_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!path.resolve(f).startsWith(path.resolve(NEXT_DIR))) return json(res, 404, { error: 'not found' });
  const immutable = urlPath.startsWith('/_next/static/');
  return sendFile(res, f, immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  if (!hostAllowed(req)) return json(res, 403, { error: 'forbidden host' });
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // Vỏ app + PWA cho qua (không có dữ liệu nhạy cảm, cần cho màn nhập token & offline).
  // Mọi thứ còn lại — kể cả GET /api/* vì chúng lộ nội dung hội thoại — đều cần token.
  // Vỏ app gồm cả JS/CSS của giao diện — không có dữ liệu nhạy cảm, mà thiếu chúng thì
  // màn nhập token không hiện được (trang trắng) và offline cũng hỏng.
  const isShell = p === '/' || p === '/index.html' || p === '/manifest.json' || p === '/sw.js'
    || p === '/favicon.ico' || p === '/app.css'
    || /^\/(icon\.svg|icon-\d+\.png|icon-maskable-\d+\.png|apple-touch-icon\.png|favicon-\d+\.png)$/.test(p)
    || p.startsWith('/_next/') || /^\/js\/[a-z-]+\.js$/.test(p);
  if (!isShell && !isLoopback(req) && !tokenOk(req, url)) {
    return json(res, 401, { error: 'cần token truy cập' });
  }

  /* ---- mã khoá: chặn cả loopback ----
     Đặt NGAY SAU chốt token và TRƯỚC mọi handler, để chỉ có một chỗ duy nhất quyết
     định "được vào hay không" — dễ soi lại sau này. */
  if (p.startsWith('/api/passcode/')) {
    const ip = (req.socket && req.socket.remoteAddress) || '?';

    if (p === '/api/passcode/status') {
      return json(res, 200, { daDat: !!docPass(), daMo: unlockOk(req), choGiay: failWait(ip) });
    }

    // Đặt / đổi / gỡ mã. Đã có mã thì phải nhập mã cũ mới đổi được.
    if (p === '/api/passcode/set' && req.method === 'POST') {
      let body; try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
      const code = String(body.code == null ? '' : body.code);
      if (docPass() && !passMatch(String(body.old || '')) && !unlockOk(req)) {
        return json(res, 403, { error: 'cần mã hiện tại để đổi' });
      }
      if (!code) {                      // gỡ mã
        if (!savePass(null)) return json(res, 500, { error: 'không ghi được file' });
        return json(res, 200, { ok: true, daDat: false });
      }
      if (!/^\d{4,12}$/.test(code)) return json(res, 400, { error: 'mã phải là 4–12 chữ số' });
      const salt = crypto.randomBytes(16).toString('hex');
      /* sess = bí mật ký cookie mở khoá. Sinh MỚI mỗi lần đổi mã -> mọi phiên đang
         mở trên thiết bị khác mất hiệu lực ngay. Đây là hành vi đúng: đổi mã khoá
         thì thiết bị cũ phải nhập lại. */
      const sess = crypto.randomBytes(32).toString('hex');
      if (!savePass({ salt, hash: hashPass(code, salt), sess, at: Date.now() })) {
        return json(res, 500, { error: 'không ghi được file' });
      }
      const t = newUnlock();            // đặt xong thì mở khoá luôn, khỏi nhập lại ngay
      res.setHeader('Set-Cookie', `dashUnlock=${t}; Path=/; Max-Age=${UNLOCK_TTL / 1000}; SameSite=Strict`);
      return json(res, 200, { ok: true, daDat: true });
    }

    if (p === '/api/passcode/verify' && req.method === 'POST') {
      const wait = failWait(ip);
      if (wait) return json(res, 429, { error: `sai nhiều lần, chờ ${wait} giây` , choGiay: wait });
      let body; try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
      if (!passMatch(String(body.code || ''))) {
        const f = passFail.get(ip) || { n: 0, at: 0 };
        f.n++; f.at = Date.now(); passFail.set(ip, f);
        return json(res, 401, { error: 'mã không đúng', choGiay: failWait(ip) });
      }
      passFail.delete(ip);
      const t = newUnlock();
      res.setHeader('Set-Cookie', `dashUnlock=${t}; Path=/; Max-Age=${UNLOCK_TTL / 1000}; SameSite=Strict`);
      return json(res, 200, { ok: true });
    }

    if (p === '/api/passcode/lock' && req.method === 'POST') {
      /* Cookie giờ TỰ CHỨNG MINH bằng chữ ký nên server không giữ danh sách để mà
         xoá — khoá lại = xoá cookie ở trình duyệt. Muốn đá TẤT CẢ thiết bị thì đổi
         mã khoá (sinh bí mật ký mới), đó mới là thao tác đúng cho việc đó. */
      res.setHeader('Set-Cookie', 'dashUnlock=; Path=/; Max-Age=0; SameSite=Strict');
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  // Vỏ app vẫn cho qua (nếu không thì màn nhập mã cũng không hiện được — trang trắng,
  // đúng bài học từ token gate).
  if (!isShell && !unlockOk(req)) {
    return json(res, 423, { error: 'cần mã khoá' });
  }

  // Giao diện mới (Next.js, kiểu Atlas) — NEW_UI=0 để quay về bản cũ tức thì
  if (USE_NEW_UI && (p === '/' || p === '/index.html')) return serveNext(res, '/');
  if (USE_NEW_UI && p.startsWith('/_next/')) return serveNext(res, p);
  if (USE_NEW_UI && p === '/favicon.ico') return serveNext(res, p);

  // Giao diện cũ: file tĩnh trong web/legacy. Trước đây HTML/CSS/JS nhúng trong template
  // literal -> viết \\n hay dấu backtick là âm thầm làm vỡ cả trang mà node -c không thấy.
  if (p === '/' || p === '/index.html') return serveWeb(res, 'index.html');
  if (p === '/app.css') return serveWeb(res, 'app.css');
  // client JS chia theo tính năng: /js/core.js, /js/chat.js, /js/agy.js…
  // chỉ nhận tên file phẳng [a-z-] để không thể dùng ../ thoát khỏi web/legacy
  const jsFile = p.match(/^\/js\/([a-z-]+\.js)$/);
  if (jsFile) return serveWeb(res, path.join('js', jsFile[1]));

  // ---- PWA: manifest + service worker + icon ----
  if (p === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
    return res.end(MANIFEST);
  }
  if (p === '/sw.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(SW_JS);
  }
  // Icon: file thật sinh bởi scripts/make-icons.js (PNG bắt buộc — iOS bỏ qua SVG khi
  // "Thêm vào Màn hình chính"). Chưa sinh thì rơi về ICON_SVG cũ để không bao giờ 404.
  const iconFile = p.match(/^\/(icon\.svg|icon-192\.png|icon-512\.png|icon-maskable-512\.png|apple-touch-icon\.png|favicon-32\.png)$/);
  if (iconFile) {
    const f = path.join(NEXT_PUBLIC, iconFile[1]);
    if (fs.existsSync(f)) return sendFile(res, f, 'public, max-age=604800');
    if (p === '/icon.svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=86400' });
      return res.end(ICON_SVG);
    }
    return json(res, 404, { error: 'not found' });
  }

  if (p === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // listSessions giờ bất đồng bộ (nhả event loop giữa các phiên nặng). Cần cờ chống
    // chồng nhịp: lần quét lạnh mất ~2s còn nhịp SSE là 2s, không chặn thì hai lượt
    // quét chạy song song, mỗi lượt lại nhả nhịp cho lượt kia — càng chậm thêm.
    let dangGui = false;
    const send = async () => {
      if (dangGui) return;
      dangGui = true;
      try {
        const sessions = await listSessions();
        // payload object: sessions + jobs đang chạy + model hiện tại
        res.write(`data: ${JSON.stringify({ sessions, jobs: listJobs(), model: currentModel, perm: permMode, effort })}\n\n`);
      } catch {}
      finally { dangGui = false; }
    };
    send();
    const iv = setInterval(send, 2000);
    req.on('close', () => clearInterval(iv));
    return;
  }

  if (p === '/api/task' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const task = (body.task || '').trim();
    if (!task) return json(res, 400, { error: 'task required' });
    const sid = crypto.randomUUID();
    const args = ['-p', task, '--session-id', sid].concat(permArgs(), effortArgs());
    if (currentModel) args.push('--model', currentModel); // model đã set qua /model
    spawnClaude(args, sid, { task, project: '(new)' });
    return json(res, 200, { ok: true, sid });
  }

  let m;
  if ((m = p.match(/^\/api\/chat\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const msg = (body.message || '').trim();
    if (!msg) return json(res, 400, { error: 'message required' });
    if (procs.has(sid)) return json(res, 409, { error: 'session is busy' });
    /* stream-json + partial: để chữ hiện DẦN như terminal thay vì bung một cục khi
       xong. Chỉ bật ở đường NHẮN TIN — các đường khác (task mới, lệnh một phát) đọc
       stdout dạng chữ thường, đổi sang JSON là vỡ hết chỗ đọc kết quả. */
    const cargs = ['-p', msg, '--resume', sid,
      '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    ].concat(permArgs(), effortArgs());
    const mdl = modelFor(sid);              // model riêng phiên > model toàn cục
    if (mdl) cargs.push('--model', mdl);
    spawnClaude(cargs, sid, { task: msg, stream: true });
    return json(res, 200, { ok: true, sid });
  }

  if ((m = p.match(/^\/api\/kill\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    const entry = procs.get(sid);
    if (!entry) return json(res, 404, { error: 'not running' });
    // không còn detached -> kill thẳng tiến trình; giữ kill theo nhóm làm dự phòng
    try { entry.proc.kill('SIGTERM'); } catch { try { process.kill(-entry.proc.pid, 'SIGTERM'); } catch {} }
    procs.delete(sid);
    return json(res, 200, { ok: true });
  }

  if ((m = p.match(/^\/api\/history\/([\w-]+)$/))) {
    const sid = m[1];
    const typing = procs.has(sid);
    const file = findSessionFile(sid);
    // user đang xem chat -> đánh dấu đã đọc (chỉ set cho session THẬT, sid rác không phình Map)
    if (file || typing) lastSeen.set(sid, Date.now());
    if (!file) {
      /* Chưa có .jsonl nào cho sid này. Vẫn PHẢI trả lỗi lần chạy gần nhất: đây đúng
         là trường hợp `--resume` trượt (thư mục gốc bị xoá/đổi tên, hoặc sid sai) —
         nhánh cũ trả về rỗng nên banner lỗi không bao giờ hiện, tin nhắn rơi vào hư
         không mà màn hình im như không có chuyện gì. */
      const se0 = spawnErrors.get(sid);
      return json(res, 200, {
        sid, messages: [], total: 0, start: 0, typing, status: statusOf(sid, 0),
        error: se0 && Date.now() - se0.at < 120000 ? se0.msg : null,
      });
    }
    let mt = 0;
    try { mt = fs.statSync(file).mtimeMs; } catch {}
    const messages = getHistory(sid) || [];
    // total: TỔNG message tuyệt đối (messages chỉ là window 30 cuối) — client cần để
    // quy đổi offset /clear; thiếu total thì /clear trên session >30 msg mất message mới vĩnh viễn
    const parsed = parseSessionFile(file);
    const total = parsed ? parsed.msgs.length : messages.length;
    // start: chỉ số tuyệt đối của messages[0]. Client so start để biết window ĐÃ TRƯỢT
    // (msg mới đẩy msg cũ ra, length không đổi) — thiếu nó thì client đứng hình không nhận msg mới.
    const start = Math.max(0, total - messages.length);
    // tool_use chưa có result + session đang chạy = đang thực thi -> chip "running".
    // Không typing thì để pending (run bị kill/ngắt), client hiện chip mờ.
    if (typing && messages.length) {
      const last = messages[messages.length - 1];
      if (last.parts) {
        last.parts = last.parts.map(p => (p.t === 'tool' && p.status === 'pending' ? Object.assign({}, p, { status: 'running' }) : p));
      }
    }
    // lỗi lần chạy gần nhất (vd resume trượt) — client hiện banner thay vì im lặng
    const se = spawnErrors.get(sid);
    return json(res, 200, {
      sid, messages, total, start, typing,
      title: titleOf(sid, parsed ? parsed.title : ''),
      status: statusOf(sid, mt),
      error: se && Date.now() - se.at < 120000 ? se.msg : null,
      // đang chờ duyệt kế hoạch: có file plan ở lượt cuối và Claude đã dừng
      awaiting: !!(parsed && parsed.planFile && !typing),
      usage: parsed ? parsed.usage : null, // token đã dùng (thay cho /cost)
      /* Dự án của phiên: tên thư mục thật + repo GitHub + nhánh + thư mục còn tồn
         tại không. Danh sách phiên đã hiện đủ những thứ này, nhưng MỞ phiên ra thì
         mất sạch — chỉ còn mỗi cái tên. Cùng một dữ liệu, không tốn thêm lần đọc
         file nào (docCwd có cache riêng). */
      duAn: duAnCho(docCwd(file)),
      /* HAI trường model khác nghĩa, đừng gộp:
         - `model`  = model ĐẶT RIÊNG cho phiên này (null = đang theo model toàn cục).
                      Giao diện dùng nó để biết chip model có đang bị ghi đè không, và
                      để xoá về mặc định. Gộp model-đã-chạy vào đây thì phiên chưa đặt
                      gì cũng trả về một tên -> nhìn như bị dính model của phiên khác.
         - `modelDaChay` = model THẬT đọc từ .jsonl (lượt assistant mới nhất). Đây là
                      thứ đầu trang chat hiển thị, đúng cả với phiên chạy từ terminal. */
      model: loadModels()[sid] || null,
      modelDaChay: (parsed && parsed.model) || null,
      effort: parsed ? parsed.effort : '',
      /* Bản nháp đang chảy ra từ stdout của lượt hiện tại.
         .jsonl chỉ được ghi KHI LƯỢT XONG, nên nếu chỉ đọc file thì màn hình đứng im
         hàng chục giây rồi bung ra một cục. Có cái này thì chữ hiện dần như terminal.
         Chỉ gửi khi đang chạy; xong lượt là bản thật từ .jsonl thay chỗ. */
      nhap: typing ? String((procs.get(sid) || {}).nhap || '').trim() : '',
    });
  }

  // ---- model riêng cho 1 phiên (để trống = dùng lại model toàn cục) ----
  if ((m = p.match(/^\/api\/model\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const mv = String(body.model || '').trim();
    if (!setSessionModel(sid, mv)) return json(res, 500, { error: 'không ghi được file model' });
    return json(res, 200, { ok: true, model: mv || null, effective: modelFor(sid) });
  }

  // ---- nhận ảnh từ điện thoại: lưu ra file rồi trả đường dẫn để chèn vào prompt.
  // Claude CLI đọc ảnh qua tool Read, nên chỉ cần đưa nó đường dẫn trên đĩa. ----
  if (p === '/api/upload' && req.method === 'POST') {
    let body;
    try { body = await readBody(req, 12e6); }   // 12MB base64 ≈ ảnh gốc ~9MB
    catch (e) { return json(res, 400, { error: /large/.test(e.message) ? 'ảnh quá lớn (tối đa ~8MB)' : 'body lỗi' }); }
    const m2 = String(body.data || '').match(/^data:(image\/[a-z.+-]+);base64,(.+)$/i);
    if (!m2) return json(res, 400, { error: 'chỉ nhận ảnh' });
    const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
                   'image/gif': 'gif', 'image/heic': 'heic' })[m2[1].toLowerCase()] || 'png';
    let buf;
    try { buf = Buffer.from(m2[2], 'base64'); } catch { return json(res, 400, { error: 'dữ liệu ảnh hỏng' }); }
    if (!buf.length) return json(res, 400, { error: 'ảnh rỗng' });
    try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
    const name = 'img-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.' + ext;
    const dest = path.join(UPLOAD_DIR, name);
    try { fs.writeFileSync(dest, buf); } catch (e) { return json(res, 500, { error: 'không lưu được ảnh' }); }
    pruneUploads();
    return json(res, 200, { ok: true, path: dest, name, bytes: buf.length });
  }

  /* ---- gợi ý đường dẫn file cho "@" trong ô chat ----
     Trên terminal, gõ @ rồi vài chữ là Claude CLI gợi ý file trong thư mục dự án.
     Dashboard không có gì tương đương nên phải tự gõ tay cả đường dẫn dài.

     Chỉ đọc TÊN file, không đọc nội dung. Gốc tìm kiếm là cwd của chính phiên đó
     (sessionCwd) — không cho client truyền thư mục tuỳ ý, nếu không thì ai có token
     cũng liệt kê được toàn bộ đĩa. */
  if (p === '/api/files' && req.method === 'GET') {
    const sid = String(url.searchParams.get('sid') || '');
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 120);
    const root = sid ? sessionCwd(sid) : null;
    if (!root) return json(res, 200, { ok: true, root: null, files: [] });
    let ds;
    try { ds = quetFile(root); } catch { return json(res, 200, { ok: true, root, files: [] }); }
    // Tên file khớp trước, rồi mới tới khớp ở giữa đường dẫn — gõ "chat" phải ra
    // chat-view.tsx trước components/cli/chat-toolbar.tsx.
    const dau = [], giua = [];
    for (const f of ds) {
      if (dau.length >= 20) break;
      if (!q) { dau.push(f); continue; }
      const ten = f.slice(f.lastIndexOf('/') + 1).toLowerCase();
      if (ten.startsWith(q)) dau.push(f);
      else if (giua.length < 20 && f.toLowerCase().includes(q)) giua.push(f);
    }
    return json(res, 200, { ok: true, root, files: dau.concat(giua).slice(0, 20) });
  }

  // ---- duyệt kế hoạch: chạy tiếp lượt đang chờ, lần này CHO PHÉP sửa file ----
  if ((m = p.match(/^\/api\/approve\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    if (procs.has(sid)) return json(res, 409, { error: 'session đang chạy' });
    let body = {};
    try { body = await readBody(req); } catch {}
    const note = String(body.note || '').trim();
    const msg = note
      ? 'Duyệt kế hoạch, làm luôn. Lưu ý thêm: ' + note
      : 'Duyệt kế hoạch. Thực hiện đúng như đã trình bày.';
    // ép acceptEdits cho lượt này, bất kể công tắc đang ở chế độ nào — người dùng vừa duyệt rồi
    const aargs = ['-p', msg, '--resume', sid, '--permission-mode', 'acceptEdits'].concat(effortArgs());
    const amdl = modelFor(sid);
    if (amdl) aargs.push('--model', amdl);
    spawnClaude(aargs, sid, { task: msg });
    return json(res, 200, { ok: true, sid });
  }

  // ---- đổi tên phiên chat (ghi riêng dashboard, không đụng .jsonl của Claude CLI) ----
  if ((m = p.match(/^\/api\/title\/([\w-]+)$/)) && req.method === 'POST') {
    const sid = m[1];
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const name = String(body.title == null ? '' : body.title).trim().slice(0, 120);
    if (!setTitle(sid, name)) return json(res, 500, { error: 'không ghi được file tên' });
    // trả lại tiêu đề hiệu lực: xoá tên tự đặt thì rơi về ai-title
    const file = findSessionFile(sid);
    const parsed = file ? parseSessionFile(file) : null;
    return json(res, 200, { ok: true, title: titleOf(sid, parsed ? parsed.title : '') });
  }

  // ---- tải phiên về máy (.md để đọc, .json để xử lý tiếp) ----
  // Bản legacy đã có nút "Tải .md"/"Tải .json" gọi vào đây nhưng route CHƯA TỪNG tồn tại
  // -> bấm là 404. Bổ sung ở đây nên cả hai giao diện cùng dùng được.
  if ((m = p.match(/^\/api\/export\/([\w-]+)$/))) {
    const sid = m[1];
    const file = findSessionFile(sid);
    if (!file) return json(res, 404, { error: 'session not found' });
    const parsed = parseSessionFile(file);
    if (!parsed) return json(res, 500, { error: 'không đọc được phiên' });
    const fmt = (url.searchParams.get('fmt') || 'md').toLowerCase();
    const name = titleOf(sid, parsed.title) || sid;
    // Tên file cho người đọc: CHỈ GIỮ chữ/số/khoảng trắng/._- (danh sách trắng).
    // Danh sách trắng thay vì liệt kê ký tự cấm để không sót ký tự điều khiển;
    // \p{L} giữ được tiếng Việt có dấu.
    const safe = (name.replace(/[^\p{L}\p{N} ._-]/gu, '-').trim().slice(0, 60) || sid);

    if (fmt === 'json') {
      // Trường tên `messages` (không phải `msgs`) — trùng với /api/history và với
      // bản legacy, nên công cụ nào đọc được cái này thì đọc được cái kia.
      const out = JSON.stringify({
        sid, title: name, exportedAt: new Date().toISOString(),
        usage: parsed.usage, messages: parsed.msgs,
      }, null, 2);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + encodeURIComponent(safe) + '.json"',
      });
      return res.end(out);
    }

    const L = ['# ' + name, '', '_Phiên `' + sid + '` · tải lúc ' + new Date().toLocaleString('vi-VN') + '_', ''];
    if (parsed.usage && parsed.usage.turns) {
      const g = parsed.usage;
      L.push('> ' + g.turns + ' lượt · gửi ' + g.inTok + ' token · nhận ' + g.outTok +
             ' token · cache đọc ' + g.cacheRead + ' / ghi ' + g.cacheWrite, '');
    }
    for (const msg of parsed.msgs) {
      const when = msg.ts ? new Date(msg.ts).toLocaleString('vi-VN') : '';
      L.push('## ' + (msg.role === 'user' ? 'Vinh' : 'Claude') + (when ? ' · ' + when : ''), '');
      for (const part of (msg.parts || [])) {
        if (part.t === 'text') { L.push(part.text, ''); continue; }
        // Tool: tóm tắt + kết quả, cắt bớt để file không phình vô hạn.
        // Đánh dấu ERROR và số ảnh ngay ở dòng đầu — đọc file .md rời khỏi dashboard
        // vẫn thấy ngay lượt nào hỏng mà không phải mở từng khối kết quả.
        const err = part.status === 'error' ? ' — ERROR' : '';
        const nImg = (part.images || []).length;
        const img = nImg ? ' [' + nImg + ' ảnh]' : '';
        L.push('**' + (part.disp || part.name) + '**' + err + ' — ' + (part.summary || '') + img, '');
        if (part.input) L.push('```', String(part.input).slice(0, 4000), '```', '');
        if (part.result) L.push('<details><summary>Kết quả</summary>', '',
          '```', String(part.result).slice(0, 4000), '```', '', '</details>', '');
      }
      // lượt chỉ có text trần (không tách parts) thì vẫn phải xuất ra
      if (!(msg.parts || []).length && msg.text) L.push(msg.text, '');
    }
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + encodeURIComponent(safe) + '.md"',
    });
    return res.end(L.join('\n'));
  }

  // ---- ảnh trong tool_result (screenshot...): trả binary, cache lâu vì nội dung bất biến ----
  /* ---- MỌI ảnh của cả phiên, không giới hạn cửa sổ 30 tin ----
     /api/history chỉ trả 30 tin cuối (payload 25KB mỗi 2 giây khi phiên đang chạy),
     nên ảnh cũ không cách nào xem lại — đo trên phiên 58MB: 123 ảnh, 0 cái nằm trong
     30 tin cuối. Chỉ trả siêu dữ liệu; ảnh thật vẫn tải lười qua /api/toolimg. */
  if ((m = p.match(/^\/api\/imgs\/([\w-]+)$/))) {
    const file = findSessionFile(m[1]);
    if (!file) return json(res, 404, { error: 'session not found' });
    const anh = listSessionImages(file);
    return json(res, 200, { ok: true, anh, tong: anh.length });
  }

  if ((m = p.match(/^\/api\/toolimg\/([\w-]+)\/([\w-]+)\/(\d+)$/))) {
    const file = findSessionFile(m[1]);
    if (!file) return json(res, 404, { error: 'session not found' });
    const img = findToolImage(file, m[2], +m[3]);
    if (!img) return json(res, 404, { error: 'image not found' });
    res.writeHead(200, {
      'Content-Type': img.mt,
      'Content-Length': img.buf.length,
      'Cache-Control': 'public, max-age=31536000, immutable', // tool_result đã ghi thì không đổi
    });
    return res.end(img.buf);
  }

  if ((m = p.match(/^\/api\/status\/([\w-]+)$/))) {
    const sid = m[1];
    const file = findSessionFile(sid);
    let mt = 0;
    if (file) { try { mt = fs.statSync(file).mtimeMs; } catch {} }
    return json(res, 200, { sid, status: statusOf(sid, mt), running: procs.has(sid), typing: procs.has(sid) });
  }

  // (Handler /api/export thứ hai từng nằm ở đây đã được XOÁ: nó không bao giờ
  //  chạy được vì handler ở phần trên đã return trước — code chết.)

  // ---- /model: set model cho task mới ----
  if (p === '/api/model' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    currentModel = (body.model || '').trim() || null;
    return json(res, 200, { ok: true, model: currentModel });
  }

  // ---- chế độ quyền: quyết định Claude có tự sửa file được không ----
  /* Mức suy nghĩ. Tách route riêng khỏi /api/perm để đổi cái này không vô tình
     ghi đè cái kia. */
  if (p === '/api/effort' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const v = String(body.effort || '');
    if (v && EFFORTS.indexOf(v) < 0) return json(res, 400, { error: 'mức không hợp lệ' });
    effort = v;              // '' = để CLI tự quyết
    saveModes();
    return json(res, 200, { ok: true, effort });
  }

  if (p === '/api/perm' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const mode = String(body.mode || '');
    if (PERM_MODES.indexOf(mode) < 0) return json(res, 400, { error: 'mode không hợp lệ' });
    permMode = mode;
    saveModes();
    return json(res, 200, { ok: true, mode: permMode });
  }

  // ---- /loop: tạo loop job chạy prompt mỗi interval ----
  if (p === '/api/loop' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const ms = parseInterval(body.interval);
    const prompt = (body.prompt || '').trim();
    if (!ms || !prompt) return json(res, 400, { error: 'cần interval (vd 30s/5m/1h) và prompt' });
    if (ms < 30000) return json(res, 400, { error: 'interval tối thiểu 30s (mỗi lượt spawn 1 claude process)' });
    const id = crypto.randomUUID().slice(0, 8);
    const job = { id, kind: 'loop', spec: body.interval, prompt, runs: 0, lastSid: null };
    job.timer = setInterval(() => runJob(job), ms);
    jobs.set(id, job);
    runJob(job); // chạy ngay lượt đầu
    return json(res, 200, { ok: true, id });
  }

  // ---- /schedule: tạo cron job ----
  if (p === '/api/schedule' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const spec = (body.cron || '').trim();
    const prompt = (body.prompt || '').trim();
    if (spec.split(/\s+/).length !== 5 || !prompt) {
      return json(res, 400, { error: 'cần cron 5 trường (vd "*/15 * * * *") và prompt' });
    }
    const id = crypto.randomUUID().slice(0, 8);
    jobs.set(id, { id, kind: 'cron', spec, prompt, runs: 0, lastSid: null, lastKey: '' });
    return json(res, 200, { ok: true, id });
  }

  // ---- danh sách / dừng jobs ----
  if (p === '/api/jobs' && req.method === 'GET') return json(res, 200, { jobs: listJobs() });

  // ---- huỷ việc nền ----
  // TRƯỚC ĐÂY KHÔNG CÓ: tạo /loop xong là nó chạy mãi, muốn dừng phải restart server
  // (mất luôn mọi job khác). Job kiểu loop giữ timer của setInterval nên phải
  // clearInterval, chỉ xoá khỏi Map thì timer vẫn nổ và vẫn spawn claude.
  if ((m = p.match(/^\/api\/jobs\/([\w-]+)$/)) && req.method === 'DELETE') {
    const job = jobs.get(m[1]);
    if (!job) return json(res, 404, { error: 'không có job này' });
    if (job.timer) clearInterval(job.timer);
    jobs.delete(m[1]);
    return json(res, 200, { ok: true, id: m[1] });
  }
  if ((m = p.match(/^\/api\/jobs\/stop\/([\w-]+)$/)) && req.method === 'POST') {
    const job = jobs.get(m[1]);
    if (!job) return json(res, 404, { error: 'job không tồn tại' });
    if (job.timer) clearInterval(job.timer);
    jobs.delete(m[1]);
    return json(res, 200, { ok: true });
  }

  // ---- enhance: viết lại prompt thô thành prompt tối ưu (oneshot) ----
  if (p === '/api/enhance' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const text = (body.text || '').trim();
    if (!text) return json(res, 400, { error: 'text required' });
    const meta = 'Bạn là chuyên gia prompt engineering. Viết lại yêu cầu sau thành MỘT prompt tối ưu '
      + '(bổ sung role, context, output format, constraints, ví dụ nếu hữu ích). '
      + 'CHỈ trả về nội dung prompt đã viết lại, không giải thích thêm.\n\nYêu cầu gốc:\n' + text;
    return json(res, 200, { ok: true, id: runOneshot(meta) });
  }

  // ---- /summary: tóm tắt session từ history (oneshot) ----
  if ((m = p.match(/^\/api\/summary\/([\w-]+)$/)) && req.method === 'POST') {
    const messages = getHistory(m[1]);
    if (!messages || !messages.length) return json(res, 400, { error: 'session không có history' });
    const convo = messages.map(x => x.role.toUpperCase() + ': ' + x.content.slice(0, 2000)).join('\n\n');
    const prompt = 'Tóm tắt ngắn gọn cuộc hội thoại sau bằng tiếng Việt, dạng gạch đầu dòng '
      + '(nội dung chính, quyết định, việc còn dang dở):\n\n' + convo;
    return json(res, 200, { ok: true, id: runOneshot(prompt) });
  }

  // ---- poll kết quả oneshot ----
  if ((m = p.match(/^\/api\/oneshot\/([\w-]+)$/))) {
    const rec = oneshots.get(m[1]);
    if (!rec) return json(res, 404, { error: 'not found' });
    return json(res, 200, { status: rec.status, output: rec.output });
  }

  // ---- Hermes: stream hội thoại của orchestrator (read-only) ----
  if (p === '/api/hermes' && req.method === 'GET') {
    // sending nằm NGOÀI cache: typing indicator phải realtime, không trễ theo cache 1.5s
    return json(res, 200, { ...(await getHermesData()), sending: hermesSending > 0 });
  }
  // Chat 2 chiều: gọi THẬT Hermes CLI (-z "<text>" -m <model>), đợi stdout -> reply
  // ---- chạy lệnh con của Hermes CLI (status, sessions, skills, memory, cron, doctor…)
  // Whitelist: Hermes có 70+ lệnh, nhiều cái cần tương tác terminal (setup, login) hoặc
  // đổi cấu hình máy — chỉ mở những lệnh ĐỌC/an toàn để bấm nhầm không hỏng gì. ----
  const HERMES_SAFE = ['status', 'sessions', 'skills', 'memory', 'cron', 'doctor', 'model',
    'tools', 'mcp', 'insights', 'version', 'config'];
  if (p === '/api/hermes/run' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
    const cmd = String(body.cmd || '').trim();
    const args = Array.isArray(body.args) ? body.args.map(String).slice(0, 6) : [];
    if (HERMES_SAFE.indexOf(cmd) < 0) return json(res, 400, { ok: false, error: 'lệnh không được phép: ' + cmd });
    execFile(HERMES_BIN, [cmd, ...args], { maxBuffer: 4 * 1024 * 1024, timeout: 30000, env: process.env },
      (err, stdout, stderr) => {
        const out = ((stdout || '') + (stderr || '')).trim();
        if (err && !out) return json(res, 500, { ok: false, error: err.message.slice(0, 300) });
        json(res, 200, { ok: true, output: out.slice(-20000) || '(không có output)' });
      });
    return;
  }

  // ---- chạy lệnh slash của Claude CLI và trả VĂN BẢN (không tạo phiên chat).
  // Dùng cho /context /cost /mcp /doctor… — những lệnh chỉ để xem thông tin. ----
  if (p === '/api/claude/run' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
    const cmd = String(body.cmd || '').trim();
    if (!cmd.startsWith('/')) return json(res, 400, { ok: false, error: 'phải là lệnh slash' });
    const cwd = body.sid ? (sessionCwd(String(body.sid)) || os.homedir()) : os.homedir();
    const args = ['-p', cmd].concat(permArgs(), effortArgs());
    execFile('claude', args, { cwd, maxBuffer: 4 * 1024 * 1024, timeout: 60000, env: process.env },
      (err, stdout, stderr) => {
        const out = ((stdout || '') + (stderr || '')).trim();
        // CLI chặn lệnh ở chế độ -p thì báo rõ, đừng để người dùng tưởng hỏng
        if (/isn't available in this environment/i.test(out)) {
          return json(res, 200, { ok: false, blocked: true, output: out.slice(0, 500) });
        }
        if (err && !out) return json(res, 500, { ok: false, error: err.message.slice(0, 300) });
        json(res, 200, { ok: true, output: out.slice(-20000) || '(không có output)' });
      });
    return;
  }

  if (p === '/api/hermes/send' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
    const text = (body.text || '').trim();
    if (!text) return json(res, 400, { ok: false, error: 'text required' });
    hermesSending++;
    execFile(HERMES_BIN, ['-z', text, '-m', HERMES_MODEL],
      { maxBuffer: 10 * 1024 * 1024, timeout: 180000, env: process.env },
      (err, stdout, stderr) => {
        hermesSending = Math.max(0, hermesSending - 1);
        hermesCache.at = 0; // reply có thể đã ghi vào state.db -> poll kế tiếp đọc data mới ngay
        if (err) {
          const msg = ((stderr || '').trim() || err.message || 'hermes error').slice(-2000);
          return json(res, 500, { ok: false, error: msg });
        }
        notifyPush('Hermes đã trả lời');
        json(res, 200, { ok: true, reply: (stdout || '').trim() || '(hermes không trả output)' });
      });
    return; // response trả trong callback execFile
  }

  /* ---- DOCKER: xem trạng thái + bật/tắt/khởi động lại ----
     Theo mẫu AGY_TASKS chứ KHÔNG theo mẫu HERMES_SAFE: client gửi tên hành động,
     server tra bảng cứng ra tham số. Client không bao giờ truyền cờ tự do — cho
     truyền là mở đường cho `docker run -v /:/host` tức thoát hẳn ra khỏi máy.

     Không có xoá container/image/volume: volume postgres/neo4j của webapp nằm trong
     đó, bấm nhầm trên điện thoại là mất dữ liệu thật. Chỉ cho dọn build cache. */
  if (p.startsWith('/api/docker/')) {
    const DOCKER_ACTIONS = { start: 'start', stop: 'stop', restart: 'restart' };
    // id do docker sinh (hoặc tên container), không nối chuỗi bao giờ
    const okId = (s) => /^[a-zA-Z0-9][\w.-]{0,127}$/.test(String(s || ''));
    const run = (args, timeout = 15000) => new Promise((resolve) => {
      execFile('docker', args, { maxBuffer: 4 * 1024 * 1024, timeout, env: process.env },
        (err, out, errOut) => resolve({ err, out: String(out || ''), errOut: String(errOut || '') }));
    });
    // mỗi dòng là một JSON riêng (--format '{{json .}}'), không phải mảng
    const lines = (s) => String(s).split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    if (p === '/api/docker/ps' && req.method === 'GET') {
      const now = Date.now();
      if (dockerCache.at > now - 3000 && dockerCache.data) return json(res, 200, dockerCache.data);
      /* Thêm `docker stats`: trước đây chỉ biết container CÒN SỐNG hay không, chứ
         không biết cái nào đang ngốn CPU/RAM — mà đó mới là thứ cần thấy khi máy ì.
         --no-stream bắt buộc: thiếu nó thì lệnh chạy mãi và treo request. */
      const [ps, df, st] = await Promise.all([
        run(['ps', '-a', '--format', '{{json .}}']),
        run(['system', 'df', '--format', '{{json .}}']),
        run(['stats', '--no-stream', '--format', '{{json .}}'], 20000),
      ]);
      if (ps.err) {
        return json(res, 200, { ok: false, error: /not found|ENOENT/i.test(ps.err.message)
          ? 'Máy chưa cài Docker' : 'Docker không phản hồi (Docker Desktop đang tắt?)' });
      }
      // gộp stats vào từng container theo TÊN; container đã dừng thì không có dòng stats
      const theoTen = new Map(lines(st.out).map((x) => [x.Name, x]));
      const containers = lines(ps.out).map((c) => {
        const s = theoTen.get(c.Names);
        return s ? { ...c, cpu: s.CPUPerc, ram: s.MemUsage, ramPct: s.MemPerc } : c;
      });
      const data = { ok: true, containers, df: lines(df.out) };
      dockerCache = { at: now, data };
      return json(res, 200, data);
    }

    if (p === '/api/docker/logs' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!okId(id)) return json(res, 400, { error: 'id không hợp lệ' });
      // --tail BẮT BUỘC: log không giới hạn có thể trả hàng GB, đủ để treo cả server
      const r = await run(['logs', '--tail', '400', '--timestamps', id], 20000);
      if (r.err && !r.out && !r.errOut) return json(res, 200, { ok: false, error: 'không đọc được log' });
      return json(res, 200, { ok: true, log: (r.out + r.errOut).slice(-60000) });
    }

    if (p === '/api/docker/action' && req.method === 'POST') {
      let body; try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
      const act = DOCKER_ACTIONS[String(body.action || '')];
      if (!act) return json(res, 400, { error: 'hành động không được phép' });
      if (!okId(body.id)) return json(res, 400, { error: 'id không hợp lệ' });
      const r = await run([act, String(body.id)], 60000);
      dockerCache = { at: 0, data: null };
      if (r.err) return json(res, 200, { ok: false, error: (r.errOut || r.err.message).slice(0, 300) });
      return json(res, 200, { ok: true, out: r.out.trim() });
    }

    // Dọn build cache — thứ duy nhất được phép xoá, và phải xác nhận rõ ràng
    if (p === '/api/docker/prune-build' && req.method === 'POST') {
      let body; try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
      if (body.confirm !== true) return json(res, 400, { error: 'cần xác nhận' });
      const r = await run(['builder', 'prune', '-af'], 120000);
      dockerCache = { at: 0, data: null };
      if (r.err) return json(res, 200, { ok: false, error: (r.errOut || r.err.message).slice(0, 300) });
      return json(res, 200, { ok: true, out: r.out.trim().slice(-2000) });
    }
    return json(res, 404, { error: 'not found' });
  }

  /* ---- Đọc file kế hoạch ~/.claude/plans/*.md ----
     Kế hoạch thật rất dài (đo hai mẫu: 15.371 và 6.754 ký tự) nên đọc trong khung
     chat rất mệt; mở bản .md đầy đủ dễ hơn nhiều.

     Chỉ cho đọc ĐÚNG trong ~/.claude/plans và đúng đuôi .md. Kiểm bằng đường dẫn đã
     resolve chứ không phải chuỗi thô — nếu không thì `../../.ssh/id_rsa` lọt qua và
     dashboard thành công cụ đọc trộm cả đĩa. */
  if (p === '/api/plan' && req.method === 'GET') {
    const THU_MUC = path.join(os.homedir(), '.claude', 'plans');
    const xin = path.resolve(String(url.searchParams.get('path') || ''));
    if (!xin.startsWith(THU_MUC + path.sep) || !xin.endsWith('.md')) {
      return json(res, 400, { error: 'chỉ đọc được file kế hoạch' });
    }
    let noi;
    try { noi = fs.readFileSync(xin, 'utf8'); }
    catch { return json(res, 404, { error: 'không thấy file kế hoạch' }); }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(noi);
  }

  /* ---- Postgres: xem sức khoẻ CSDL chạy trong Docker ----
     Máy này KHÔNG có psql (đã kiểm: `which psql` rỗng, không có gói homebrew nào),
     nên đi qua `docker exec` vào chính container — dự án zero-dependency, không thêm
     driver pg.

     Hai điều bắt buộc:
     1. SQL đi qua BIẾN MÔI TRƯỜNG (-e Q=...), không nối vào chuỗi lệnh. Nối chuỗi thì
        mọi dấu nháy trong SQL phải tự thoát, sai một cái là cú pháp vỡ hoặc tệ hơn.
     2. Bảng truy vấn CỨNG, client chỉ gửi TÊN. Không nhận SQL tự do — mở cửa cho
        DROP TABLE thì mất dữ liệu thật, mà đây là dashboard bấm trên điện thoại.
     User CSDL đọc từ $POSTGRES_USER của chính container, không đoán 'postgres'
     (container ở máy này dùng user 'autodub' — đoán bừa là lỗi ngay). */
  if (p.startsWith('/api/pg/')) {
    const runDocker = (args, timeout = 15000) => new Promise((resolve) => {
      execFile('docker', args, { maxBuffer: 4 * 1024 * 1024, timeout, env: process.env },
        (err, out, errOut) => resolve({ err, out: String(out || ''), errOut: String(errOut || '') }));
    });

    // Tìm container Postgres đang CHẠY. Nhớ tạm 10s để không gọi docker mỗi nhịp poll.
    async function timContainerPg() {
      const now = Date.now();
      if (pgCache.ten && now - pgCache.at < 10000) return pgCache.ten;
      const r = await runDocker(['ps', '--filter', 'ancestor=postgres', '--format', '{{.Names}}']);
      let ten = String(r.out || '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
      if (!ten) {
        // ancestor chỉ khớp image tên đúng 'postgres'; postgres:16-alpine thì phải soi tên
        const r2 = await runDocker(['ps', '--format', '{{.Names}}\t{{.Image}}']);
        const d = String(r2.out || '').split('\n').filter(Boolean)
          .map(l => l.split('\t')).find(([, img]) => /postgres/i.test(img || ''));
        ten = d ? d[0].trim() : '';
      }
      pgCache = { at: now, ten };
      return ten;
    }

    async function hoiPg(sql, db) {
      const ten = await timContainerPg();
      if (!ten) return { ok: false, error: 'Không thấy container Postgres nào đang chạy' };
      const args = ['exec', '-e', 'Q=' + sql, ten, 'sh', '-c',
        db ? 'psql -U "$POSTGRES_USER" -d ' + db + ' -tA -c "$Q"'
          : 'psql -U "$POSTGRES_USER" -tA -c "$Q"'];
      const r = await runDocker(args);
      if (r.err || /^ERROR/m.test(r.errOut)) {
        return { ok: false, error: (r.errOut || r.err.message || '').split('\n')[0].slice(0, 200) };
      }
      return { ok: true, dong: r.out.split('\n').filter(Boolean).map(l => l.split('|')) };
    }

    if (p === '/api/pg/status' && req.method === 'GET') {
      const ten = await timContainerPg();
      if (!ten) return json(res, 200, { ok: false, error: 'Không thấy container Postgres nào đang chạy' });

      const [ban, dbs, ket] = await Promise.all([
        hoiPg("SELECT current_setting('server_version') || '|' "
          + "|| date_trunc('second', now() - pg_postmaster_start_time())::text;"),
        hoiPg('SELECT datname || \'|\' || pg_database_size(datname) FROM pg_database '
          + 'WHERE NOT datistemplate ORDER BY pg_database_size(datname) DESC;'),
        hoiPg("SELECT coalesce(state,'không rõ') || '|' || count(*) FROM pg_stat_activity GROUP BY state;"),
      ]);
      if (!ban.ok) return json(res, 200, { ok: false, error: ban.error, container: ten });

      const [ver, uptime] = (ban.dong[0] || ['', '']);
      return json(res, 200, {
        ok: true,
        container: ten,
        version: ver || '',
        uptime: uptime || '',
        dbs: (dbs.ok ? dbs.dong : []).map(([ten2, bytes]) => ({ ten: ten2, bytes: +bytes || 0 })),
        ketNoi: (ket.ok ? ket.dong : []).map(([trangThai, n]) => ({ trangThai, n: +n || 0 })),
      });
    }

    if (p === '/api/pg/tables' && req.method === 'GET') {
      // tên db do client chọn TỪ danh sách server trả về -> vẫn phải kiểm dạng
      const db = String(url.searchParams.get('db') || '');
      if (db && !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(db)) {
        return json(res, 400, { error: 'tên database không hợp lệ' });
      }
      const r = await hoiPg("SELECT relname || '|' || n_live_tup || '|' "
        + '|| pg_total_relation_size(relid) FROM pg_stat_user_tables '
        + 'ORDER BY pg_total_relation_size(relid) DESC LIMIT 30;', db);
      if (!r.ok) return json(res, 200, { ok: false, error: r.error });
      return json(res, 200, {
        ok: true,
        bang: r.dong.map(([ten, dong, bytes]) => ({ ten, dong: +dong || 0, bytes: +bytes || 0 })),
      });
    }

    if (p === '/api/pg/activity' && req.method === 'GET') {
      const r = await hoiPg("SELECT pid || '|' || coalesce(state,'?') || '|' "
        + "|| date_trunc('second', now() - query_start)::text || '|' "
        + "|| replace(left(coalesce(query,''), 90), '|', ' ') "
        + "FROM pg_stat_activity WHERE state <> 'idle' AND pid <> pg_backend_pid() "
        + 'ORDER BY query_start LIMIT 20;');
      if (!r.ok) return json(res, 200, { ok: false, error: r.error });
      return json(res, 200, {
        ok: true,
        truyVan: r.dong.map(([pid, trangThai, lau, sql]) => ({ pid, trangThai, lau, sql })),
      });
    }

    return json(res, 404, { error: 'not found' });
  }

  /* ---- AGY: báo cáo + điều khiển qua API chính thức ---- */

  // Báo cáo: gộp 3 endpoint để client chỉ gọi một lần
  if (p === '/api/agy/report' && req.method === 'GET') {
    const range = ['7d', '30d', '90d'].includes(url.searchParams.get('range') || '')
      ? url.searchParams.get('range') : '7d';
    const days = range === '90d' ? 90 : range === '30d' ? 30 : 7;
    const [usage, stats, quota] = await Promise.all([
      agyApi('/api/gateway/usage?range=' + range + '&groupBy=day'),
      agyApi('/api/gateway/stats?days=' + days),
      agyApi('/api/gateway/quota-summary'),
    ]);
    if (!usage.ok) return json(res, 200, { ok: false, error: usage.error, status: usage.status });
    return json(res, 200, {
      ok: true, range,
      usage: usage.data,
      stats: stats.ok ? stats.data : null,     // đắt (quét bảng) — hỏng thì bỏ qua, không chặn cả báo cáo
      quota: quota.ok ? quota.data : null,
    });
  }

  // Chiến lược xoay hiện tại — /api/agy/status đọc SQLite nên không có thông tin này
  if (p === '/api/agy/rotation' && req.method === 'GET') {
    const r = await agyApi('/api/gateway/config');
    return json(res, 200, r.ok
      ? { ok: true, rotation: r.data.rotation, enabled: r.data.enabled }
      : { ok: false, error: r.error });
  }

  // Tải CSV — proxy qua server để token không bao giờ ra client
  if (p === '/api/agy/export.csv' && req.method === 'GET') {
    const range = ['7d', '30d', '90d'].includes(url.searchParams.get('range') || '')
      ? url.searchParams.get('range') : '7d';
    const token = await agyToken();
    // Đây là điều hướng của trình duyệt (location.href), không phải fetch — trả 200
    // kèm JSON thì người dùng bị đẩy sang trang JSON trần, mất luôn màn hình đang xem.
    if (!token) return json(res, 502, { error: 'chưa có CLI token của agy-proxy' });
    const port = await agyPort();
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/api/gateway/usage/export.csv?range=' + range, {
        headers: { authorization: 'Basic ' + Buffer.from(':' + token).toString('base64') },
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) return json(res, 502, { error: 'agy trả lỗi ' + r.status });
      const csv = await r.text();
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="agy-' + range + '.csv"',
      });
      return res.end(csv);
    } catch { return json(res, 502, { error: 'không tải được CSV' }); }
  }

  if (p === '/api/agy/quota-history' && req.method === 'GET') {
    const range = ['1d', '7d', '30d', '90d'].includes(url.searchParams.get('range') || '')
      ? url.searchParams.get('range') : '7d';
    const r = await agyApi('/api/gateway/quota/history?range=' + range);
    return json(res, 200, r.ok ? { ...r.data, ok: true } : { ok: false, error: r.error, status: r.status });
  }

  /* Điều khiển — BẢNG CỨNG 4 lệnh mà tài liệu bàn giao xác nhận đảo ngược được.
     Client gửi TÊN lệnh, server tra ra path+body. Không nhận path tự do, vì cùng
     một endpoint /api/gateway/config còn nhận `enabled:false` (tắt gateway) và
     `regenerateKey:true` (giết mọi client đang dùng) — cho client tự dựng body là
     mở toang cửa đó. Nhóm nguy hiểm (accounts/bulk, accounts/check quét cả pool
     ~14 phút, system/restart, backup/export) KHÔNG có mặt ở đây nên không gọi tới được. */
  if (p === '/api/agy/control' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const act = String(body.action || '');
    const ROTATIONS = ['round-robin', 'full-first', 'failover', 'highest-first', 'smart'];

    if (act === 'wake') {
      const r = await agyApi('/api/gateway/accounts/wake', { method: 'POST', body: {}, timeout: 30000 });
      return json(res, 200, r.ok ? { ...r.data, ok: true } : { ok: false, error: r.error });
    }
    if (act === 'quota-refresh') {
      const r = await agyApi('/api/gateway/quota/refresh', { method: 'POST', body: {}, timeout: 30000 });
      return json(res, 200, r.ok ? { ...r.data, ok: true } : { ok: false, error: r.error });
    }
    if (act === 'checklive') {
      // CHỈ một account. Bản quét cả pool mất ~14 phút và bị upstream chặn tốc độ.
      const email = String(body.email || '').trim();
      if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) return json(res, 400, { ok: false, error: 'cần email hợp lệ' });
      const r = await agyApi('/api/gateway/accounts/' + encodeURIComponent(email) + '/checklive',
        { method: 'POST', body: {}, timeout: 60000 });
      return json(res, 200, r.ok ? { ...r.data, ok: true } : { ok: false, error: r.error });
    }
    if (act === 'set-rotation') {
      const v = String(body.rotation || '');
      if (!ROTATIONS.includes(v)) return json(res, 400, { ok: false, error: 'chiến lược không hợp lệ' });
      // CHỈ gửi đúng khoá `rotation` — tuyệt đối không lấy cả object config rồi PATCH ngược
      const r = await agyApi('/api/gateway/config', { method: 'PATCH', body: { rotation: v } });
      if (!r.ok) return json(res, 200, { ok: false, error: r.error });
      // agy trả ok:false kèm rejected[] khi giá trị bị từ chối — phải kiểm, không tin mỗi HTTP 200
      const d = r.data || {};
      if (d.rejected && d.rejected.length) {
        return json(res, 200, { ok: false, error: 'agy từ chối: ' + JSON.stringify(d.rejected).slice(0, 200) });
      }
      // agy có thể trả HTTP 200 kèm ok:false mà KHÔNG có rejected — chỉ nhìn rejected
      // thì giao diện báo đổi thành công trong khi thực tế chưa đổi gì.
      if (d.ok === false) {
        return json(res, 200, { ok: false, error: 'agy không áp dụng được chiến lược này' });
      }
      return json(res, 200, { ok: true, rotation: v });
    }
    return json(res, 400, { ok: false, error: 'lệnh không được phép: ' + act });
  }

  // ---- AGY-PROXY: status / log / config / control (gọi CLI, không tự implement proxy) ----
  if (p === '/api/agy/status' && req.method === 'GET') {
    return json(res, 200, await getAgyStatus());
  }
  if (p === '/api/agy/log' && req.method === 'GET') {
    const since = Math.max(0, +(url.searchParams.get('since') || 0) || 0);
    const from = Math.max(0, since - agyLogStart);
    return json(res, 200, { next: agyLogStart + agyLogBuf.length, lines: agyLogBuf.slice(from) });
  }
  if (p === '/api/agy/config' && req.method === 'GET') {
    const env = readAgyEnv();
    const fields = Object.entries(AGY_EDIT_KEYS).map(([key, s]) => ({ key, value: env[key] != null ? env[key] : '', desc: s.desc }));
    return json(res, 200, { file: AGY_ENV, fields });
  }
  if (p === '/api/agy/config' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const key = String(body.key || '');
    const value = String(body.value == null ? '' : body.value).trim();
    const spec = AGY_EDIT_KEYS[key];
    if (!spec) return json(res, 400, { error: 'key không cho phép edit: ' + key });
    if (/[\r\n]/.test(value) || !spec.check(value)) return json(res, 400, { error: 'giá trị không hợp lệ cho ' + key });
    try { writeAgyEnv(key, value); } catch (e) { return json(res, 500, { error: e.message }); }
    return json(res, 200, { ok: true, restart: key === 'PORT' || key === 'HOST' });
  }
  // start/stop/restart/run: vẫn đọc body JSON (bắt buộc Content-Type JSON -> chống CSRF như các POST khác)
  if (/^\/api\/agy\/(start|stop|restart|run)$/.test(p) && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    let r;
    if (p === '/api/agy/start') r = agyStartDev();
    else if (p === '/api/agy/stop') r = agyStopDev();
    else if (p === '/api/agy/restart') {
      if (agyDev) {
        agyStopDev();
        setTimeout(() => agyStartDev(), 1500); // đợi process group cũ thoát rồi mới start lại
        r = { ok: true, restarting: true };
      } else r = agyStartDev();
    } else r = agyRun(String(body.cmd || ''));
    return json(res, r.error ? 409 : 200, r);
  }

  // ---- Web Push: vapid key + subscribe/unsubscribe + gửi test ----
  if (p === '/api/push/vapid') return json(res, 200, { key: pushState.publicKey });
  if (p === '/api/push/subscribe' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const sub = body && body.endpoint ? body : (body.subscription || {});
    if (!sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return json(res, 400, { error: 'subscription không hợp lệ (cần endpoint + keys.p256dh + keys.auth)' });
    }
    removeSub(sub.endpoint); // upsert theo endpoint
    pushState.subs.push({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      ua: String(req.headers['user-agent'] || '').slice(0, 120),
      at: Date.now(),
    });
    savePushState();
    return json(res, 200, { ok: true, subs: pushState.subs.length });
  }
  if (p === '/api/push/unsubscribe' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    removeSub(String(body.endpoint || ''));
    return json(res, 200, { ok: true, subs: pushState.subs.length });
  }
  if (p === '/api/push/send' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad json' }); }
    const r = await pushAll({
      title: (body.title || 'Claude Control Center').slice(0, 100),
      body: (body.body || 'Test notification').slice(0, 500),
      tag: body.tag || 'ccc-test',
      url: '/',
    });
    return json(res, 200, { ok: true, ...r });
  }

  json(res, 404, { error: 'not found' });
});

/* ---------------- PWA assets ---------------- */

// Icon mới: Lucide "terminal" màu accent trên nền tối bo góc
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="116" fill="#0f1117"/>
<rect x="14" y="14" width="484" height="484" rx="104" fill="none" stroke="#262a36" stroke-width="8"/>
<g fill="none" stroke="#3b82f6" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">
<polyline points="128,340 226,248 128,156"/>
<line x1="262" y1="366" x2="390" y2="366"/>
</g>
</svg>`;

// Manifest để "Add to Home Screen" chạy standalone như app native
const MANIFEST = JSON.stringify({
  name: 'Claude Control',
  short_name: 'Control',
  display: 'standalone',
  // iOS standalone: env(safe-area-inset-bottom) chỉ đúng khi viewport-fit=cover ở cả manifest lẫn meta viewport
  viewport: { 'viewport-fit': 'cover' },
  background_color: '#0f1117',
  theme_color: '#0f1117',
  start_url: '/',
  scope: '/',
  lang: 'vi',
  categories: ['productivity', 'developer'],
  // PNG là bắt buộc: iOS bỏ qua icon SVG khi "Thêm vào Màn hình chính".
  // maskable có lề an toàn 10% để Android cắt tròn/squircle không cụt dấu nhắc.
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
  shortcuts: [
    { name: 'Giao task mới', url: '/?tab=cli', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    { name: 'Agy Proxy', url: '/?tab=agy', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
  ],
});

// Service worker: network-only (đủ điều kiện PWA) + Web Push nhận notification thật
const SW_JS = `var SHELL = 'ccc-shell-v2';
var SHELL_URLS = ['/', '/manifest.json', '/icon.svg'];
// Tài nguyên Next (/_next/static/...) đặt tên theo hash nội dung nên KHÔNG liệt kê cứng
// được — cache khi tải lần đầu. Thiếu chúng thì offline chỉ ra vỏ trắng vì mất JS bundle.
function isShellUrl(pathname) {
  return SHELL_URLS.indexOf(pathname) >= 0
    || pathname.indexOf('/_next/static/') === 0
    || /^\\/js\\/[a-z-]+\\.js$/.test(pathname)
    || pathname === '/app.css';
}

self.addEventListener('install', function (e) {
  self.skipWaiting();
  // nạp sẵn vỏ app để mất mạng vẫn mở được (trước đây trắng màn hình)
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(SHELL_URLS); }).catch(function () {}));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k !== SHELL; })
        .map(function (k) { return caches.delete(k); }));
    }),
  ]));
});
// Chỉ cache VỎ app. TUYỆT ĐỐI không cache /api/* — dashboard mà hiện dữ liệu cũ
// tưởng là mới thì còn tệ hơn báo lỗi mất mạng.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/stream') return;
  if (!isShellUrl(url.pathname)) return;
  // mạng trước (luôn có bản mới nhất), hỏng thì lấy cache
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || new Response('offline', { status: 503 });
      });
    })
  );
});

// Push từ server: chỉ hiện system notification khi KHÔNG có tab nào visible —
// tab đang mở thì toast/beep local đã lo, tránh notification trùng.
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data && e.data.text() }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var visible = list.some(function (c) { return c.visibilityState === 'visible'; });
    if (visible) return;
    return self.registration.showNotification(data.title || 'Claude Control Center', {
      body: data.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.tag || 'ccc-push',
      data: { url: data.url || '/', sid: data.sid || null },
    });
  }));
});

// Tap notification: focus tab đang có, không có thì mở tab mới
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { if ('focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || '/');
  }));
});
`;

/* ---------------- frontend ---------------- */
// LƯU Ý: template literal — client JS bên trong KHÔNG dùng backtick / ${ ;
// backslash phải escape đôi (\\n, \\s, \\u0000).


server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} đang bận (dashboard khác đang chạy?). Đổi port: PORT=7800 node claude-dashboard.js`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`claude-dashboard listening on http://localhost:${PORT}`);
  console.log(`  mã truy cập: ${dashToken}`);
  console.log(`  mở nhanh trên máy khác: http://<ip>:${PORT}/?t=${dashToken}`);
  /* Làm mới repo/nhánh mỗi 10 phút: người ta đổi nhánh khi đang làm việc, mà cache
     không hết hạn thì đầu nhóm dự án hiện nhánh cũ mãi. unref() để tiến trình vẫn
     thoát được bình thường (test khởi động server rồi kill). */
  setInterval(() => { napGit([...gitCache.keys()]); }, 10 * 60 * 1000).unref();
});
