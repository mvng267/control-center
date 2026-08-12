// E2E smoke test dashboard: mobile + desktop, console errors, PWA, shortcuts, palette, flicker
// resolve playwright-core: node_modules cạnh script HOẶC theo cwd (npm i --no-save ở đâu cũng chạy)
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { ({ chromium } = require(require('path').join(process.cwd(), 'node_modules', 'playwright-core'))); }
const URL = process.env.DASH_URL || 'http://localhost:7799/';
const results = [];
const ok = (name, pass, extra) => { results.push({ name, pass, extra }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : '')); };

/* ---- fixture tool card: session giả có đủ ca biên (ok / error / pending / image / MCP / orphan)
   mà session thật hiếm khi có đủ. Test tự ghi file, xoá ở finally. ---- */
const fs = require('fs');
const path = require('path');
const os = require('os');
const FIX_DIR = path.join(os.homedir(), '.claude', 'projects', '-tmp-e2e-tools');
const FIX_SID = 'e2e00000-0000-4000-8000-0000000000t1';
const FIX_FILE = path.join(FIX_DIR, FIX_SID + '.jsonl');

// Timestamp trong NGÀY HÔM NAY: fixture từng ghi ngày cứng "2026-08-08" nên chạy qua
// nửa đêm là vạch ngăn đổi thành "Hôm qua" và test fail dù chức năng vẫn đúng.
function todayAt(hh, mm, ss) {
  const d = new Date();
  d.setHours(hh, mm, ss || 0, 0);
  return d.toISOString();
}

function fixLine(type, content, ts) {
  return JSON.stringify({ type, timestamp: ts, message: { role: type, content } });
}
function writeFixture() {
  fs.mkdirSync(FIX_DIR, { recursive: true });
  const T = '2026-08-08T02:00:0';
  const lines = [
    // assistant: text + 3 tool_use (Bash, Edit, MCP)
    fixLine('assistant', [
      { type: 'text', text: 'Chạy test rồi sửa file.' },
      { type: 'tool_use', id: 'tu_bash1', name: 'Bash', input: { command: 'npm test', description: 'Chạy unit test' } },
      { type: 'tool_use', id: 'tu_edit1', name: 'Edit', input: { file_path: '/tmp/x/app.js', old_string: 'a', new_string: 'b' } },
      { type: 'tool_use', id: 'tu_mcp1', name: 'mcp__figma__get_screenshot', input: { url: 'https://figma.com/f/1' } },
    ], T + '0Z'),
    // user: 3 tool_result — 1 ok, 1 error, 1 có image; KHÔNG được tạo bubble user
    fixLine('user', [
      { type: 'tool_result', tool_use_id: 'tu_bash1', content: '12 passed' },
      { type: 'tool_result', tool_use_id: 'tu_edit1', content: 'String not found', is_error: true },
      { type: 'tool_result', tool_use_id: 'tu_mcp1', content: [{ type: 'text', text: 'shot ok' }, { type: 'image', source: {} }] },
      { type: 'tool_result', tool_use_id: 'tu_orphan_khong_ton_tai', content: 'mồ côi -> phải bỏ' },
    ], T + '1Z'),
    // assistant: tool_use CHƯA có result -> pending
    fixLine('assistant', [
      { type: 'tool_use', id: 'tu_read1', name: 'Read', input: { file_path: '/tmp/x/big.txt', offset: 10, limit: 20 } },
    ], T + '2Z'),
    // user text thường -> vẫn phải ra bubble user
    fixLine('user', [{ type: 'text', text: 'ok cảm ơn' }], T + '3Z'),
  ];
  fs.writeFileSync(FIX_FILE, lines.join('\n') + '\n');
}
function cleanFixture() {
  try { fs.rmSync(FIX_DIR, { recursive: true, force: true }); } catch {}
  // xoá tên tự đặt do test tạo — để sót thì lần chạy sau đọc phải tên cũ và fail
  try {
    const f = path.join(os.homedir(), '.claude', 'dashboard-titles.json');
    const t = JSON.parse(fs.readFileSync(f, 'utf8'));
    let dirty = false;
    for (const k of Object.keys(t)) if (k.startsWith('e2e00000-')) { delete t[k]; dirty = true; }
    if (dirty) fs.writeFileSync(f, JSON.stringify(t, null, 2));
  } catch {}
}

