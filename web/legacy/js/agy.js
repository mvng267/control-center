/* ================= TAB AGY-PROXY: gọi CLI qua server, log realtime ================= */
let agyStatusTimer = null, agyLogTimer = null;
let agyLogNext = 0;       // absolute index dòng log tiếp theo cần fetch
let agyLogEmpty = true;   // còn placeholder trong panel log
let agyCfgLoaded = false; // config editor chỉ build 1 lần

function agyEnter() {
  refreshAgyStatus();
  pollAgyLog();
  if (!agyCfgLoaded) loadAgyConfig();
  clearInterval(agyStatusTimer);
  agyStatusTimer = setInterval(refreshAgyStatus, 3000);
  clearInterval(agyLogTimer);
  agyLogTimer = setInterval(pollAgyLog, 2000);
}
function agyLeave() {
  clearInterval(agyStatusTimer);
  clearInterval(agyLogTimer);
  agyStatusTimer = agyLogTimer = null;
}

function agyChip(el, name, rec, running) {
  var label = name.toUpperCase() + ': ';
  var cls = 'agychip';
  if (running) { label += 'RUNNING'; cls += ' run'; }
  else if (!rec) { label += '—'; }
  else { label += (rec.ok ? 'PASS' : 'FAIL') + ' · ' + ago(rec.at); cls += rec.ok ? ' ok' : ' fail'; }
  setText(el, label);
  if (el.className !== cls) el.className = cls;
}

// nhãn tiếng Việt cho trạng thái tài khoản
const ACC_LABEL = { ok: 'hoạt động', new: 'chưa dùng', needs_human: 'cần xử lý', failed: 'lỗi', unknown: 'không rõ' };
const ACC_ORDER = ['ok', 'new', 'needs_human', 'failed', 'unknown'];

function renderAccBar(acc) {
  const bar = document.getElementById('agy-accbar');
  const lg = document.getElementById('agy-acclegend');
  const total = acc.total || 0;
  const keys = ACC_ORDER.filter(k => acc.status[k]).concat(
    Object.keys(acc.status).filter(k => ACC_ORDER.indexOf(k) < 0));
  const sig = JSON.stringify([total, acc.status]);
  if (bar.dataset.sig === sig) return; // không đổi -> khỏi đụng DOM
  bar.dataset.sig = sig;
  bar.innerHTML = '';
  lg.innerHTML = '';
  for (const k of keys) {
    const n = acc.status[k];
    const seg = document.createElement('span');
    seg.className = 'acc-' + k;
    seg.style.width = (total ? (n / total * 100) : 0) + '%';
    seg.title = (ACC_LABEL[k] || k) + ': ' + n;
    bar.appendChild(seg);
    const item = document.createElement('span');
    item.className = 'acclg';
    const dot = document.createElement('i');
    dot.className = 'acc-' + k;
    const tx = document.createElement('span');
    tx.textContent = n + ' ' + (ACC_LABEL[k] || k);
    item.appendChild(dot); item.appendChild(tx);
    lg.appendChild(item);
  }
}

