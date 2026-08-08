// E2E Web Push với Chrome THẬT + FCM THẬT:
// 1. Chrome (persistent context + CDP grant notifications/push) mở dashboard localhost
// 2. setupPush() của app subscribe FCM thật -> server lưu subscription
// 3. Đóng tab (không còn client visible) -> POST /api/push/send -> server mã hoá
//    RFC 8291 + VAPID -> fcm.googleapis.com -> FCM đẩy về Chrome -> SW showNotification
// 4. Mở lại origin -> registration.getNotifications() phải thấy notification thật
// Usage: node push-browser-test.js
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { ({ chromium } = require(require('path').join(process.cwd(), 'node_modules', 'playwright-core'))); }
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const DASH_PORT = 7797;
const BASE = 'http://localhost:' + DASH_PORT;
const STATE_FILE = path.join(__dirname, '.push-state.test.json');
const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
};

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {} }, res => {
      let buf = '';
      res.on('data', d => { buf += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });
}

(async () => {
  try { fs.unlinkSync(STATE_FILE); } catch {}
  const dash = spawn('node', [path.join(__dirname, '..', 'src', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(DASH_PORT), PUSH_STATE_FILE: STATE_FILE },
    stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await new Promise(r => setTimeout(r, 200));
    try { up = (await req('GET', BASE + '/api/push/vapid')).status === 200; } catch {}
  }
  // dash chết = port 7797 bận (server sót từ lần trước) -> up có thể true nhưng là server KHÁC
  if (!up || dash.exitCode !== null) {
    console.error('dashboard không lên (port ' + DASH_PORT + ' bận? kill process cũ rồi chạy lại)');
    dash.kill();
    process.exit(1);
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-push-'));
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
  const page = ctx.pages()[0] || await ctx.newPage();
  // Quyền push cần grant qua CDP (Playwright grantPermissions không có 'push')
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Browser.setPermission', { origin: BASE, permission: { name: 'notifications' }, setting: 'granted' });
  await cdp.send('Browser.setPermission', { origin: BASE, permission: { name: 'push', userVisibleOnly: true }, setting: 'granted' });

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok('quyền notification granted', await page.evaluate(() => Notification.permission) === 'granted');

  // setupPush của app tự chạy sau SW register — đợi subscription xuất hiện
  const subInfo = await page.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      for (let i = 0; i < 30; i++) {
        const s = await reg.pushManager.getSubscription();
        if (s) return { ok: true, endpoint: s.endpoint };
        await setupPush();
        await new Promise(r => setTimeout(r, 500));
      }
      return { ok: false, error: 'không có subscription sau 15s' };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ok('app subscribe push service THẬT (FCM)', subInfo.ok, (subInfo.endpoint || subInfo.error || '').slice(0, 60));

  if (subInfo.ok) {
    // đợi POST /api/push/subscribe về server (setupPush nền POST sau khi subscribe FCM)
    let saved = false;
    for (let i = 0; i < 20 && !saved; i++) {
      await page.waitForTimeout(500);
      try { saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).subs.some(s => s.endpoint === subInfo.endpoint); } catch {}
    }
    ok('server lưu subscription', saved);

    // Rời origin -> không còn client visible -> SW phải showNotification khi push đến
    await page.goto('about:blank');
    const sendResp = JSON.parse((await req('POST', BASE + '/api/push/send', {
      title: 'Claude Control', body: 'Push test qua FCM thật', tag: 'ccc-e2e',
    })).body);
    ok('FCM chấp nhận push (2xx)', sendResp.sent === 1 && sendResp.total === 1, JSON.stringify(sendResp.results));

    // Đợi FCM deliver TRONG LÚC vẫn ở blank (quay lại sớm = client visible -> SW skip, đúng
    // thiết kế nhưng làm test flaky) -> đợi hẳn 6s rồi mới quay lại hỏi getNotifications
    let shown = null;
    for (let i = 0; i < 5 && !shown; i++) {
      await page.waitForTimeout(6000);
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      shown = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        const list = await reg.getNotifications();
        return list.length ? { title: list[0].title, body: list[0].body } : null;
      });
      if (!shown) await page.goto('about:blank'); // chưa đến -> rời tab đợi tiếp
    }
    ok('notification THẬT hiển thị (qua FCM -> SW)', !!shown && shown.title === 'Claude Control', JSON.stringify(shown));

    // dọn: unsubscribe để không giữ sub FCM rác
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const s = await reg.pushManager.getSubscription();
      if (s) await s.unsubscribe();
      (await reg.getNotifications()).forEach(n => n.close());
    });
  }

  await ctx.close();
  dash.kill();
  try { fs.unlinkSync(STATE_FILE); } catch {}
  fs.rmSync(profile, { recursive: true, force: true });
  const pass = results.filter(r => r.pass).length;
  console.log('\n== BROWSER PUSH TEST: ' + pass + '/' + results.length + ' PASS ==');
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(1); });
