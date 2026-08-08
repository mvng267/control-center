// Biến tool_use/tool_result trong JSONL thành dữ liệu có cấu trúc cho client.
// Trước đây tool bị đè phẳng thành "[tool: Bash]" — mất sạch input, mất is_error,
// mất liên kết call<->result. Giữ nguyên ở dạng parts để client vẽ tool card.
const fs = require("fs");

/* ---------------- JSONL parsing (Claude CLI sessions) ---------------- */

function extractText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => {
      if (typeof b === 'string') return b;
      if (b.type === 'text') return b.text || '';
      if (b.type === 'tool_use') return `[tool: ${b.name}]`;
      if (b.type === 'tool_result') {
        const inner = extractText(b.content);
        return inner ? `[tool result] ${inner.slice(0, 400)}` : '[tool result]';
      }
      if (b.type === 'thinking') return '';
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}
/* ---------------- tool_use / tool_result -> dữ liệu có cấu trúc ----------------
   Trước đây tool bị đè phẳng thành "[tool: Bash]" — mất sạch input, mất is_error,
   mất liên kết call<->result. Giờ giữ nguyên thành `parts` để client render tool card. */

// Cap độ dài — chặn payload phình trên poll 2s qua Tailscale (session dài x nhiều tool)
const TOOL_SUMMARY_CAP = 120;
const TOOL_INPUT_CAP = 1000;
const TOOL_RESULT_CAP = 1200;
const THINK_CAP = 1500; // phần suy nghĩ: hiện đủ ý nhưng không làm phình payload poll 2s

function clampText(s, cap) {
  s = String(s == null ? '' : s);
  return s.length > cap ? s.slice(0, cap) + '\n… (+' + (s.length - cap) + ' chars)' : s;
}

function base(p) { return String(p || '').split('/').filter(Boolean).pop() || String(p || ''); }

// Tên hiển thị: mcp__server__tool -> "server · tool" (tên MCP thô quá dài cho 1 dòng mobile)
function toolDisplayName(name) {
  const n = String(name || 'tool');
  if (n.startsWith('mcp__')) {
    const seg = n.split('__').slice(1).map(s => s.replace(/_/g, ' '));
    return seg.length > 1 ? seg[0] + ' · ' + seg.slice(1).join(' · ') : seg[0] || n;
  }
  return n;
}

// Giá trị string đầu tiên trong input — fallback tóm tắt cho tool lạ / MCP
function firstStringVal(input) {
  for (const k of Object.keys(input)) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

// Tóm tắt 1 dòng hiện trên head của card (luôn ≤ TOOL_SUMMARY_CAP, không xuống dòng)
function summarizeToolInput(name, input) {
  if (input == null || typeof input !== 'object') return '';
  const n = String(name || '');
  let s = '';
  switch (n) {
    case 'Bash':
    case 'BashOutput':
      s = input.description || String(input.command || '').split('\n')[0];
      break;
    case 'Read': {
      s = base(input.file_path);
      if (input.offset != null) s += ':' + input.offset + (input.limit != null ? '-' + (+input.offset + +input.limit) : '');
      break;
    }
    case 'Edit':
      s = base(input.file_path);
      break;
    case 'MultiEdit':
      s = base(input.file_path) + (Array.isArray(input.edits) ? ' · ' + input.edits.length + ' edits' : '');
      break;
    case 'Write':
    case 'NotebookEdit':
      s = base(input.file_path || input.notebook_path) + (typeof input.content === 'string' ? ' · ' + input.content.length + ' chars' : '');
      break;
    case 'Grep':
      s = String(input.pattern || '') + (input.path ? ' in ' + base(input.path) : '');
      break;
    case 'Glob':
      s = String(input.pattern || '');
      break;
    case 'Task':
    case 'Agent':
      s = input.description || String(input.prompt || '').slice(0, 100);
      break;
    case 'TodoWrite': {
      const t = Array.isArray(input.todos) ? input.todos : [];
      s = t.length + ' todos · ' + t.filter(x => x && x.status === 'completed').length + ' done';
      break;
    }
    case 'WebFetch':
      s = String(input.url || '').replace(/^https?:\/\//, '');
      break;
    case 'WebSearch':
      s = String(input.query || '');
      break;
    case 'Skill':
      s = String(input.skill || input.command || '');
      break;
    default:
      s = firstStringVal(input) || JSON.stringify(input).slice(0, 100);
  }
  // URL rất hay là input của MCP/tool lạ — bỏ protocol cho vừa 1 dòng mobile
  return String(s || '').replace(/^https?:\/\//, '').replace(/\s+/g, ' ').trim().slice(0, TOOL_SUMMARY_CAP);
}

// Chi tiết input hiện khi mở card
// TodoWrite -> [{text, status}] gọn nhẹ cho client vẽ checklist.
// Cắt 40 việc: danh sách dài hơn thế thì màn hình cũng không xem nổi.
function extractTodos(input) {
  const raw = input && Array.isArray(input.todos) ? input.todos : [];
  return raw.slice(0, 40).map(t => ({
    text: String((t && (t.content || t.activeForm)) || '').slice(0, 160),
    status: (t && t.status) || 'pending',
  })).filter(t => t.text);
}

function buildInputDetail(name, input) {
  if (input == null || typeof input !== 'object') return '';
  let s;
  switch (String(name || '')) {
    case 'Bash':
      s = input.command || '';
      break;
    case 'Edit':
      s = '--- old\n' + (input.old_string || '') + '\n+++ new\n' + (input.new_string || '');
      break;
    case 'Write':
      s = input.content || '';
      break;
    default:
      try { s = JSON.stringify(input, null, 2); } catch { s = String(input); }
  }
  return clampText(s, TOOL_INPUT_CAP);
}

// tool_result.content: string HOẶC mảng block {type:'text'|'image'} -> nối text, GIỮ ảnh.
// Ảnh base64 ~100KB/tấm: KHÔNG nhồi vào payload poll 2s -> chỉ trả metadata + media_type,
// client tải riêng qua /api/toolimg khi thật sự cần hiển thị.
function toolResultPreview(content) {
  let text = '', images = [];
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const buf = [];
    for (const b of content) {
      if (typeof b === 'string') buf.push(b);
      else if (!b) continue;
      else if (b.type === 'text') buf.push(b.text || '');
      else if (b.type === 'image') {
        const src = b.source || {};
        images.push({ i: images.length, mt: src.media_type || 'image/png', bytes: (src.data || '').length });
      }
    }
    text = buf.filter(Boolean).join('\n');
  }
  return { text: clampText(text, TOOL_RESULT_CAP), images };
}

// Lấy base64 ảnh thứ idx của 1 tool_result — đọc lại file, KHÔNG cache trong parse
// (giữ payload history nhẹ; ảnh chỉ tải khi user mở card ra xem)
function findToolImage(file, toolId, idx) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.indexOf(toolId) < 0) continue; // lọc nhanh trước khi parse
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const c = (obj.message || obj).content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (!b || b.type !== 'tool_result' || b.tool_use_id !== toolId) continue;
      if (!Array.isArray(b.content)) continue;
      let n = 0;
      for (const x of b.content) {
        if (!x || x.type !== 'image') continue;
        if (n === idx) {
          const src = x.source || {};
          if (!src.data) return null;
          return { mt: src.media_type || 'image/png', buf: Buffer.from(src.data, 'base64') };
        }
        n++;
      }
    }
  }
  return null;
}