// 16814671 -> "16.8M"; 1317 -> "1.3k"
function shortNum(n) {
  n = +n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
// mã lỗi HTTP -> nói bằng tiếng người
const CODE_LABEL = {
  429: 'vượt hạn mức', 503: 'nhà cung cấp quá tải', 500: 'lỗi máy chủ',
  400: 'request sai', 401: 'sai khoá', 402: 'hết tiền', 404: 'không thấy model', 408: 'quá hạn chờ',
};

function renderAgyUsage(u) {
  const box = document.getElementById('agy-usagebox');
  if (!u || !u.ok) { box.classList.add('hidden'); return; } // không đọc được DB -> ẩn hẳn
  box.classList.remove('hidden');
  const sig = JSON.stringify(u);
  if (box.dataset.sig === sig) return; // số liệu chưa đổi -> khỏi đụng DOM
  box.dataset.sig = sig;

  const errPct = u.reqs ? Math.round(u.errs / u.reqs * 100) : 0;
  setText(document.getElementById('agy-u-reqs'), shortNum(u.reqs));
  const eEl = document.getElementById('agy-u-errs');
  setText(eEl, u.errs ? shortNum(u.errs) + ' (' + errPct + '%)' : '0');
  eEl.className = 'ustat-n' + (errPct >= 20 ? ' warn' : ''); // lỗi nhiều -> tô đỏ
  setText(document.getElementById('agy-u-tok'), shortNum(u.tokens));
  setText(document.getElementById('agy-u-avg'), u.avgMs ? 'trễ trung bình ' + (u.avgMs / 1000).toFixed(1) + 's' : '');

  // cảnh báo khi tỉ lệ lỗi cao — nói rõ nguyên nhân chính
  const alert = document.getElementById('agy-u-alert');
  if (errPct >= 20 && u.codes.length) {
    const top = u.codes[0];
    const why = CODE_LABEL[top.status] || (top.status ? 'mã ' + top.status : 'không rõ nguyên nhân');
    setText(alert, errPct + '% request lỗi trong 24h — chủ yếu do ' + why + ' (' + top.n + ' lần).');
    alert.classList.remove('hidden');
  } else alert.classList.add('hidden');

  // biểu đồ cột theo giờ: đỏ chồng trên xanh
  const hb = document.getElementById('agy-u-hours');
  const lblBox = document.getElementById('agy-u-hourlbl');
  hb.innerHTML = '';
  lblBox.innerHTML = '';
  const lbl = lblBox;
  const max = Math.max(1, ...u.hours.map(h => h.n));
  for (const h of u.hours) {
    const col = document.createElement('div');
    col.className = 'ubar';
    col.title = h.h + 'h: ' + h.n + ' request' + (h.e ? ', ' + h.e + ' lỗi' : '');
    if (!h.n) {
      const z = document.createElement('div'); z.className = 'ubar-empty'; col.appendChild(z);
    } else {
      const pct = h.n / max * 100;
      const ePct = h.n ? (h.e / h.n) : 0;
      const eDiv = document.createElement('div');
      eDiv.className = 'ubar-e';
      eDiv.style.height = (pct * ePct) + '%';
      const oDiv = document.createElement('div');
      oDiv.className = 'ubar-o';
      oDiv.style.height = (pct * (1 - ePct)) + '%';
      if (h.e) col.appendChild(eDiv);
      col.appendChild(oDiv);
    }
    hb.appendChild(col);
    const s = document.createElement('span');
    s.textContent = h.h;
    lbl.appendChild(s);
  }
  // model dùng nhiều nhất
  const mb = document.getElementById('agy-u-models');
  mb.innerHTML = '';
  const mMax = Math.max(1, ...u.models.map(m => m.n));
  for (const m of u.models) {
    const row = document.createElement('div');
    row.className = 'urow';
    const fill = document.createElement('div');
    fill.className = 'urow-fill';
    fill.style.width = (m.n / mMax * 100) + '%';
    const tx = document.createElement('div');
    tx.className = 'urow-txt';
    const nm = document.createElement('span'); nm.className = 'urow-name'; nm.textContent = m.model;
    const n = document.createElement('span'); n.className = 'urow-n'; n.textContent = m.n;
    tx.appendChild(nm); tx.appendChild(n);
    if (m.e) { const e = document.createElement('span'); e.className = 'urow-e'; e.textContent = m.e + ' lỗi'; tx.appendChild(e); }
    row.appendChild(fill); row.appendChild(tx);
    mb.appendChild(row);
  }

  // mã lỗi
  const cb = document.getElementById('agy-u-codes');
  cb.innerHTML = '';
  for (const c of u.codes) {
    const s = document.createElement('span');
    s.className = 'ucode';
    const b = document.createElement('b');
    b.textContent = c.status || '?';
    s.appendChild(b);
    s.appendChild(document.createTextNode(' ' + (CODE_LABEL[c.status] || 'khác') + ' · ' + c.n));
    cb.appendChild(s);
  }
}

let agyModelGroups = [];
function renderAgyModels() {
  const box = document.getElementById('agy-modellist');
  const q = (document.getElementById('agy-modelsearch').value || '').trim().toLowerCase();
  const open = new Set([...box.querySelectorAll('.mgrp.open')].map(g => g.dataset.g));
  box.innerHTML = '';
  if (!agyModelGroups.length) {
    const e = document.createElement('div');
    e.className = 'text-[12.5px] text-[#666b7d]';
    e.textContent = '(gateway chưa trả models)';
    box.appendChild(e);
    return;
  }
  let shown = 0;
  for (const g of agyModelGroups) {
    const items = q ? g.items.filter(m => m.toLowerCase().indexOf(q) >= 0) : g.items;
    if (!items.length) continue;
    shown += items.length;
    const wrap = document.createElement('div');
    wrap.className = 'mgrp' + (q || open.has(g.name) ? ' open' : ''); // đang tìm -> mở sẵn
    wrap.dataset.g = g.name;
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'mgrp-head';
    const nm = document.createElement('span'); nm.className = 'mgrp-name'; nm.textContent = g.name;
    const ct = document.createElement('span'); ct.className = 'mgrp-count'; ct.textContent = items.length;
    const ch = document.createElement('span'); ch.className = 'mgrp-chev'; ch.innerHTML = ICON_CHEV;
    head.appendChild(nm); head.appendChild(ct); head.appendChild(ch);
    head.onclick = () => wrap.classList.toggle('open');
    const body = document.createElement('div'); body.className = 'mgrp-body';
    const inner = document.createElement('div');
    for (const m of items) {
      const it = document.createElement('div');
      it.className = 'mitem';
      if (q) { // tô sáng đoạn khớp, dùng textContent nên an toàn XSS
        const i = m.toLowerCase().indexOf(q);
        it.appendChild(document.createTextNode(m.slice(0, i)));
        const mk = document.createElement('mark'); mk.textContent = m.slice(i, i + q.length);
        it.appendChild(mk);
        it.appendChild(document.createTextNode(m.slice(i + q.length)));
      } else it.textContent = m;
      inner.appendChild(it);
    }
    body.appendChild(inner);
    wrap.appendChild(head); wrap.appendChild(body);
    box.appendChild(wrap);
  }
  if (!shown) {
    const e = document.createElement('div');
    e.className = 'text-[12.5px] text-[#666b7d]';
    e.textContent = 'Không có model nào khớp "' + q + '"';
    box.appendChild(e);
  }
}

async function refreshAgyStatus() {
  const r = await fetch('/api/agy/status').then(r => r.json()).catch(() => null);
  if (!r) return;
  // thẻ trạng thái
  const hero = document.getElementById('agy-hero');
  const heroCls = 'agyhero ' + (r.running ? 'on' : 'off');
  if (hero.className !== heroCls) hero.className = heroCls;
  setText(document.getElementById('agy-status'), r.running ? 'Đang chạy' : 'Đã dừng');
  const meta = r.running
    ? 'cổng ' + r.port + (r.dev ? ' · dashboard quản lý (pid ' + r.dev.pid + ')' : '')
    : 'cổng ' + r.port + ' không phản hồi';
  setText(document.getElementById('agy-hero-meta'), meta);
  const tag = document.getElementById('agy-hero-tag');
  tag.classList.toggle('hidden', !r.external);
  if (r.external) setText(tag, 'CHẠY NGOÀI');

  renderAgyUsage(r.usage);
  setText(document.getElementById('agy-accounts'), String(r.accounts));
  if (r.acc) {
    renderAccBar(r.acc);
    setText(document.getElementById('agy-acc-recent'), r.acc.recent24h + ' chạy trong 24h');
    const kiroOk = (r.acc.kiro && r.acc.kiro.ok) || 0;
    setText(document.getElementById('agy-kiro'), 'Kiro: ' + kiroOk + ' tài khoản sẵn sàng / ' + r.acc.total);
  }

  setText(document.getElementById('agy-models'), String(r.models.length));
  const gsig = JSON.stringify(r.modelGroups || []);
  if (gsig !== window.__agyGsig) { // danh sách model đổi mới render lại (giữ nhóm đang mở)
    window.__agyGsig = gsig;
    agyModelGroups = r.modelGroups || [];
    renderAgyModels();
  }
  // chạy ngoài dashboard -> Stop/Restart không kill được, hiện note
  document.getElementById('agy-note').classList.toggle('hidden', !(r.running && !r.dev));
  // buttons: Start disable khi đang chạy; Stop/Restart chỉ enable khi dashboard là chủ process
  // (proxy chạy ngoài -> Restart cũng disable: bấm chỉ spawn dev mới rồi dính EADDRINUSE)
  document.getElementById('agy-btn-start').disabled = !!r.dev || r.running;
  document.getElementById('agy-btn-stop').disabled = !r.dev;
  document.getElementById('agy-btn-restart').disabled = r.running && !r.dev;
  const taskName = r.task ? r.task.name : null;
  for (const name of ['build', 'test', 'typecheck']) {
    document.getElementById('agy-btn-' + name).disabled = !!taskName;
    agyChip(document.getElementById('agy-last-' + name), name, r.last[name], taskName === name);
  }
}

let agyLogBusy = false; // chống 2 poll chồng nhau (timer + gọi tay sau agyAction) -> log double-append
// Phân loại 1 dòng log để tô màu (textContent -> an toàn XSS)
function logLineNode(line) {
  const d = document.createElement('div');
  d.textContent = line;
  const l = line.toLowerCase();
  if (/\b(error|failed|fail|exception|cannot|econn|eaddrinuse)\b/.test(l) || l.indexOf('[exit code=1') >= 0) d.className = 'lg-err';
  else if (/\b(warn|warning|deprecat)\b/.test(l)) d.className = 'lg-warn';
  else if (/\b(success|passed|done|ready|listening|compiled|ok)\b/.test(l) || l.indexOf('[exit code=0') >= 0) d.className = 'lg-ok';
  else if (line.trim()[0] === '[') d.className = 'lg-dim'; // dòng nhãn [dev] [build]...
  return d;
}

async function pollAgyLog() {
  if (agyLogBusy) return;
  agyLogBusy = true;
  const r = await fetch('/api/agy/log?since=' + agyLogNext).then(r => r.json()).catch(() => null);
  agyLogBusy = false;
  if (!r) return;
  // server dashboard restart -> buffer mới: reset về 0 VÀ clear panel — không clear thì
  // lượt sau fetch lại từ đầu sẽ append trùng toàn bộ log đang hiển thị
  if (r.next < agyLogNext) { agyLogNext = 0; agyClearLog(); return; }
  if (!r.lines.length) { agyLogNext = r.next; return; }
  const box = document.getElementById('agy-log');
  if (agyLogEmpty) { box.textContent = ''; agyLogEmpty = false; }
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  // mỗi dòng 1 node có màu: lỗi đỏ / cảnh báo vàng / xong xanh — quét mắt ra ngay
  for (const line of r.lines) box.appendChild(logLineNode(line));
  agyLogNext = r.next;
  // cap DOM: quá nhiều dòng thì cắt bớt đầu (log cũ đã trôi khỏi buffer server rồi)
  while (box.childElementCount > 1200) box.removeChild(box.firstChild);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function agyClearLog() {
  document.getElementById('agy-log').textContent = '(đã clear — log mới sẽ hiện ở đây)';
  agyLogEmpty = true;
}

// Start/Stop/Restart/Build/Test/Typecheck — server spawn npm trong folder agy-proxy
async function agyAction(seg, cmd) {
  busy(true);
  const r = await fetch('/api/agy/' + seg, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd ? { cmd } : {}),
  }).then(r => r.json()).catch(e => ({ error: e.message })).finally(() => busy(false));
  if (r.error) toast('Lỗi: ' + r.error);
  else toast(seg === 'run' ? 'Đang chạy ' + cmd + ' — xem log bên dưới' : 'OK: ' + seg);
  refreshAgyStatus();
  pollAgyLog();
}

