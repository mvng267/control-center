/* ================= chat view: STABLE RENDER (append-only) ================= */
let chatRendered = 0; // số bubble đã render cho session đang mở
let chatTotal = 0;    // tổng messages trong history lần fetch cuối
let chatStart = -1;   // chỉ số tuyệt đối của bubble đầu tiên đang render (-1 = chưa render gì)
let chatCards = new Map(); // tool_use_id -> {card, chip, status} để cập nhật chip khi tool xong
let chatLastN = 0;    // số message đã gộp vào lượt CUỐI (lượt đang chạy còn phình thêm)
let reopenTids = [];  // card đang mở, cần mở lại sau khi buộc phải vẽ lại

// Parse markdown an toàn: marked (render) + DOMPurify (sanitize chống XSS).
// Fallback textContent nếu CDN chưa load — không bao giờ vỡ render.
function mdToNode(text) {
  var div = document.createElement('div');
  div.className = 'md';
  if (window.marked && window.DOMPurify) {
    var html = marked.parse(text, { breaks: true, gfm: true });
    div.innerHTML = DOMPurify.sanitize(html);
    // link mở tab mới, không leak opener
    div.querySelectorAll('a').forEach(function (a) { a.target = '_blank'; a.rel = 'noopener'; });
  } else {
    div.textContent = text; // CDN offline -> hiện raw, vẫn an toàn
  }
  return div;
}

// Render nội dung message: tách code block (triple-backtick) trước — giữ nút Copy,
// phần text còn lại parse markdown. Dùng chung cho chat Claude CLI + Hermes.
function renderContent(el, content) {
  var FENCE = String.fromCharCode(96, 96, 96);
  var NL = String.fromCharCode(10);
  var parts = content.split(FENCE);
  for (var i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // text thường -> markdown (heading/bold/list/inline-code/link/blockquote...)
      if (parts[i].trim()) el.appendChild(mdToNode(parts[i]));
      continue;
    }
    var seg = parts[i];
    var j = seg.indexOf(NL);
    var lang = '', code = seg;
    if (j >= 0 && j <= 20) { lang = seg.slice(0, j).trim(); code = seg.slice(j + 1); }
    var wrap = document.createElement('div');
    wrap.className = 'codewrap';
    if (lang) {
      var lg = document.createElement('div');
      lg.className = 'codelang';
      lg.textContent = lang;
      wrap.appendChild(lg);
    }
    var btn = document.createElement('button');
    btn.className = 'copybtn';
    btn.innerHTML = ICON_COPY + '<span>Copy</span>';
    (function (c, b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        navigator.clipboard.writeText(c).then(function () {
          b.querySelector('span').textContent = 'Copied!';
          setTimeout(function () { b.querySelector('span').textContent = 'Copy'; }, 1200);
        });
      };
    })(code, btn);
    var pre = document.createElement('pre');
    pre.className = 'codeblock';
    pre.textContent = code;
    wrap.appendChild(btn);
    wrap.appendChild(pre);
    el.appendChild(wrap);
  }
}

/* ---------------- tool card ----------------
   SVG inline (không dùng data-lucide): node động không được gọi lại lucide.createIcons() */
const SVG_A = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const TICON = {
  Bash: SVG_A + '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>',
  Read: SVG_A + '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
  Edit: SVG_A + '<path d="M12 22h6a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v10"/><path d="M14 2v5h5"/><path d="M10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4Z"/></svg>',
  Write: SVG_A + '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h5"/><path d="M9 15h6"/><path d="M12 12v6"/></svg>',
  Grep: SVG_A + '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  Task: SVG_A + '<rect width="18" height="10" x="3" y="11" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" x2="8" y1="16" y2="16"/><line x1="16" x2="16" y1="16" y2="16"/></svg>',
  TodoWrite: SVG_A + '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>',
  Web: SVG_A + '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
  Skill: SVG_A + '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>',
  mcp: SVG_A + '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>',
  def: SVG_A + '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg>',
};
const ICON_CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_OK = SVG_A + '<path d="M20 6 9 17l-5-5"/></svg>';
const ICON_ERR = SVG_A + '<path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const ICON_RUN = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>';
const ICON_THINK = SVG_A + '<path d="M12 3a6 6 0 0 0-4 10.5V16a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.5A6 6 0 0 0 12 3Z"/><path d="M10 21h4"/></svg>';
const ICON_STOP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
// SVG thay vì <i data-lucide>: nút này đổi qua lại gửi/dừng, Lucide chỉ thay icon 1 lần lúc load
const ICON_SEND = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
const ICON_DASH = SVG_A + '<path d="M5 12h14"/></svg>';

