// E2E smoke test dashboard: mobile + desktop, console errors, PWA, shortcuts, palette, flicker
// resolve playwright-core: node_modules cạnh script HOẶC theo cwd (npm i --no-save ở đâu cũng chạy)
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { ({ chromium } = require(require('path').join(process.cwd(), 'node_modules', 'playwright-core'))); }
const URL = process.env.DASH_URL || 'http://localhost:7799/';
const results = [];
const ok = (name, pass, extra) => { results.push({ name, pass, extra }); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : '')); };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  for (const [label, vp] of [['mobile 390x844', { width: 390, height: 844 }], ['desktop 1440x900', { width: 1440, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
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
    ok(label + ': agy status hiển thị', agyStatus === 'ON' || agyStatus === 'OFF', agyStatus);
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
    // fetch 404 CHỦ Ý ở trên in console error "Failed to load resource ... 404" -> loại khỏi đếm cuối phiên
    const i404 = errors.findIndex(x => x.includes('404'));
    if (i404 >= 0) errors.splice(i404, 1);

    // nút export trong chat view Claude
    if (expSid) {
      await page.evaluate(sid => openChat(sid), expSid);
      await page.waitForTimeout(400);
      const expBtn = await page.evaluate(() => !!document.getElementById('exportbtn'));
      ok(label + ': chat view có nút export', expBtn);
      await page.evaluate(() => backToList());
    } else ok(label + ': nút export chat view (skip)', true);

    // compare: bật mode -> chọn 2 session -> split view 2 cột có bubbles -> Esc đóng
    const nSess = await page.evaluate(() => allSessions.length);
    if (nSess >= 2) {
      await page.evaluate(() => {
        toggleCompareMode();
        rowClick(allSessions[0].sid);
        rowClick(allSessions[1].sid);
      });
      await page.waitForTimeout(1000);
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
    ok(label + ': console errors cuối phiên = 0', errors.length === 0, errors.slice(0, 3).join(' ;; '));
    await ctx.close();
  }

  await browser.close();
  const fails = results.filter(r => !r.pass);
  console.log('\n==== ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });

// Cách chạy: cần playwright-core + Chrome cài sẵn (không tải browser riêng):
//   npm i --no-save playwright-core && node e2e-test.js          (test server 7799)
//   DASH_URL=http://localhost:7801/ node e2e-test.js             (test server khác)