// Config editor: build 1 lần từ GET /api/agy/config, mỗi row có Save riêng
async function loadAgyConfig() {
  const r = await fetch('/api/agy/config').then(r => r.json()).catch(() => null);
  if (!r) return;
  agyCfgLoaded = true;
  const cont = document.getElementById('agy-config');
  cont.innerHTML = '';
  for (const f of r.fields) {
    const row = document.createElement('div');
    row.className = 'flex flex-col gap-1';
    const lbl = document.createElement('div');
    lbl.className = 'text-[12px] font-semibold text-[#a5a9b8]';
    lbl.style.fontFamily = 'ui-monospace, Menlo, monospace';
    lbl.textContent = f.key;
    const desc = document.createElement('div');
    desc.className = 'text-[11.5px] text-[#666b7d]';
    desc.textContent = f.desc;
    const line = document.createElement('div');
    line.className = 'agycfgrow flex items-center gap-2';
    const inp = document.createElement('input');
    inp.value = f.value;
    inp.placeholder = '(chưa đặt — dùng mặc định)';
    inp.setAttribute('autocomplete', 'off');
    const save = document.createElement('button');
    save.className = 'agycfgsave';
    save.textContent = 'Save';
    inp.addEventListener('input', () => save.classList.toggle('dirty', inp.value.trim() !== f.value));
    save.onclick = async () => {
      const value = inp.value.trim();
      const resp = await fetch('/api/agy/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: f.key, value }),
      }).then(x => x.json()).catch(e => ({ error: e.message }));
      if (resp.error) return toast('Lỗi: ' + resp.error);
      f.value = value;
      save.classList.remove('dirty');
      toast('Đã lưu ' + f.key + (resp.restart ? ' — bấm Restart để áp dụng' : ''));
    };
    line.appendChild(inp);
    line.appendChild(save);
    row.appendChild(lbl);
    row.appendChild(desc);
    row.appendChild(line);
    cont.appendChild(row);
  }
}