function toolIcon(name) {
  const n = String(name || '');
  if (n.startsWith('mcp__')) return TICON.mcp;
  if (TICON[n]) return TICON[n];
  if (n === 'MultiEdit' || n === 'NotebookEdit') return TICON.Edit;
  if (n === 'Glob' || n === 'ToolSearch') return TICON.Grep;
  if (n === 'Agent') return TICON.Task;
  if (n === 'WebFetch' || n === 'WebSearch') return TICON.Web;
  if (n === 'BashOutput' || n === 'KillShell') return TICON.Bash;
  return TICON.def;
}

function statusIcon(st) {
  if (st === 'ok') return { html: ICON_OK, cls: 'tcard-st-ok', tip: 'Thành công' };
  if (st === 'error') return { html: ICON_ERR, cls: 'tcard-st-err', tip: 'Lỗi' };
  if (st === 'running') return { html: ICON_RUN, cls: 'tcard-st-run', tip: 'Đang chạy…' };
  // pending: session đã dừng mà tool chưa có kết quả (bị kill / ngắt giữa chừng)
  return { html: ICON_DASH, cls: 'tcard-st-pend', tip: 'Không có kết quả (bị ngắt)' };
}

// Ngôn ngữ theo đuôi file -> nhãn code block ("ts", "py"...) cho dễ nhận ra
const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', html: 'html', css: 'css',
  scss: 'scss', sql: 'sql', md: 'markdown', txt: '', log: '',
};
function langOf(p) {
  const f = String((p && p.summary) || '').split(' ')[0].split(':')[0];
  const ext = f.indexOf('.') > 0 ? f.split('.').pop().toLowerCase() : '';
  return EXT_LANG[ext] || '';
}