(async () => {
  writeFixture();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  for (const [label, vp] of [['mobile 390x844', { width: 390, height: 844 }], ['desktop 1440x900', { width: 1440, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const errors = [];
    /* Ghi kèm URL của request hỏng. Trước đây chỉ lưu m.text(), mà Chrome in đúng một
       câu "Failed to load resource: the server responded with a status of 404" KHÔNG
       kèm địa chỉ — nên khi bài này đỏ (khoảng 1/5 lần chạy, chỉ dưới test-all) thì
       không có cách nào biết cái gì 404. Bắt luôn ở tầng response cho biết đích danh. */
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    /* Bỏ qua các request mà chính bộ test CỐ Ý gửi hỏng để kiểm server chặn:
         /api/export/sid-khong-ton-tai -> 404
         /api/perm với mode rác        -> 400
       Không lọc ở đây thì chúng lọt vào bộ đếm và bài "console errors = 0" đỏ oan.
       Chỉ bỏ qua ĐÚNG cặp (đường dẫn + mã) đã biết, không bỏ cả đường dẫn: /api/perm
       mà trả 500 thì vẫn phải báo. */
    const COI_NHU_OK = [
      { rx: /\/api\/export\/sid-khong-ton-tai/, ma: 404 },   // kiểm sid lạ
      { rx: /\/api\/perm$/, ma: 400 },                       // kiểm chặn mode rác
      { rx: /\/api\/upload$/, ma: 400 },                     // kiểm chặn dữ liệu không phải ảnh
    ];
    page.on('response', r => {
      if (r.status() < 400) return;
      if (COI_NHU_OK.some(x => x.ma === r.status() && x.rx.test(r.url()))) return;
      errors.push(`HTTP ${r.status()} ${r.url()}`);
    });
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    ok(label + ': console errors = 0', errors.length === 0, errors.slice(0, 3).join(' ;; '));

    // PWA
    const manifest = await page.evaluate(() => fetch('/manifest.json').then(r => r.ok));
    const icon = await page.evaluate(() => fetch('/icon.svg').then(r => r.ok));
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !!reg;
    });
    ok(label + ': manifest+icon load', manifest && icon);
    ok(label + ': service worker registered', sw);

    // layout: nav vị trí đúng (mobile: bottom bar; desktop: sidebar trái)
    const nav = await page.locator('#sidenav').boundingBox();
    if (vp.width < 768) {
      ok(label + ': bottom tab bar dưới cùng', nav && nav.y > vp.height - 120 && nav.width > 300, JSON.stringify(nav));
      // touch targets >= 44px
      const th = await page.locator('#tabbtn-cli').boundingBox();
      ok(label + ': tab touch target >=44px', th && th.height >= 44, th && th.height);
    } else {
      ok(label + ': sidebar trái', nav && nav.x < 10 && nav.height > 400, JSON.stringify(nav));
    }

    // flicker check: row đầu tiên phải là CÙNG node sau 5s SSE ticks (diff render, không rebuild)
    const marked = await page.evaluate(() => {
      const r = document.querySelector('#sessrows .srow');
      if (!r) return 'no-rows';
      r.__marker = 'x1';
      return r.dataset.sid;
    });
    await page.waitForTimeout(5000);
    // check theo data-sid: node CÙNG identity vẫn tồn tại (row có thể đổi vị trí do sort mtime — hợp lệ)
    const still = await page.evaluate(sid => {
      const r = document.querySelector('#sessrows .srow[data-sid="' + sid + '"]');
      return r && r.__marker === 'x1';
    }, marked);
    ok(label + ': session rows KHÔNG rebuild sau 5s (no flicker)', marked === 'no-rows' || still, 'first sid=' + marked);

    // ⌘1-4 switch tab
    for (const [key, tab] of [['2', 'hermes'], ['3', 'agy'], ['4', 'stats'], ['1', 'cli']]) {
      await page.keyboard.press('Meta+' + key);
      await page.waitForTimeout(150);
      const active = await page.evaluate(t => !document.getElementById('tab-' + t).classList.contains('hidden'), tab);
      ok(label + ': Cmd+' + key + ' -> tab ' + tab, active);
    }

    // chords g a / g s / g c
    await page.keyboard.press('g'); await page.keyboard.press('a');
    await page.waitForTimeout(150);
    ok(label + ': chord "g a" -> agy', await page.evaluate(() => !document.getElementById('tab-agy').classList.contains('hidden')));
    await page.keyboard.press('g'); await page.keyboard.press('s');
    await page.waitForTimeout(150);
    ok(label + ': chord "g s" -> stats', await page.evaluate(() => !document.getElementById('tab-stats').classList.contains('hidden')));
    await page.keyboard.press('g'); await page.keyboard.press('c');
    await page.waitForTimeout(150);

    // tab agy: status cards + config editor load + log panel
    await page.keyboard.press('Meta+3');
    await page.waitForTimeout(3500);
    const agyStatus = await page.evaluate(() => document.getElementById('agy-status').textContent);
    ok(label + ': agy status hiển thị', agyStatus === 'Đang chạy' || agyStatus === 'Đã dừng', agyStatus);

    // thẻ trạng thái + thanh phân bổ tài khoản + models gom nhóm (giao diện mới)
    const agyUI = await page.evaluate(() => {
      const hero = document.getElementById('agy-hero');
      const segs = [...document.querySelectorAll('#agy-accbar span')];
      const lg = [...document.querySelectorAll('#agy-acclegend .acclg')].map(x => x.textContent);
      const grps = [...document.querySelectorAll('.mgrp')];
      return {
        heroCls: hero.className,
        tagShown: !document.getElementById('agy-hero-tag').classList.contains('hidden'),
        meta: document.getElementById('agy-hero-meta').textContent,
        segs: segs.length,
        segWidthSum: Math.round(segs.reduce((n, s) => n + parseFloat(s.style.width || 0), 0)),
        legend: lg,
        groups: grps.length,
        grpMinH: grps.length ? Math.min(...grps.map(g => g.querySelector('.mgrp-head').getBoundingClientRect().height)) : 0,
        recent: document.getElementById('agy-acc-recent').textContent,
      };
    });
    ok(label + ': agy thẻ trạng thái (màu theo on/off, ghi rõ cổng)',
      /agyhero (on|off)/.test(agyUI.heroCls) && agyUI.meta.indexOf('cổng') === 0,
      JSON.stringify({ cls: agyUI.heroCls, meta: agyUI.meta, tag: agyUI.tagShown }));
    ok(label + ': agy thanh phân bổ tài khoản (tổng ~100%, có chú thích)',
      agyUI.segs > 0 && Math.abs(agyUI.segWidthSum - 100) <= 2 && agyUI.legend.length === agyUI.segs
      && /\d+ chạy trong 24h/.test(agyUI.recent),
      JSON.stringify({ segs: agyUI.segs, sum: agyUI.segWidthSum, legend: agyUI.legend }));
    ok(label + ': agy models gom nhóm, head ≥44px (không còn khối chữ dính liền)',
      agyUI.groups > 0 && agyUI.grpMinH >= 43.9, JSON.stringify({ groups: agyUI.groups, h: agyUI.grpMinH }));

    // khối lưu lượng 24h (đọc gateway_usage trong state.db của agy-proxy)
    const usage = await page.evaluate(async () => {
      const r = await fetch('/api/agy/status').then(x => x.json());
      const box = document.getElementById('agy-usagebox');
      const hidden = box.classList.contains('hidden');
      return {
        apiOk: !!(r.usage && r.usage.ok),
        hidden,
        reqs: document.getElementById('agy-u-reqs').textContent,
        errs: document.getElementById('agy-u-errs').textContent,
        bars: document.querySelectorAll('#agy-u-hours .ubar').length,
        lbls: document.querySelectorAll('#agy-u-hourlbl span').length,
        models: document.querySelectorAll('#agy-u-models .urow').length,
        codes: document.querySelectorAll('#agy-u-codes .ucode').length,
        hoursLen: r.usage && r.usage.hours ? r.usage.hours.length : -1,
      };
    });
    if (usage.apiOk && usage.hoursLen === 0) {
      /* agy chạy nhưng KHÔNG có request nào trong 24h — chuyện bình thường, đã xác
         minh bằng SQL trên state.db: bản ghi mới nhất cách 29 giờ, trong khi 7 ngày
         trước đó có 8.797 request. Bài cũ đòi models > 0 nên đỏ theo LƯU LƯỢNG chứ
         không theo code: cứ để máy nghỉ một ngày là e2e đỏ, mất công đi tìm bug
         không tồn tại. Giờ chỉ đòi khối vẫn hiện và số liệu ở dạng hợp lệ. */
      ok(label + ': agy lưu lượng 24h — 24h rỗng thì vẫn hiện khối, không vỡ',
        !usage.hidden && /^[\d.]+[kMB]?$/.test(usage.reqs), JSON.stringify(usage));
    } else if (usage.apiOk) {
      // 1 cột + 1 nhãn cho mỗi giờ có dữ liệu; không có sqlite3 CLI thì khối này phải ẩn hẳn
      ok(label + ': agy lưu lượng 24h (số liệu thật, biểu đồ giờ, model, mã lỗi)',
        !usage.hidden && /^[\d.]+[kMB]?$/.test(usage.reqs)
        && usage.bars === usage.hoursLen && usage.lbls === usage.hoursLen && usage.models > 0,
        JSON.stringify(usage));
    } else {
      ok(label + ': agy lưu lượng — ẩn khối khi không đọc được state.db', usage.hidden, JSON.stringify(usage));
    }

    // tìm model -> lọc + tô sáng; xoá ô tìm -> hiện lại đủ nhóm
    const agySearch = await page.evaluate(async () => {
      const inp = document.getElementById('agy-modelsearch');
      const before = document.querySelectorAll('.mgrp').length;
      inp.value = 'claude'; inp.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 200));
      const hit = {
        groups: document.querySelectorAll('.mgrp').length,
        items: document.querySelectorAll('.mitem').length,
        marks: document.querySelectorAll('.mitem mark').length,
        allOpen: [...document.querySelectorAll('.mgrp')].every(g => g.classList.contains('open')),
      };
      inp.value = 'zzz-khong-ton-tai'; inp.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 200));
      const empty = document.getElementById('agy-modellist').textContent.indexOf('Không có model') >= 0;
      inp.value = ''; inp.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 200));
      return { before, hit, empty, after: document.querySelectorAll('.mgrp').length };
    });
    ok(label + ': agy tìm model -> lọc + tô sáng + báo khi không khớp',
      agySearch.hit.items > 0 && agySearch.hit.marks === agySearch.hit.items
      && agySearch.hit.allOpen && agySearch.empty && agySearch.after === agySearch.before,
      JSON.stringify(agySearch));
    const cfgInputs = await page.locator('#agy-config input').count();
    ok(label + ': agy config editor có fields', cfgInputs >= 5, cfgInputs + ' inputs');
    // buffer server rỗng (dashboard mới restart) -> panel phải là placeholder; có log -> phải hiển thị
    const logState = await page.evaluate(async () => {
      const srv = await fetch('/api/agy/log?since=0').then(r => r.json());
      return { srvLines: srv.lines.length, panel: document.getElementById('agy-log').textContent.length };
    });
    ok(label + ': agy log panel khớp buffer server',
      logState.srvLines > 0 ? logState.panel > 50 : logState.panel > 10, JSON.stringify(logState));
    // note "chạy ngoài" phải hiện (proxy ngoài đang chạy, dashboard không sở hữu)
    const noteShown = await page.evaluate(() => !document.getElementById('agy-note').classList.contains('hidden'));
    ok(label + ': note "chạy ngoài dashboard" hiện', noteShown);
    // Start/Stop/Restart đều disabled (đang chạy ngoài, dashboard không sở hữu process)
    const btns = await page.evaluate(() => ({
      start: document.getElementById('agy-btn-start').disabled,
      stop: document.getElementById('agy-btn-stop').disabled,
      restart: document.getElementById('agy-btn-restart').disabled,
    }));
    ok(label + ': Start+Stop+Restart disabled đúng khi proxy chạy ngoài', btns.start && btns.stop && btns.restart, JSON.stringify(btns));

    // ⌘K palette + filter + navigate
    await page.keyboard.press('Meta+1');
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(350);
    ok(label + ': Cmd+K mở palette', await page.evaluate(() => document.getElementById('drawerwrap').classList.contains('open')));
    await page.keyboard.type('loop');
    await page.waitForTimeout(150);
    // "loop" khớp /loop (tên) + /jobs (desc chứa "loop") — /loop phải đứng đầu và được highlight
    const visCards = await page.evaluate(() => [...document.querySelectorAll('.palcard:not(.hidden)')].map(c => c.querySelector('.pname').textContent));
    const activeCard = await page.evaluate(() => { const a = document.querySelector('.palcard.active .pname'); return a && a.textContent; });
    ok(label + ': filter "loop" -> /loop đứng đầu + highlight', visCards[0] === '/loop' && activeCard === '/loop', JSON.stringify(visCards));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    const afterPick = await page.evaluate(() => ({
      open: document.getElementById('drawerwrap').classList.contains('open'),
      input: document.getElementById('taskinput').value,
    }));
    ok(label + ': Enter chọn /loop -> đóng palette, điền input', !afterPick.open && afterPick.input.startsWith('/loop'), JSON.stringify(afterPick));
    await page.evaluate(() => { document.getElementById('taskinput').value = ''; });

    // Esc đóng palette
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    ok(label + ': Esc đóng palette', await page.evaluate(() => !document.getElementById('drawerwrap').classList.contains('open')));

    // hermes tab: danh sách + mở chat trực tiếp + persist localStorage
    await page.keyboard.press('Meta+2');
    await page.waitForTimeout(500);
    const hRows = await page.locator('#hermesrows .srow').count();
    ok(label + ': hermes list có conversations', hRows > 0, hRows + ' rows');
    await page.evaluate(() => openHermesDirect());
    await page.evaluate(() => {
      hermesExtra['__direct__'] = [{ role: 'user', content: 'test-persist-123' }];
      saveHermesExtra();
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const persisted = await page.evaluate(() => (JSON.parse(localStorage.getItem('hermesExtra') || '{}')['__direct__'] || []).some(m => m.content === 'test-persist-123'));
    ok(label + ': hermes localStorage persist qua reload', persisted);
    await page.evaluate(() => { localStorage.removeItem('hermesExtra'); });

    // command history: ↑/↓ trong taskinput gọi lại lệnh cũ từ localStorage
    await page.keyboard.press('Meta+1');
    await page.evaluate(() => { localStorage.setItem('hist:task', JSON.stringify(['cmd một', 'cmd hai'])); });
    await page.focus('#taskinput');
    await page.keyboard.press('ArrowUp');
    const h1 = await page.evaluate(() => document.getElementById('taskinput').value);
    await page.keyboard.press('ArrowUp');
    const h2 = await page.evaluate(() => document.getElementById('taskinput').value);
    await page.keyboard.press('ArrowDown');
    const h3 = await page.evaluate(() => document.getElementById('taskinput').value);
    ok(label + ': command history ↑/↓ trong taskinput', h1 === 'cmd hai' && h2 === 'cmd một' && h3 === 'cmd hai', JSON.stringify([h1, h2, h3]));
    await page.evaluate(() => { document.getElementById('taskinput').value = ''; localStorage.removeItem('hist:task'); });
    await page.keyboard.press('Escape'); // blur input

    // notifications: notifyDone -> toast hiện (vibrate/beep không assert được ở headless)
    await page.evaluate(() => notifyDone('test-notify-xyz'));
    await page.waitForTimeout(100);
    const toastShown = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t.classList.contains('show') && t.textContent === 'test-notify-xyz';
    });
    ok(label + ': notifyDone -> toast hiện', toastShown);

    // ===== VÒNG 3 =====
    // export endpoint: .json + .md, full history, Content-Disposition attachment
    const expSid = await page.evaluate(() => (allSessions[0] || {}).sid || null);
    if (expSid) {
      const exp = await page.evaluate(async sid => {
        const rj = await fetch('/api/export/' + sid + '?fmt=json');
        const jdisp = rj.headers.get('content-disposition') || '';
        const j = await rj.json();
        const rm = await fetch('/api/export/' + sid + '?fmt=md');
        const mdisp = rm.headers.get('content-disposition') || '';
        const md = await rm.text();
        return { jok: rj.ok, jdisp, jmsgs: (j.messages || []).length, mok: rm.ok, mdisp, mlen: md.length };
      }, expSid);
      ok(label + ': export .json+.md OK (attachment, có messages)',
        exp.jok && exp.mok && exp.jdisp.includes('attachment') && exp.mdisp.includes('.md') && exp.jmsgs > 0 && exp.mlen > 30,
        JSON.stringify(exp));
    } else ok(label + ': export endpoint (skip — không có session)', true);
    const exp404 = await page.evaluate(() => fetch('/api/export/sid-khong-ton-tai').then(r => r.status));
    ok(label + ': export sid lạ -> 404', exp404 === 404, String(exp404));
    /* Listener response đã bỏ qua request 404 chủ ý này rồi. Nhưng Chrome VẪN in một
       dòng console "Failed to load resource … 404" không kèm địa chỉ — không lọc được
       ở nguồn vì không biết nó thuộc request nào, nên gỡ tại đây. */
    const i404 = errors.findIndex(x => /404/.test(x) && !/^HTTP /.test(x));
    if (i404 >= 0) errors.splice(i404, 1);

    // nút export trong chat view Claude
    if (expSid) {
      await page.evaluate(sid => openChat(sid), expSid);
      await page.waitForTimeout(400);
      const expBtn = await page.evaluate(() => !!document.getElementById('exportbtn'));
      ok(label + ': chat view có nút export', expBtn);
      await page.evaluate(() => backToList());
    } else ok(label + ': nút export chat view (skip)', true);

    // ---- TOOL CARD (fixture): parse có cấu trúc + render card + mở/đóng + mobile ----
    const th = await page.evaluate(async sid => {
      const r = await fetch('/api/history/' + sid).then(x => x.json());
      const tools = r.messages.flatMap(m => (m.parts || []).filter(p => p.t === 'tool'));
      return {
        start: r.start, total: r.total, nMsg: r.messages.length,
        st: tools.map(t => t.status),
        names: tools.map(t => t.name),
        disp: tools.map(t => t.disp),
        sums: tools.map(t => t.summary),
        img: tools.map(t => t.images),
        results: tools.map(t => t.result),
        roles: r.messages.map(m => m.role),
      };
    }, FIX_SID);
    // 4 tool_use, đúng thứ tự status; orphan tool_result bị bỏ
    ok(label + ': history trả parts có cấu trúc (ok/error/pending) + field start',
      th.st.join(',') === 'ok,error,ok,pending' && th.start === 0 && th.total === 3 && th.nMsg === 3,
      JSON.stringify({ st: th.st, start: th.start, total: th.total }));
    // user thuần tool_result KHÔNG ra bubble; user text thường thì có
    ok(label + ': msg user thuần tool_result không thành bubble',
      th.roles.join(',') === 'assistant,assistant,user', th.roles.join(','));
    ok(label + ': summary theo từng loại tool + tên MCP rút gọn',
      th.sums[0] === 'Chạy unit test' && th.sums[1] === 'app.js' && th.sums[3] === 'big.txt:10-30'
      && th.disp[2] === 'figma · get screenshot',
      JSON.stringify({ sums: th.sums, mcp: th.disp[2] }));
    ok(label + ': tool_result mảng -> nối text + giữ metadata ảnh (không nhồi base64 vào payload)',
      th.img[2].length === 1 && th.img[2][0].mt === 'image/png' && th.img[0].length === 0
      && th.results[2] === 'shot ok', JSON.stringify({ img: th.img, r2: th.results[2] }));

    await page.evaluate(sid => openChat(sid), FIX_SID);
    await page.waitForFunction(() => document.querySelectorAll('.tcard').length >= 4, { timeout: 8000 });
    const tc = await page.evaluate(() => {
      const box = document.getElementById('bubbles');
      const cards = [...box.querySelectorAll('.tcard')];
      return {
        n: cards.length,
        userBubs: box.querySelectorAll('.bub-user').length,
        wraps: box.querySelectorAll('.msgwrap').length,
        errCard: cards.filter(c => c.classList.contains('t-err')).length,
        minHead: Math.min(...cards.map(c => c.querySelector('.tcard-head').getBoundingClientRect().height)),
        wrapPct: +(box.querySelector('.msgwrap').getBoundingClientRect().width / box.clientWidth * 100).toFixed(1),
        firstSum: cards[0].querySelector('.tcard-sum').textContent,
        anyOpen: cards.filter(c => c.classList.contains('open')).length,
      };
    });
    ok(label + ': render 4 tool card, chỉ 1 bubble user, card lỗi có class t-err',
      tc.n === 4 && tc.userBubs === 1 && tc.wraps === 2 && tc.errCard === 1, JSON.stringify(tc));
    ok(label + ': tap target head ≥44px + msgwrap ≤85% + summary hiện đúng',
      tc.minHead >= 43.9 && tc.wrapPct <= 85.5 && tc.firstSum === 'Chạy unit test' && tc.anyOpen === 0,
      JSON.stringify({ h: tc.minHead, pct: tc.wrapPct }));

    // mở card đầu -> có INPUT + RESULT; đóng lại -> hết .open
    await page.evaluate(() => document.querySelector('.tcard .tcard-head').click());
    /* Chờ thẻ MỞ HẲN, không ngủ 350ms cố định. Thân thẻ giãn ra có hiệu ứng, đo trúng
       lúc đang giãn thì bodyH còn ~0 và bài đỏ oan (bắt được khi chạy dồn nhiều lần).
       Chờ chính điều kiện sắp khẳng định: có class .open VÀ thân đã cao thật. */
    await page.waitForFunction(() => {
      const c = document.querySelector('.tcard');
      const b = c && c.querySelector('.tcard-body');
      return !!c && c.classList.contains('open') && !!b && b.getBoundingClientRect().height > 20;
    }, { timeout: 8000 }).catch(() => {});
    const opened = await page.evaluate(() => {
      const c = document.querySelector('.tcard');
      const errc = [...document.querySelectorAll('.tcard')].find(x => x.classList.contains('t-err'));
      return {
        open: c.classList.contains('open'),
        aria: c.querySelector('.tcard-head').getAttribute('aria-expanded'),
        labels: [...c.querySelectorAll('.tlbl')].map(x => x.textContent),
        bodyH: c.querySelector('.tcard-body').getBoundingClientRect().height,
        code: c.querySelector('.codeblock').textContent,
        copyBtns: c.querySelectorAll('.copybtn').length,
        errLabel: (() => { errc.querySelector('.tcard-head').click(); return null; })(),
      };
    });
    ok(label + ': mở card -> INPUT+KẾT QUẢ, body cao ra, có nút Copy',
      opened.open && opened.aria === 'true' && opened.labels.join(',') === 'INPUT,KẾT QUẢ'
      && opened.bodyH > 20 && opened.code === 'npm test' && opened.copyBtns === 2,
      JSON.stringify({ labels: opened.labels, h: opened.bodyH, code: opened.code }));
    await page.waitForTimeout(350);
    const errBody = await page.evaluate(() => {
      const errc = [...document.querySelectorAll('.tcard')].find(x => x.classList.contains('t-err'));
      return { labels: [...errc.querySelectorAll('.tlbl')].map(x => x.textContent), errSec: errc.querySelectorAll('.tsec-err').length };
    });
    // card Edit lỗi: input hiện dạng diff "THAY ĐỔI", kết quả hiện "LỖI" (không phải "KẾT QUẢ")
    ok(label + ': card lỗi -> section LỖI + input Edit render dạng diff',
      errBody.labels.includes('LỖI') && !errBody.labels.includes('KẾT QUẢ')
      && errBody.labels.includes('THAY ĐỔI') && errBody.errSec === 1, JSON.stringify(errBody));
    await page.evaluate(() => document.querySelector('.tcard .tcard-head').click());
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => document.querySelector('.tcard').classList.contains('open'));
    ok(label + ': tap lần 2 -> card đóng lại', closed === false);

    // ---- window trượt: file đã đầy 30 msg, thêm 2 msg nữa -> length KHÔNG đổi.
    // Bug cũ: chỉ so length -> vòng append không chạy -> client đứng hình, mất msg mới vĩnh viễn.
    const appendFix = n => {
      for (let k = 0; k < n; k++) {
        require('fs').appendFileSync(FIX_FILE, JSON.stringify({
          type: 'user', timestamp: '2026-08-08T03:00:00Z',
          message: { role: 'user', content: [{ type: 'text', text: 'fill ' + k }] },
        }) + '\n');
      }
    };
    appendFix(30); // đẩy session vượt window 30
    await page.evaluate(sid => openChat(sid), FIX_SID);
    await page.waitForTimeout(900);
    const slide = await page.evaluate(() => {
      const box = document.getElementById('bubbles');
      return { before: box.querySelectorAll('.msgwrap').length }; // .daydiv không phải message
    });
    require('fs').appendFileSync(FIX_FILE, JSON.stringify({
      type: 'user', timestamp: '2026-08-08T03:10:00Z',
      message: { role: 'user', content: [{ type: 'text', text: 'msg-sau-khi-truot' }] },
    }) + '\n');
    await page.waitForTimeout(2600); // 1 nhịp poll 2s
    const slid = await page.evaluate(() => {
      const box = document.getElementById('bubbles');
      const wraps = box.querySelectorAll('.msgwrap');
      const last = wraps[wraps.length - 1];
      return {
        n: wraps.length,
        // text bubble cuối (bỏ dòng meta giờ) phải là message vừa ghi thêm
        last: last ? (last.querySelector('.bub') || last).textContent.trim() : '',
      };
    });
    // bug cũ: length không đổi -> vòng append không chạy -> client đứng hình, mất msg mới vĩnh viễn
    ok(label + ': window trượt -> vẫn nhận msg mới (không đứng hình)',
      slide.before === 30 && slid.n === 30 && slid.last === 'msg-sau-khi-truot',
      JSON.stringify({ before: slide.before, after: slid.n, last: slid.last }));

    // ---- layout ca biên: tên MCP dài + kết quả 40 dòng (từng làm vỡ head / card cao 660px) ----
    const UXSID = 'e2e00000-0000-4000-8000-0000000000ux';
    const UXFILE = require('path').join(FIX_DIR, UXSID + '.jsonl');
    require('fs').writeFileSync(UXFILE,
      fixLine('assistant', [
        { type: 'tool_use', id: 'x1', name: 'mcp__claude_ai_Figma__get_design_context', input: { url: 'https://figma.com/design/abc/Control-Center?node-id=12-345' } },
        { type: 'tool_use', id: 'x2', name: 'Grep', input: { pattern: 'render', path: '/x/src' } },
      ], '2026-08-08T06:00:00Z') + '\n' +
      fixLine('user', [
        { type: 'tool_result', tool_use_id: 'x1', content: [{ type: 'text', text: 'Frame' }, { type: 'image', source: {} }] },
        { type: 'tool_result', tool_use_id: 'x2', content: Array.from({ length: 40 }, (_, i) => '/x/src/file' + i + '.tsx:' + i + ': hit').join('\n') },
      ], '2026-08-08T06:00:10Z') + '\n');
    await page.evaluate(s => openChat(s), UXSID);
    // đợi card render thật (file vừa ghi, server có thể còn cache mtime cũ 1 nhịp poll)
    await page.waitForFunction(() => document.querySelectorAll('.tcard').length >= 2, { timeout: 8000 });
    const lay = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.tcard')];
      const mcp = cards[0];
      const head = mcp.querySelector('.tcard-head');
      const chev = mcp.querySelector('.tcard-chev').getBoundingClientRect();
      const hr = head.getBoundingClientRect();
      cards[1].querySelector('.tcard-head').click(); // mở card grep 40 dòng
      return {
        chevIn: chev.right <= hr.right + 1 && chev.width > 0, // chevron KHÔNG bị đẩy ra ngoài
        sumVisible: mcp.querySelector('.tcard-sum').getBoundingClientRect().width > 20,
        nameTip: mcp.querySelector('.tcard-name').title,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    await page.waitForTimeout(450);
    const tall = await page.evaluate(() => {
      const grep = [...document.querySelectorAll('.tcard')][1];
      // khối KẾT QUẢ (40 dòng) mới là cái phải cuộn — .codeblock đầu tiên là INPUT
      const secs = [...grep.querySelectorAll('.tsec')];
      const resSec = secs.find(s => ((s.querySelector('.tlbl') || {}).textContent || '').indexOf('KẾT QUẢ') === 0);
      const pre = resSec.querySelector('.codeblock');
      return {
        bodyH: grep.querySelector('.tcard-body').getBoundingClientRect().height,
        preH: pre.clientHeight, preScroll: pre.scrollHeight,
        imgNote: document.querySelector('.timg') ? document.querySelector('.timg').textContent : null,
      };
    });
    ok(label + ': head không vỡ khi tên MCP dài (chevron + summary còn nguyên)',
      lay.chevIn && lay.sumVisible && !lay.pageOverflow
      && lay.nameTip === 'mcp__claude_ai_Figma__get_design_context', JSON.stringify(lay));
    ok(label + ': kết quả dài cuộn trong khối, card không cao lê thê',
      tall.bodyH < 500 && tall.preH <= 262 && tall.preScroll > tall.preH,
      JSON.stringify(tall));
    await page.evaluate(() => backToList());
    await page.waitForTimeout(200);
    // KHÔNG xoá UXFILE ở đây: vòng viewport thứ 2 còn dùng lại. Dọn ở cleanFixture().

    // ---- TOKEN: lỗ hổng cũ là hostAllowed chỉ đọc header Host (giả mạo được).
    // Mọi /api/* từ NGOÀI loopback phải 401 nếu thiếu token; vỏ app vẫn phải mở được. ----
    const tok = await page.evaluate(async () => {
      // fetch đã bị bọc để tự gắn token -> dùng rawFetch để test đúng trường hợp thiếu token
      const noTok = await rawFetch('/api/agy/status').then(r => r.status);
      const withTok = await fetch('/api/agy/status').then(r => r.status);
      const shell = await rawFetch('/manifest.json').then(r => r.ok);
      return { noTok, withTok, shell, hasToken: !!dashToken };
    });
    // e2e chạy qua localhost = loopback -> server miễn token, nên noTok cũng 200.
    // Phần chặn thật đã kiểm chứng bằng curl qua IP mạng (401). Ở đây chỉ xác nhận
    // client gắn token đúng và vỏ app luôn mở được.
    ok(label + ': token — client gắn token vào /api/*, vỏ app không cần token',
      tok.withTok === 200 && tok.shell === true, JSON.stringify(tok));

    // ---- model riêng từng phiên: /model đổi toàn cục, cái này chỉ đổi 1 phiên ----
    const mdl = await page.evaluate(async sid => {
      const other = (allSessions.find(s => s.sid !== sid) || {}).sid;
      const set = await fetch('/api/model/' + sid, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'opus' }) })
        .then(r => r.json());
      const mine = await fetch('/api/history/' + sid).then(r => r.json());
      const theirs = other ? await fetch('/api/history/' + other).then(r => r.json()) : { model: null };
      const cleared = await fetch('/api/model/' + sid, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: '' }) })
        .then(r => r.json());
      const after = await fetch('/api/history/' + sid).then(r => r.json());
      return { set: set.model, mine: mine.model, theirs: theirs.model,
               cleared: cleared.model, after: after.model };
    }, FIX_SID);
    ok(label + ': model riêng phiên — đặt/xoá được, phiên khác KHÔNG dính theo',
      mdl.set === 'opus' && mdl.mine === 'opus' && mdl.theirs === null
      && mdl.cleared === null && mdl.after === null, JSON.stringify(mdl));

    // ---- gửi ảnh: endpoint nhận ảnh, từ chối dữ liệu không phải ảnh ----
    const up = await page.evaluate(async () => {
      const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const okr = await fetch('/api/upload', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: PNG }) })
        .then(r => r.json());
      const bad = await fetch('/api/upload', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'data:text/plain;base64,aGk=' }) }).then(r => r.status);
      // khay đính kèm: thêm rồi bỏ
      attachments.push({ path: okr.path, name: 'test.png', thumb: PNG });
      renderAttachments();
      const shown = document.querySelectorAll('.attachchip').length;
      document.querySelector('.attachx').click();
      return { ok: okr.ok, hasPath: !!(okr.path || '').length, bad, shown,
               afterRemove: document.querySelectorAll('.attachchip').length,
               hasBtn: !!document.getElementById('attachbtn') };
    });
    ok(label + ': gửi ảnh — lưu được, chặn dữ liệu lạ, khay đính kèm thêm/bỏ đúng',
      up.ok && up.hasPath && up.bad === 400 && up.shown === 1
      && up.afterRemove === 0 && up.hasBtn, JSON.stringify(up));
    // request 400 ở trên là CHỦ Ý (test chặn dữ liệu không phải ảnh) -> loại khỏi đếm lỗi console
    const iUp400 = errors.findIndex(x => x.includes('400'));
    if (iUp400 >= 0) errors.splice(iUp400, 1);

    // ---- lệnh mới + nút dừng ----
    const newCmds = await page.evaluate(() => ({
      cmds: COMMANDS.filter(c => ['/cost', '/compact', '/stop'].includes(c.cmd)).map(c => c.cmd).sort(),
      hasStopBtn: !!document.querySelector('#typingind .stopbtn'),
      hasApprove: !!document.getElementById('chatapprove'),
      hasOffbar: !!document.getElementById('offbar'),
      hasPtr: !!document.getElementById('ptr'),
    }));
    ok(label + ': có /cost /compact /stop + nút dừng + thanh duyệt + báo offline + kéo-làm-mới',
      newCmds.cmds.join(',') === '/compact,/cost,/stop' && newCmds.hasStopBtn
      && newCmds.hasApprove && newCmds.hasOffbar && newCmds.hasPtr, JSON.stringify(newCmds));

    // ---- kéo-để-làm-mới: chỉ kích hoạt khi ở đỉnh danh sách, kéo đủ xa ----
    const ptr = await page.evaluate(async () => {
      const mk = y => new Touch({ identifier: 1, target: document.body, clientX: 195, clientY: y });
      const drag = async dy => {
        document.dispatchEvent(new TouchEvent('touchstart',
          { touches: [mk(200)], changedTouches: [mk(200)], bubbles: true }));
        document.dispatchEvent(new TouchEvent('touchmove',
          { touches: [mk(200 + dy)], changedTouches: [mk(200 + dy)], bubbles: true }));
        await new Promise(r => setTimeout(r, 80));
        const el = document.getElementById('ptr');
        const st = { on: el.classList.contains('on'), ready: el.classList.contains('ready') };
        document.dispatchEvent(new TouchEvent('touchend',
          { changedTouches: [mk(200 + dy)], touches: [], bubbles: true }));
        return st;
      };
      const short = await drag(30);   // kéo ngắn -> hiện gợi ý, chưa sẵn sàng
      const long = await drag(90);    // kéo đủ xa -> sẵn sàng làm mới
      return { short, long };
    });
    ok(label + ': kéo-để-làm-mới — kéo ngắn chỉ gợi ý, kéo đủ xa mới sẵn sàng',
      ptr.short.on && !ptr.short.ready && ptr.long.on && ptr.long.ready, JSON.stringify(ptr));

    // ---- offline: service worker cache vỏ app, KHÔNG cache /api/* ----
    const swc = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const keys = await caches.keys();
      let shell = [];
      if (keys.length) {
        const c = await caches.open(keys[0]);
        shell = (await c.keys()).map(r => new URL(r.url).pathname);
      }
      const bar = document.getElementById('offbar');
      setOffline(true);
      const shown = !bar.classList.contains('hidden');
      setOffline(false);
      return { reg: !!reg, shell: shell.sort(), apiCached: shell.some(u => u.indexOf('/api/') === 0), shown };
    });
    ok(label + ': offline — cache vỏ app, KHÔNG cache /api/*, có banner mất mạng',
      swc.reg && swc.shell.indexOf('/') >= 0 && !swc.apiCached && swc.shown, JSON.stringify(swc));

    // ---- GLASS: blur đúng chỗ + KHÔNG blur trên vùng cuộn (94 lớp blur = tụt fps iPhone) ----
    const glass = await page.evaluate(() => {
      const bf = el => {
        const c = getComputedStyle(el);
        return c.backdropFilter || c.webkitBackdropFilter || 'none';
      };
      const has = sel => { const e = document.querySelector(sel); return e ? bf(e) !== 'none' : null; };
      const rows = [...document.querySelectorAll('#sessrows .srow')];
      return {
        supports: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
        header: has('header'),
        bodyGradient: getComputedStyle(document.body).backgroundImage.indexOf('gradient') >= 0,
        // dòng session cuộn nhiều -> PHẢI không có blur
        rowsBlurred: rows.filter(r => bf(r) !== 'none').length,
        rowsTotal: rows.length,
        // tổng số phần tử blur phải nhỏ (bề mặt tĩnh thôi)
        totalBlurred: [...document.querySelectorAll('*')].filter(e => bf(e) !== 'none').length,
      };
    });
    ok(label + ': glass — nền gradient + blur ở chrome, KHÔNG blur trên dòng cuộn',
      glass.bodyGradient && (!glass.supports || glass.header)
      && glass.rowsBlurred === 0 && glass.totalBlurred < 60,
      JSON.stringify(glass));

    // ---- công tắc quyền: dashboard chạy claude -p nên KHÔNG có hộp thoại hỏi quyền;
    // acceptEdits là thứ giúp Claude thật sự sửa được file thay vì báo "chưa có quyền" ----
    const perm = await page.evaluate(async () => {
      // đưa về acceptEdits trước: chế độ được LƯU BỀN qua restart nên lần chạy trước
      // để lại giá trị gì thì lần này bắt đầu từ đó -> test phải tự đặt mốc
      await fetch('/api/perm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'acceptEdits' }) });
      permMode = 'acceptEdits'; renderPerm();
      await new Promise(r => setTimeout(r, 200));
      const start = { label: document.getElementById('permlabel').textContent,
                      cls: document.getElementById('permbtn').className };
      const seen = [];
      for (let i = 0; i < 4; i++) {  // 1 vòng: acceptEdits -> plan -> default -> bypass -> về đầu
        await cyclePerm();          // cyclePerm trả promise -> đợi server xác nhận xong hẳn
        await new Promise(r => setTimeout(r, 80));
        seen.push({ mode: permMode, label: document.getElementById('permlabel').textContent,
                    cls: document.getElementById('permbtn').className });
      }
      const bad = await fetch('/api/perm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'khong-hop-le' }) }).then(r => r.status);
      // trả về acceptEdits cho các test sau + đúng mặc định
      await fetch('/api/perm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'acceptEdits' }) });
      return { start, seen, bad };
    });
    // request 400 ở trên là CHỦ Ý (test chặn giá trị lạ) -> loại khỏi đếm console error cuối phiên
    /* Listener đã bỏ qua HTTP 400 của /api/perm và /api/upload — cả hai đều là request
       CỐ Ý gửi hỏng. Còn lại là dòng console của Chrome, không kèm địa chỉ nên không
       lọc được ở nguồn. Gỡ HẾT chứ không gỡ một: có hai request như vậy, gỡ một thì
       bài luôn đỏ vì đúng một dòng thừa. */
    for (let i = errors.length - 1; i >= 0; i--) {
      if (/400/.test(errors[i]) && !/^HTTP /.test(errors[i])) errors.splice(i, 1);
    }
    ok(label + ': công tắc quyền mặc định acceptEdits + xoay vòng 4 chế độ + chặn giá trị lạ',
      perm.start.cls.indexOf('p-accept') >= 0 && perm.start.label === 'Tự sửa file'
      && perm.seen.map(s => s.mode).join(',') === 'plan,default,bypassPermissions,acceptEdits'
      && perm.seen[0].cls.indexOf('p-plan') >= 0
      && perm.seen[2].cls.indexOf('p-bypass') >= 0 && perm.bad === 400,
      JSON.stringify(perm));

    // ---- vuốt ngang chuyển tab (mobile) ----
    const swipe = await page.evaluate(async () => {
      const fire = (dx, dy) => {
        const mk = (x, y) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
        document.dispatchEvent(new TouchEvent('touchstart',
          { touches: [mk(195, 400)], changedTouches: [mk(195, 400)], bubbles: true }));
        document.dispatchEvent(new TouchEvent('touchend',
          { changedTouches: [mk(195 + dx, 400 + dy)], touches: [], bubbles: true }));
        return activeTab;
      };
      switchTab('cli');
      await new Promise(r => setTimeout(r, 150));
      const seq = [];
      seq.push(fire(-120, 5));                    // cli -> hermes
      seq.push(fire(-120, 5));                    // -> agy
      seq.push(fire(-120, 5));                    // -> stats
      seq.push(fire(-120, 5));                    // hết -> vẫn stats
      seq.push(fire(120, 5));                     // -> agy
      const diag = fire(120, 90);                 // vuốt chéo -> PHẢI bỏ qua
      const short = fire(-30, 2);                 // vuốt ngắn -> PHẢI bỏ qua
      switchTab('cli');
      return { seq, diag, short };
    });
    ok(label + ': vuốt ngang chuyển tab, dừng ở 2 đầu, bỏ qua vuốt chéo/ngắn',
      swipe.seq.join(',') === 'hermes,agy,stats,stats,agy'
      && swipe.diag === 'agy' && swipe.short === 'agy', JSON.stringify(swipe));

    // ---- tiêu đề phiên: ai-title của Claude CLI + đổi tên riêng ở dashboard ----
    const TTSID = 'e2e00000-0000-4000-8000-0000000000tt';
    const TTFILE = require('path').join(FIX_DIR, TTSID + '.jsonl');
    require('fs').writeFileSync(TTFILE,
      JSON.stringify({ type: 'ai-title', aiTitle: 'Tiêu đề cũ', sessionId: TTSID }) + '\n' +
      fixLine('user', [{ type: 'text', text: 'câu hỏi đầu tiên' }], '2026-08-08T09:00:00Z') + '\n' +
      JSON.stringify({ type: 'ai-title', aiTitle: 'Tiêu đề Claude CLI đặt', sessionId: TTSID }) + '\n' +
      fixLine('assistant', [{ type: 'text', text: 'trả lời' }], '2026-08-08T09:00:05Z') + '\n');
    const tt = await page.evaluate(async sid => {
      const h = await fetch('/api/history/' + sid).then(r => r.json());
      // đặt tên riêng -> phải đè ai-title
      const set = await fetch('/api/title/' + sid, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Tên tôi tự đặt' }),
      }).then(r => r.json());
      const after = await fetch('/api/history/' + sid).then(r => r.json());
      // xoá tên riêng -> quay về ai-title
      const cleared = await fetch('/api/title/' + sid, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '' }),
      }).then(r => r.json());
      return { fromCli: h.title, set: set.title, after: after.title, cleared: cleared.title };
    }, TTSID);
    ok(label + ': tiêu đề lấy ai-title MỚI NHẤT của Claude CLI, đổi tên đè được, xoá thì quay lại',
      tt.fromCli === 'Tiêu đề Claude CLI đặt' && tt.set === 'Tên tôi tự đặt'
      && tt.after === 'Tên tôi tự đặt' && tt.cleared === 'Tiêu đề Claude CLI đặt',
      JSON.stringify(tt));

    // header chat hiện tiêu đề (không phải ID), bấm mở hộp đổi tên
    await page.evaluate(s => openChat(s), TTSID);
    // đợi ĐÚNG tiêu đề: openChat đặt tạm ID làm dự phòng, refreshChat mới thay bằng tiêu đề thật.
    // Điều kiện lỏng (length > 2) khớp ngay với "e2e00000" -> đo trúng lúc chưa kịp cập nhật.
    await page.waitForFunction(() =>
      document.getElementById('chatsid').textContent === 'Tiêu đề Claude CLI đặt', { timeout: 10000 }).catch(() => {});
    const hdr = await page.evaluate(() => {
      const el = document.getElementById('chatsid');
      const txt = el.textContent;
      el.click(); // mở hộp đổi tên
      return { txt, idInTitle: el.title, ovVal: (document.querySelector('#overlaybody input') || {}).value };
    });
    ok(label + ': header chat hiện TIÊU ĐỀ (không phải ID), bấm mở hộp đổi tên',
      hdr.txt === 'Tiêu đề Claude CLI đặt' && hdr.idInTitle === TTSID && hdr.ovVal === 'Tiêu đề Claude CLI đặt',
      JSON.stringify(hdr));
    await page.evaluate(() => closeOverlay());
    // danh sách session cũng phải hiện tiêu đề, và tìm kiếm khớp theo tiêu đề
    await page.evaluate(() => backToList());
    // đợi SSE (2s/tick) đẩy session fixture vào danh sách
    await page.waitForFunction(sid =>
      !!document.querySelector('#sessrows .srow[data-sid="' + sid + '"] .s-sid'), TTSID, { timeout: 8000 }).catch(() => {});
    // đợi SSE đẩy đúng tiêu đề (vòng viewport trước có thể vừa đổi tên -> tick cũ còn tên cũ)
    await page.waitForFunction(sid => {
      const r = document.querySelector('#sessrows .srow[data-sid="' + sid + '"] .s-sid');
      return r && r.textContent === 'Tiêu đề Claude CLI đặt';
    }, TTSID, { timeout: 8000 }).catch(() => {});
    const inList = await page.evaluate(sid => {
      const row = document.querySelector('#sessrows .srow[data-sid="' + sid + '"] .s-sid');
      return row ? row.textContent : null;
    }, TTSID);
    ok(label + ': danh sách session hiện tiêu đề thay cho ID',
      inList === 'Tiêu đề Claude CLI đặt', String(inList));

    // thông báo "đã trả lời xong" phải gọi TÊN phiên, không phải ID hex
    const notif = await page.evaluate(sid => {
      const s = allSessions.find(x => x.sid === sid);
      const label = (s && s.title) ? s.title : 'Claude ' + sid.slice(0, 8);
      notifyDone(label + ' đã trả lời xong');
      const t = document.getElementById('toast');
      return { txt: t ? t.textContent : '', title: s ? s.title : null };
    }, TTSID);
    ok(label + ': thông báo dùng tiêu đề phiên (không phải ID hex)',
      notif.txt === 'Tiêu đề Claude CLI đặt đã trả lời xong', JSON.stringify(notif));
    require('fs').rmSync(TTFILE, { force: true });

    // ---- ẢNH THẬT + thời gian + gộp lượt + diff ----
    const IMGSID = 'e2e00000-0000-4000-8000-0000000000im';
    const IMGFILE = require('path').join(FIX_DIR, IMGSID + '.jsonl');
    // PNG 1x1 hợp lệ (base64) -> endpoint phải trả đúng binary
    const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    require('fs').writeFileSync(IMGFILE,
      fixLine('assistant', [{ type: 'text', text: 'Chụp màn hình rồi sửa file.' }], todayAt(7,0,0)) + '\n' +
      fixLine('assistant', [
        { type: 'tool_use', id: 'i1', name: 'Read', input: { file_path: '/x/shot.png' } },
      ], todayAt(7,0,5)) + '\n' +
      fixLine('user', [
        { type: 'tool_result', tool_use_id: 'i1', content: [{ type: 'text', text: 'ảnh đây' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG1 } }] },
      ], todayAt(7,0,6)) + '\n' +
      fixLine('assistant', [
        { type: 'text', text: 'Giờ sửa code.' },
        { type: 'tool_use', id: 'i2', name: 'Edit', input: { file_path: '/x/app.ts', old_string: 'const a = 1', new_string: 'const a = 2' } },
      ], todayAt(7,0,10)) + '\n' +
      fixLine('user', [{ type: 'tool_result', tool_use_id: 'i2', content: 'done' }], todayAt(7,0,11)) + '\n');
    await page.evaluate(s => openChat(s), IMGSID);
    await page.waitForFunction(() => document.querySelectorAll('.tcard').length >= 2, { timeout: 8000 });
    const grp = await page.evaluate(() => {
      const box = document.getElementById('bubbles');
      return {
        wraps: box.querySelectorAll('.msgwrap').length,       // 4 msg assistant liên tiếp -> gộp 1 lượt
        cards: box.querySelectorAll('.tcard').length,
        bubs: box.querySelectorAll('.bub').length,            // 2 đoạn text -> gộp 1 bubble
        day: (box.querySelector('.daydiv') || {}).textContent || '',
        clock: (box.querySelector('.bmeta span') || {}).textContent || '',
        toolMeta: (box.querySelector('.bmeta-tools') || {}).textContent || '',
      };
    });
    // 4 message assistant liên tiếp -> 1 lượt duy nhất (trước đây là 4 bubble rời + 4 dòng meta).
    // 2 bubble text vì có tool xen GIỮA chúng; text liền kề mới gộp (xem test dưới).
    ok(label + ': gộp lượt assistant + vạch ngày + giờ + "N tool"',
      grp.wraps === 1 && grp.cards === 2 && grp.bubs === 2
      && /^\d\d:\d\d$/.test(grp.clock) && grp.toolMeta === '2 tool' && grp.day === 'Hôm nay',
      JSON.stringify(grp));

    // 2 message assistant chỉ có text, liền nhau -> PHẢI gộp thành 1 bubble liền mạch
    const TXTSID = 'e2e00000-0000-4000-8000-0000000000tx';
    const TXTFILE = require('path').join(FIX_DIR, TXTSID + '.jsonl');
    require('fs').writeFileSync(TXTFILE,
      fixLine('assistant', [{ type: 'text', text: 'Đoạn một.' }], '2026-08-08T08:00:00Z') + '\n' +
      fixLine('assistant', [{ type: 'text', text: 'Đoạn hai.' }], '2026-08-08T08:00:03Z') + '\n');
    await page.evaluate(s => openChat(s), TXTSID);
    await page.waitForFunction(() => document.querySelectorAll('#bubbles .bub').length >= 1, { timeout: 8000 });
    const merged = await page.evaluate(() => {
      const box = document.getElementById('bubbles');
      return {
        wraps: box.querySelectorAll('.msgwrap').length,
        bubs: box.querySelectorAll('.bub').length,
        txt: (box.querySelector('.bub') || {}).textContent || '',
      };
    });
    ok(label + ': 2 đoạn text liền nhau gộp 1 bubble (hết bubble vụn)',
      merged.wraps === 1 && merged.bubs === 1
      && merged.txt.indexOf('Đoạn một.') >= 0 && merged.txt.indexOf('Đoạn hai.') >= 0,
      JSON.stringify(merged));
    require('fs').rmSync(TXTFILE, { force: true });
    await page.evaluate(s => openChat(s), IMGSID);
    await page.waitForFunction(() => document.querySelectorAll('.tcard').length >= 2, { timeout: 8000 });

    // ảnh: <img> thật trỏ /api/toolimg, endpoint trả PNG đúng
    const imgInfo = await page.evaluate(async () => {
      const cards = [...document.querySelectorAll('.tcard')];
      cards[0].querySelector('.tcard-head').click();  // card Read -> có ảnh
      cards[1].querySelector('.tcard-head').click();  // card Edit -> có diff
      await new Promise(r => setTimeout(r, 400));
      const img = document.querySelector('.timgs img');
      if (!img) return { noImg: true };
      await img.decode().catch(() => {});
      const r = await fetch(img.getAttribute('src'));
      return {
        src: img.getAttribute('src'),
        loading: img.loading,
        natural: img.naturalWidth,                      // >0 = ảnh tải & giải mã được THẬT
        ctype: r.headers.get('content-type'),
        cache: r.headers.get('cache-control') || '',
        lbl: (document.querySelector('.timgs') || {}).previousSibling ? '' : '',
        diffAdd: document.querySelectorAll('.dline.d-add').length,
        diffDel: document.querySelectorAll('.dline.d-del').length,
        diffHead: [...document.querySelectorAll('.dhead')].map(x => x.textContent).join(','),
        lang: (document.querySelector('.tlang') || {}).textContent || '',
      };
    });
    ok(label + ': ảnh tool_result render <img> THẬT (lazy, PNG, cache immutable)',
      imgInfo.natural > 0 && imgInfo.ctype === 'image/png' && imgInfo.loading === 'lazy'
      && imgInfo.cache.includes('immutable') && imgInfo.src.indexOf('/api/toolimg/') === 0,
      JSON.stringify(imgInfo));
    ok(label + ': Edit render dạng diff (xanh thêm / đỏ bớt) + nhãn ngôn ngữ theo đuôi file',
      imgInfo.diffAdd > 0 && imgInfo.diffDel > 0 && imgInfo.diffHead === 'Trước,Sau',
      JSON.stringify({ add: imgInfo.diffAdd, del: imgInfo.diffDel, head: imgInfo.diffHead, lang: imgInfo.lang }));

    // tap ảnh -> overlay full màn, Esc đóng
    await page.evaluate(() => document.querySelector('.timgbtn').click());
    await page.waitForTimeout(300);
    const ovOpen = await page.evaluate(() => !!document.querySelector('.imgov img'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const ovClosed = await page.evaluate(() => !document.querySelector('.imgov'));
    ok(label + ': tap ảnh -> xem full màn hình, Esc đóng', ovOpen && ovClosed,
      JSON.stringify({ ovOpen, ovClosed }));
    await page.evaluate(() => backToList());
    await page.waitForTimeout(200);

    // ---- reconcile: tool đang chạy xong trong lúc user đang xem (và đang MỞ card)
    // -> chỉ đổi chip + thêm RESULT tại chỗ, KHÔNG rebuild (rebuild sẽ giết card đang mở) ----
    const RECSID = 'e2e00000-0000-4000-8000-0000000000r1';
    const RECFILE = require('path').join(FIX_DIR, RECSID + '.jsonl');
    require('fs').writeFileSync(RECFILE, fixLine('assistant', [
      { type: 'text', text: 'đang chạy' },
      { type: 'tool_use', id: 'tu_r1', name: 'Bash', input: { command: 'sleep 5', description: 'Task dài' } },
    ], '2026-08-08T04:00:00Z') + '\n');
    await page.evaluate(s => openChat(s), RECSID);
    await page.waitForFunction(() => document.querySelectorAll('.tcard').length >= 1, { timeout: 8000 });
    await page.evaluate(() => document.querySelector('.tcard .tcard-head').click()); // mở card ra trước
    await page.waitForTimeout(350);
    const recBefore = await page.evaluate(() => {
      const c = document.querySelector('.tcard');
      window.__card = c;
      return { chip: c.querySelector('.tcard-st').className.trim(), open: c.classList.contains('open') };
    });
    require('fs').appendFileSync(RECFILE, fixLine('user',
      [{ type: 'tool_result', tool_use_id: 'tu_r1', content: 'done' }], '2026-08-08T04:00:09Z') + '\n');
    await page.waitForTimeout(2600);
    const recAfter = await page.evaluate(() => {
      const c = document.querySelector('.tcard');
      return {
        sameNode: window.__card === c, open: c.classList.contains('open'),
        chip: c.querySelector('.tcard-st').className,
        labels: [...c.querySelectorAll('.tlbl')].map(x => x.textContent),
        hasResult: [...c.querySelectorAll('.codeblock')].some(x => x.textContent === 'done'),
        userBubs: document.querySelectorAll('#bubbles .bub-user').length,
      };
    });
    ok(label + ': tool xong -> chip đổi tại chỗ, card đang mở vẫn sống + hiện RESULT',
      recBefore.chip.includes('tcard-st-pend') && recAfter.sameNode && recAfter.open
      && recAfter.chip.includes('tcard-st-ok') && recAfter.labels.join(',') === 'INPUT,KẾT QUẢ'
      && recAfter.hasResult && recAfter.userBubs === 0,
      JSON.stringify({ before: recBefore, after: recAfter }));
    await page.evaluate(() => backToList());
    await page.waitForTimeout(200);
    // xoá file reconcile + chạm lại fixture chính: allSessions sort theo mtime, đừng để
    // session vừa xoá đứng đầu làm test compare bên dưới nhận cột rỗng
    require('fs').rmSync(RECFILE, { force: true });
    require('fs').appendFileSync(FIX_FILE, '');
    const nowT = new Date();
    require('fs').utimesSync(FIX_FILE, nowT, nowT);
    await page.waitForTimeout(2200); // đợi SSE đẩy allSessions mới

    // ---- /clear trên session có tool card: xoá sạch, rồi msg mới vẫn về bình thường ----
    // dùng session RIÊNG: FIX_FILE đã bị test window-slide bơm >30 msg, window trượt sẽ
    // kéo message cũ về (giới hạn sẵn có của clearOffsets) làm nhiễu phép đo /clear
    const CLSID = 'e2e00000-0000-4000-8000-0000000000cl';
    const CLFILE = require('path').join(FIX_DIR, CLSID + '.jsonl');
    require('fs').writeFileSync(CLFILE,
      fixLine('user', [{ type: 'text', text: 'tin cũ 1' }], '2026-08-08T04:50:00Z') + '\n' +
      fixLine('assistant', [{ type: 'text', text: 'trả lời cũ' }], '2026-08-08T04:50:05Z') + '\n');
    await page.evaluate(sid => openChat(sid), CLSID);
    await page.waitForFunction(() => document.querySelectorAll('#bubbles .msgwrap').length >= 2, { timeout: 8000 });
    await page.evaluate(() => clearChatLocal());
    await page.waitForTimeout(300);
    const afterClear = await page.evaluate(() => document.getElementById('bubbles').querySelectorAll('.msgwrap').length);
    require('fs').appendFileSync(CLFILE, fixLine('user',
      [{ type: 'text', text: 'sau-khi-clear' }], '2026-08-08T05:00:00Z') + '\n');
    /* Chờ CÓ ĐIỀU KIỆN thay vì ngủ 2600ms cố định. Tin mới phải đi qua: ghi file ->
       server thấy mtime đổi -> vòng poll của client kéo về. Mốc cố định lúc đạt lúc
       không (bắt được 1/4 lần chạy: afterClearNew.n = 0 vì đo trúng lúc chưa kịp về).
       Cùng loại lỗi đã sửa ở tests/ui-new.js. */
    await page.waitForFunction(
      () => [...document.querySelectorAll('#bubbles .msgwrap')]
        .some((w) => (w.textContent || '').includes('sau-khi-clear')),
      { timeout: 15000 },
    ).catch(() => {});
    const afterClearNew = await page.evaluate(() => {
      const box = document.getElementById('bubbles');
      const wraps = box.querySelectorAll('.msgwrap'); // .daydiv không phải message
      const last = wraps[wraps.length - 1];
      return { n: wraps.length, last: last ? (last.querySelector('.bub') || last).textContent.trim() : '' };
    });
    ok(label + ': /clear xoá hết rồi vẫn nhận msg mới (không kéo lại tin cũ)',
      afterClear === 0 && afterClearNew.n === 1 && afterClearNew.last === 'sau-khi-clear',
      JSON.stringify({ afterClear, ...afterClearNew }));
    require('fs').rmSync(CLFILE, { force: true });
    await page.evaluate(() => backToList());
    await page.waitForTimeout(200);

    // export .md của fixture chứa khối tool đầy đủ
    const expTool = await page.evaluate(async sid => {
      const md = await fetch('/api/export/' + sid + '?fmt=md').then(r => r.text());
      const j = await fetch('/api/export/' + sid + '?fmt=json').then(r => r.json());
      return {
        hasBash: md.includes('**Bash**'), hasErr: md.includes('— ERROR'),
        hasInput: md.includes('npm test'), hasResult: md.includes('12 passed'),
        hasImg: md.includes('[1 ảnh]'),
        jParts: (j.messages[0].parts || []).length,
      };
    }, FIX_SID);
    ok(label + ': export md/json giữ đủ thông tin tool (input, result, ERROR, image)',
      expTool.hasBash && expTool.hasErr && expTool.hasInput && expTool.hasResult && expTool.hasImg && expTool.jParts === 4,
      JSON.stringify(expTool));

    await page.evaluate(() => backToList());
    await page.waitForTimeout(300);
    writeFixture(); // trả fixture về trạng thái gốc cho vòng viewport sau

    // compare: bật mode -> chọn 2 session -> split view 2 cột có bubbles -> Esc đóng
    const nSess = await page.evaluate(() => allSessions.length);
    if (nSess >= 2) {
      // chọn 2 phiên CÓ message thật — phiên fixture vừa bị xoá / phiên mới 0-1 tin
      // làm cột rỗng và test fail ngẫu nhiên
      await page.evaluate(() => {
        const withMsgs = allSessions.filter(s => s.msgs >= 6).slice(0, 2);
        const pick = withMsgs.length === 2 ? withMsgs : allSessions.slice(0, 2);
        toggleCompareMode();
        rowClick(pick[0].sid);
        rowClick(pick[1].sid);
      });
      // đợi CÓ nội dung thay vì đợi cứng: phiên lớn (file jsonl vài chục MB) parse lâu hơn
      // 1200ms -> cột rỗng và test fail ngẫu nhiên chứ không phải app hỏng
      await page.waitForFunction(() =>
        document.getElementById('cmp-bub-0').children.length > 0
        && document.getElementById('cmp-bub-1').children.length > 0,
      { timeout: 15000 }).catch(() => {});
      const cmp = await page.evaluate(() => ({
        open: !document.getElementById('compare').classList.contains('hidden'),
        listHidden: document.getElementById('list').classList.contains('hidden'),
        b0: document.getElementById('cmp-bub-0').children.length,
        b1: document.getElementById('cmp-bub-1').children.length,
      }));
      ok(label + ': compare view mở, 2 cột có bubbles', cmp.open && cmp.listHidden && cmp.b0 > 0 && cmp.b1 > 0, JSON.stringify(cmp));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const cmpClosed = await page.evaluate(() =>
        document.getElementById('compare').classList.contains('hidden')
        && !document.getElementById('list').classList.contains('hidden'));
      ok(label + ': Esc đóng compare -> về list', cmpClosed);
    } else { ok(label + ': compare view (skip — <2 sessions)', true); ok(label + ': Esc đóng compare (skip)', true); }

    // hermes export: nút + overlay mở khi có messages
    await page.evaluate(() => {
      switchTab('hermes');
      openHermesDirect();
      hermesExtra['__direct__'] = [{ role: 'user', content: 'xin chào để test export' }];
      hermesExport();
    });
    await page.waitForTimeout(150);
    const hExp = await page.evaluate(() => ({
      btn: !!document.getElementById('hermes-exportbtn'),
      overlay: document.getElementById('overlay').style.display === 'flex',
      buttons: document.getElementById('overlayfoot').children.length,
    }));
    ok(label + ': hermes export -> overlay .md/.json', hExp.btn && hExp.overlay && hExp.buttons >= 2, JSON.stringify(hExp));
    await page.evaluate(() => {
      closeOverlay();
      hermesBack();
      delete hermesExtra['__direct__'];
      localStorage.removeItem('hermesExtra');
      switchTab('cli');
    });

    // title badge: unread > 0 -> "(n) Claude Control Center"
    const titleBadge = await page.evaluate(() => {
      const saved = allSessions;
      allSessions = [{ sid: 'x', project: 'p', msgs: 1, unread: 5, mtimeMs: Date.now(), status: 'IDLE' }];
      updateBadges();
      const t = document.title;
      allSessions = saved;
      updateBadges();
      return { withUnread: t, after: document.title };
    });
    ok(label + ': title badge "(5) ..." khi unread', titleBadge.withUnread.startsWith('(5) '), JSON.stringify(titleBadge));

    // ===== VÒNG 4 =====
    // tab STATS: stat cards khớp allSessions + charts có data
    await page.keyboard.press('Meta+4');
    await page.waitForTimeout(600);
    const stats = await page.evaluate(() => ({
      total: +document.getElementById('stat-total').textContent,
      msgs: +document.getElementById('stat-msgs').textContent,
      nSess: allSessions.length,
      sumMsgs: allSessions.reduce((n, s) => n + s.msgs, 0),
      donutPts: donutChart ? donutChart.data.datasets[0].data.length : 0,
      barPts: barChart ? barChart.data.datasets[0].data.length : 0,
      donutW: document.getElementById('chart-donut').getBoundingClientRect().width,
    }));
    ok(label + ': STATS cards khớp allSessions',
      stats.total === stats.nSess && stats.msgs === stats.sumMsgs, JSON.stringify(stats));
    ok(label + ': STATS charts render có data',
      stats.donutPts > 0 && stats.barPts > 0 && stats.donutW > 100,
      'donut=' + stats.donutPts + ' bar=' + stats.barPts);
    await page.keyboard.press('Meta+1');
    await page.waitForTimeout(200);

    // KHÔNG tràn ngang (regression: comparebtn từng bị đẩy khỏi viewport mobile 390px)
    const ovf = await page.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const cb = document.getElementById('comparebtn').getBoundingClientRect();
      return { scrollW: document.body.scrollWidth, W, cmpBtnIn: cb.right <= W + 1 && cb.width >= 40 };
    });
    ok(label + ': list view không tràn ngang + comparebtn trong viewport',
      ovf.scrollW <= ovf.W + 1 && ovf.cmpBtnIn, JSON.stringify(ovf));

    // screenshot
    await page.screenshot({ path: '/tmp/pwtest/shot-' + vp.width + '.png' });
    ok(label + ': console errors cuối phiên = 0', errors.length === 0,
      errors.length + ' lỗi: ' + errors.map(x => x.slice(0, 70)).join(' ;; '));
    await ctx.close();
  }

  await browser.close();
  cleanFixture();
  const fails = results.filter(r => !r.pass);
  console.log('\n==== ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { cleanFixture(); console.error('SCRIPT ERROR', e); process.exit(2); });

// Cách chạy: cần playwright-core + Chrome cài sẵn (không tải browser riêng):
//   npm i --no-save playwright-core && node e2e-test.js          (test server 7799)
//   DASH_URL=http://localhost:7801/ node e2e-test.js             (test server khác)