// Chuỗi phẳng dựng lại từ parts — giữ y hệt format cũ để stats/unread/export cũ không đổi
function flattenParts(parts) {
  // 'think' KHÔNG vào chuỗi phẳng: nó chỉ để hiển thị, đưa vào sẽ làm lệch unread/stats/search cũ
  return parts.map(p => (p.t === 'text' ? p.text : p.t === 'think' ? '' : '[tool: ' + p.name + ']'))
    .filter(Boolean).join('\n');
}

const TOOL_ST_LABEL = { ok: 'OK', error: 'ERROR', running: 'RUNNING', pending: 'PENDING' };

// Markdown 1 message cho export .md — tool thành blockquote header + fence input/result.
// Dùng chung shape với exportChat phía client để 2 kiểu export ra giống nhau.
function mdForMessage(msg) {
  if (!msg.parts || !msg.parts.length) return msg.content || '';
  return msg.parts.map(p => {
    if (p.t === 'text') return p.text;
    if (p.t === 'think') return '> 💭 _Suy nghĩ:_ ' + p.text.replace(/\n/g, '\n> ');
    if (p.t === 'tool' && p.todos && p.todos.length) {
      return '> ✅ **Todos**\n\n' + p.todos.map(t =>
        '- [' + (t.status === 'completed' ? 'x' : ' ') + '] ' + t.text
        + (t.status === 'in_progress' ? ' _(đang làm)_' : '')).join('\n');
    }
    let s = '> 🔧 **' + p.disp + '**' + (p.summary ? ' — `' + p.summary + '`' : '')
      + ' — ' + (TOOL_ST_LABEL[p.status] || p.status);
    if (p.input) s += '\n\n```input\n' + p.input + '\n```';
    if (p.result) s += '\n\n```result\n' + p.result + '\n```';
    if (p.images && p.images.length) s += '\n\n_[' + p.images.length + ' ảnh]_';
    return s;
  }).filter(Boolean).join('\n\n');
}

module.exports = {
  extractText, clampText, base, toolDisplayName, summarizeToolInput, extractTodos,
  buildInputDetail, toolResultPreview, findToolImage, flattenParts, mdForMessage,
  TOOL_SUMMARY_CAP, TOOL_INPUT_CAP, TOOL_RESULT_CAP, THINK_CAP, TOOL_ST_LABEL,
};