// Text dài mà không phải code -> có xuống dòng mềm, dễ đọc hơn <pre> cuộn ngang
function looksLikeProse(t) {
  if (!t) return false;
  // dùng fromCharCode(10): backslash-n trong template literal của server bị nuốt thành xuống dòng thật
  const lines = t.split(String.fromCharCode(10));
  if (lines.length > 12) return false;                       // log/list -> giữ pre
  const longLines = lines.filter(l => l.length > 90).length; // câu văn dài -> nên wrap
  const head = lines[0] || '';
  const isStructured = /^[{[<]/.test(head.trim()); // JSON/XML -> giữ dạng code
  return longLines > 0 && !isStructured && t.indexOf('  ') < 0;
}

function copyBtnFor(text) {
  const btn = document.createElement('button');
  btn.className = 'copybtn';
  btn.innerHTML = ICON_COPY + '<span>Copy</span>';
  btn.onclick = function (ev) {
    ev.stopPropagation(); // đừng để click Copy làm gập card
    navigator.clipboard.writeText(text).then(function () {
      btn.querySelector('span').textContent = 'Copied!';
      setTimeout(function () { btn.querySelector('span').textContent = 'Copy'; }, 1200);
    });
  };
  return btn;
}

// Diff của Edit: tô xanh dòng thêm / đỏ dòng bớt thay vì một khối chữ xám phẳng
function renderDiff(text) {
  const pre = document.createElement('pre');
  pre.className = 'codeblock diffblock';
  let mode = '';
  for (const line of text.split(String.fromCharCode(10))) {
    if (line === '--- old') { mode = 'del'; appendDiffHead(pre, 'Trước', 'del'); continue; }
    if (line === '+++ new') { mode = 'add'; appendDiffHead(pre, 'Sau', 'add'); continue; }
    const row = document.createElement('div');
    row.className = 'dline' + (mode ? ' d-' + mode : '');
    row.textContent = line;
    pre.appendChild(row);
  }
  return pre;
}
function appendDiffHead(pre, label, cls) {
  const h = document.createElement('div');
  h.className = 'dhead d-' + cls;
  h.textContent = label;
  pre.appendChild(h);
}

// 1 section (Input / Result) trong body card
function toolSection(label, text, isErr, opts) {
  opts = opts || {};
  const sec = document.createElement('div');
  sec.className = 'tsec' + (isErr ? ' tsec-err' : '');
  const lb = document.createElement('div');
  lb.className = 'tlbl';
  lb.textContent = label;
  if (opts.lang) {
    const tag = document.createElement('span');
    tag.className = 'tlang';
    tag.textContent = opts.lang;
    lb.appendChild(tag);
  }
  sec.appendChild(lb);
  const wrap = document.createElement('div');
  wrap.className = 'codewrap';
  wrap.appendChild(copyBtnFor(text));
  if (opts.diff) {
    wrap.appendChild(renderDiff(text));
  } else if (opts.prose) {
    // văn bản thường (câu chữ) -> markdown + wrap, không phải khối code cuộn ngang
    const box = document.createElement('div');
    box.className = 'codeblock proseblock';
    box.appendChild(mdToNode(text));
    wrap.appendChild(box);
  } else {
    const pre = document.createElement('pre');
    pre.className = 'codeblock';
    pre.textContent = text;
    wrap.appendChild(pre);
  }
  sec.appendChild(wrap);
  return sec;
}

// Ảnh trong tool_result (screenshot...) -> render <img> THẬT, lazy, tap để phóng to
function toolImages(part) {
  const sec = document.createElement('div');
  sec.className = 'tsec';
  const lb = document.createElement('div');
  lb.className = 'tlbl';
  lb.textContent = part.images.length > 1 ? part.images.length + ' ẢNH' : 'ẢNH';
  sec.appendChild(lb);
  const grid = document.createElement('div');
  grid.className = 'timgs';
  part.images.forEach(function (im, idx) {
    const url = '/api/toolimg/' + currentSid + '/' + part.id + '/' + idx;
    const fig = document.createElement('button');
    fig.type = 'button';
    fig.className = 'timgbtn';
    fig.title = 'Bấm để xem full';
    const img = document.createElement('img');
    img.loading = 'lazy';            // chỉ tải khi cuộn tới — ảnh ~100KB/tấm
    img.decoding = 'async';
    img.src = url;
    img.alt = 'ảnh kết quả ' + (idx + 1);
    img.onerror = function () { fig.classList.add('timg-fail'); fig.textContent = 'Không tải được ảnh'; };
    fig.appendChild(img);
    fig.onclick = function (ev) { ev.stopPropagation(); openImageOverlay(url); };
    grid.appendChild(fig);
  });
  sec.appendChild(grid);
  return sec;
}

// Xem ảnh full màn hình: tap nền / Esc để đóng
function openImageOverlay(url) {
  const ov = document.createElement('div');
  ov.className = 'imgov fadein';
  const img = document.createElement('img');
  img.src = url;
  ov.appendChild(img);
  const close = function () { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  ov.onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.appendChild(ov);
}

// Dựng nội dung body — LAZY, chỉ chạy lần mở đầu tiên (30 msg x N tool mà dựng sẵn hết thì phí)
function buildToolBody(card) {
  const inner = card.querySelector('.tinner');
  inner.innerHTML = '';
  const p = card._part;
  // TodoWrite -> checklist thật thay vì JSON thô
  if (p.todos && p.todos.length) {
    inner.appendChild(renderTodoList(p.todos));
    card._built = true;
    return;
  }
  const isDiff = p.name === 'Edit' && p.input && p.input.indexOf('--- old') === 0;
  if (p.input) {
    inner.appendChild(toolSection(isDiff ? 'THAY ĐỔI' : 'INPUT', p.input, false, {
      diff: isDiff,
      lang: isDiff ? '' : langOf(p),
    }));
  }
  const isErr = p.status === 'error';
  const hasResult = p.result || p.status === 'ok' || isErr;
  if (hasResult) {
    const txt = p.result || '(trống)';
    const sec = toolSection(isErr ? 'LỖI' : 'KẾT QUẢ', txt, isErr, {
      prose: !isErr && looksLikeProse(txt),
      lang: p.name === 'Read' ? langOf(p) : '',
    });
    sec.dataset.role = 'result';
    inner.appendChild(sec);
  }
  if (p.images && p.images.length) inner.appendChild(toolImages(p));
  card._built = true;
}

/* Phần suy nghĩ của Claude: mặc định thu gọn (không chiếm chỗ), bấm để mở.
   Claude CLI có hiện phần này; dashboard trước đây vứt hoàn toàn. */
function renderThinkCard(part) {
  const card = document.createElement('div');
  card.className = 'thinkcard fadein';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'think-head';
  head.setAttribute('aria-expanded', 'false');
  const ic = document.createElement('span');
  ic.className = 'think-ic';
  ic.innerHTML = ICON_THINK;
  const lb = document.createElement('span');
  lb.className = 'think-lbl';
  lb.textContent = 'Suy nghĩ';
  // trích 1 dòng đầu làm mồi, để đóng vẫn đoán được nội dung
  const peek = document.createElement('span');
  peek.className = 'think-peek';
  // KHÔNG dùng regex \s ở đây: template literal của server nuốt backslash -> /s+/ (thay chữ "s")
  peek.textContent = part.text.split(String.fromCharCode(10)).join(' ').slice(0, 90);
  const chev = document.createElement('span');
  chev.className = 'tcard-chev';
  chev.innerHTML = ICON_CHEV;
  head.appendChild(ic); head.appendChild(lb); head.appendChild(peek); head.appendChild(chev);

  const body = document.createElement('div');
  body.className = 'tcard-body';
  const inner = document.createElement('div');
  inner.className = 'tinner think-body';
  body.appendChild(inner);
  head.onclick = () => {
    const open = card.classList.toggle('open');
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && !card._built) { inner.appendChild(mdToNode(part.text)); card._built = true; }
  };
  card.appendChild(head);
  card.appendChild(body);
  return card;
}

/* Checklist TodoWrite: hiện việc thật + tiến độ, thay vì đổ JSON thô ra khối code */
function renderTodoList(todos) {
  const box = document.createElement('div');
  box.className = 'tsec todobox';
  const done = todos.filter(t => t.status === 'completed').length;
  const head = document.createElement('div');
  head.className = 'todohead';
  const lb = document.createElement('span');
  lb.className = 'tlbl';
  lb.textContent = 'CÔNG VIỆC';
  const cnt = document.createElement('span');
  cnt.className = 'todocount';
  cnt.textContent = done + '/' + todos.length;
  head.appendChild(lb); head.appendChild(cnt);
  box.appendChild(head);
  const bar = document.createElement('div');
  bar.className = 'todobar';
  const fill = document.createElement('span');
  fill.style.width = (todos.length ? done / todos.length * 100 : 0) + '%';
  bar.appendChild(fill);
  box.appendChild(bar);
  const list = document.createElement('div');
  list.className = 'todolist';
  for (const t of todos) {
    const row = document.createElement('div');
    row.className = 'todoitem td-' + t.status;
    const mark = document.createElement('span');
    mark.className = 'todomark';
    mark.innerHTML = t.status === 'completed' ? ICON_OK : (t.status === 'in_progress' ? ICON_RUN : '');
    const tx = document.createElement('span');
    tx.className = 'todotext';
    tx.textContent = t.text;
    row.appendChild(mark); row.appendChild(tx);
    list.appendChild(row);
  }
  box.appendChild(list);
  return box;
}

function renderToolCard(part) {
  const card = document.createElement('div');
  card._part = part;
  card.className = 'tcard fadein' + (part.status === 'error' ? ' t-err' : part.status === 'running' ? ' t-run' : '');
  if (part.id) card.dataset.tid = part.id;

  const head = document.createElement('button');
  head.className = 'tcard-head';
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');

  const ic = document.createElement('span');
  ic.className = 'tcard-ic';
  ic.innerHTML = toolIcon(part.name);
  const nm = document.createElement('span');
  nm.className = 'tcard-name';
  nm.textContent = part.disp || part.name;
  const sum = document.createElement('span');
  sum.className = 'tcard-sum';
  sum.textContent = part.summary || '';
  // summary bị ellipsis trên mobile -> giữ bản đầy đủ ở title (hover desktop / long-press)
  if (part.summary) sum.title = part.summary;
  nm.title = part.name; // tên MCP rút gọn -> title giữ tên gốc đầy đủ
  const si = statusIcon(part.status);
  const st = document.createElement('span');
  st.className = 'tcard-st ' + si.cls;
  st.innerHTML = si.html;
  st.title = si.tip;
  const chev = document.createElement('span');
  chev.className = 'tcard-chev';
  chev.innerHTML = ICON_CHEV;
  head.appendChild(ic); head.appendChild(nm); head.appendChild(sum); head.appendChild(st); head.appendChild(chev);

  const body = document.createElement('div');
  body.className = 'tcard-body';
  const inner = document.createElement('div');
  inner.className = 'tinner';
  body.appendChild(inner);

  head.onclick = function () {
    const opening = !card.classList.contains('open');
    if (opening && !card._built) buildToolBody(card);
    card.classList.toggle('open', opening);
    head.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (navigator.vibrate) navigator.vibrate(10); // phản hồi chạm nhẹ như app native
  };

  card.appendChild(head);
  card.appendChild(body);
  // đăng ký để reconcileToolStatus cập nhật chip khi tool chạy xong (pending/running -> ok/error).
  // Compare view cũng dùng bubbleFor nhưng không reconcile -> không đăng ký, tránh Map phình.
  if (part.id && !compareSids) chatCards.set(part.id, { card: card, chip: st, status: part.status });
  return card;
}

/* ---- thời gian kiểu app chat: giờ dưới bubble + vạch ngăn ngày ---- */
function fmtClock(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function dayKey(ts) {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function fmtDay(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const today = new Date();
  const y = new Date(today.getTime() - 86400000);
  if (dayKey(d) === dayKey(today)) return 'Hôm nay';
  if (dayKey(d) === dayKey(y)) return 'Hôm qua';
  return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
}
function dayDivider(ts) {
  const div = document.createElement('div');
  div.className = 'daydiv';
  const s = document.createElement('span');
  s.textContent = fmtDay(ts);
  div.appendChild(s);
  return div;
}
// giờ + trạng thái, đặt dưới bubble như Telegram/iMessage
function metaLine(msg, align) {
  const meta = document.createElement('div');
  meta.className = 'bmeta' + (align === 'right' ? ' bmeta-r' : '');
  const t = document.createElement('span');
  t.textContent = fmtClock(msg.ts);
  meta.appendChild(t);
  if (msg.parts) {
    const tools = msg.parts.filter(p => p.t === 'tool');
    if (tools.length) {
      const nErr = tools.filter(p => p.status === 'error').length;
      const nRun = tools.filter(p => p.status === 'running').length;
      const s = document.createElement('span');
      s.className = 'bmeta-tools' + (nErr ? ' bmeta-err' : nRun ? ' bmeta-run' : '');
      s.textContent = nRun ? tools.length + ' tool · đang chạy'
        : nErr ? tools.length + ' tool · ' + nErr + ' lỗi'
        : tools.length + ' tool';
      meta.appendChild(s);
    }
  }
  return meta;
}

function bubbleFor(msg) {
  // 'think' cũng phải đi nhánh parts: msg.content không chứa thinking (flattenParts bỏ nó)
  const hasTool = msg.parts && msg.parts.some(p => p.t === 'tool' || p.t === 'think');
  const w = document.createElement('div');
  w.className = 'msgwrap fadein' + (msg.role === 'user' ? ' mw-user' : '');
  if (!hasTool) {
    const b = document.createElement('div');
    const cls = msg.role === 'user' ? 'bub-user' : msg.role === 'tool' ? 'bub-tool' : 'bub-assistant';
    b.className = 'bub ' + cls;
    renderContent(b, msg.content);
    w.appendChild(b);
  } else {
    // message có tool: text bubble + card xếp dọc trong 1 wrapper
    for (const p of mergeTextParts(msg.parts)) {
      if (p.t === 'text') {
        if (!p.text || !p.text.trim()) continue;
        const b = document.createElement('div');
        b.className = 'bub ' + (msg.role === 'user' ? 'bub-user' : 'bub-assistant');
        renderContent(b, p.text);
        w.appendChild(b);
      } else if (p.t === 'think') {
        w.appendChild(renderThinkCard(p));
      } else {
        w.appendChild(renderToolCard(p));
      }
    }
  }
  if (msg.ts) w.appendChild(metaLine(msg, msg.role === 'user' ? 'right' : 'left'));
  return w;
}

// Gộp các message assistant LIÊN TIẾP trong cùng ~2 phút thành 1 lượt.
// Claude CLI tách mỗi tool_use thành 1 message riêng -> không gộp thì câu văn và tool
// của cùng một lượt bị xé rời, kèm theo hàng loạt dòng "15:18 · 1 tool" lặp lại rất rối.
const GROUP_GAP_MS = 120000;
// 2 đoạn văn liền nhau (không có tool xen giữa) -> 1 bubble liền mạch, không phải 2 bong bóng rời
function mergeTextParts(parts) {
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (p.t === 'text' && prev && prev.t === 'text') {
      const NL = String.fromCharCode(10);
      out[out.length - 1] = { t: 'text', text: prev.text + NL + NL + p.text };
    } else out.push(p);
  }
  return out;
}
function groupMessages(msgs) {
  const out = [];
  for (const m of msgs) {
    const prev = out[out.length - 1];
    const near = prev && prev.ts && m.ts && Math.abs(Date.parse(m.ts) - Date.parse(prev.ts)) < GROUP_GAP_MS;
    if (prev && prev.role === 'assistant' && m.role === 'assistant' && near) {
      prev.parts = mergeTextParts(
        (prev.parts || [{ t: 'text', text: prev.content }]).concat(m.parts || [{ t: 'text', text: m.content }]));
      prev.content = (prev.content ? prev.content + String.fromCharCode(10) : '') + (m.content || '');
      prev.ts = m.ts;   // giờ hiển thị = lúc lượt kết thúc
      prev.n = (prev.n || 1) + 1;
      continue;
    }
    out.push(Object.assign({}, m));
  }
  return out;
}

// Chèn bubble + vạch ngăn ngày khi sang ngày mới (so với bubble trước đó)
let lastDayKey = '';
function appendMessage(box, msg) {
  if (msg.ts) {
    const k = dayKey(msg.ts);
    if (k && k !== lastDayKey) {
      box.appendChild(dayDivider(msg.ts));
      lastDayKey = k;
    }
  }
  box.appendChild(bubbleFor(msg));
}

// Tool chạy xong trong lúc đang xem -> chỉ đổi CHIP + border của card đó, không đụng node khác
// (RULES: diff DOM, chỉ update node thay đổi — rebuild sẽ giết card user đang mở)
function reconcileToolStatus(msgs) {
  for (let i = Math.max(0, msgs.length - 10); i < msgs.length; i++) {
    const parts = msgs[i] && msgs[i].parts;
    if (!parts) continue;
    for (const p of parts) {
      if (p.t !== 'tool' || !p.id) continue;
      const ent = chatCards.get(p.id);
      if (!ent || ent.status === p.status) continue;
      ent.status = p.status;
      ent.card._part = p;
      const si = statusIcon(p.status);
      ent.chip.className = 'tcard-st ' + si.cls;
      ent.chip.innerHTML = si.html;
      ent.chip.title = si.tip;
      ent.card.classList.toggle('t-err', p.status === 'error');
      ent.card.classList.toggle('t-run', p.status === 'running');
      // card đang mở -> dựng lại body cho khớp kết quả mới; đang đóng thì để lazy build lo
      if (ent.card._built) buildToolBody(ent.card);
    }
  }
}

function openChat(sid) {
  switchTab('cli');
  if (compareSids) closeCompare(); // đang ở compare view -> đóng trước khi mở chat
  currentSid = sid;
  chatRendered = 0;
  chatTotal = 0;
  chatStart = -1;
  chatCards = new Map();
  chatLastN = 0;
  reopenTids = [];
  lastDayKey = '';
  delete clearOffsets[sid];
  document.getElementById('list').classList.add('hidden');
  const chat = document.getElementById('chat');
  chat.classList.remove('hidden');
  chat.classList.add('flex');
  // hiện tiêu đề ngay từ danh sách (khỏi chờ fetch), refreshChat sẽ xác nhận lại
  const known = allSessions.find(x => x.sid === sid);
  chatTitle = (known && known.title) || '';
  setText(document.getElementById('chatsid'), chatTitle || sid.slice(0, 8));
  document.getElementById('chatsid').title = sid;
  chatModel = (known && known.model) || null;
  renderChatModel();
  document.getElementById('bubbles').innerHTML = '';
  document.getElementById('typingind').classList.add('hidden');
  document.getElementById('chaterr').classList.add('hidden');
  setChatRunning(false); // phiên mới: nút về trạng thái gửi cho tới khi poll xác nhận
  refreshChat();
  clearInterval(chatTimer);
  chatTimer = setInterval(refreshChat, 2000); // auto-refresh: chỉ APPEND message mới
}

function backToList() {
  currentSid = null;
  clearInterval(chatTimer);
  document.getElementById('chat').classList.add('hidden');
  document.getElementById('chat').classList.remove('flex');
  document.getElementById('list').classList.remove('hidden');
}
