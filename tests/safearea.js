// Test safe-area tab bar mobile — chạy: PORT=7801 node src/server/index.js & DASH_URL=http://localhost:7801/ node tests/safearea.js
// Chromium KHÔNG giả lập env(safe-area-inset-bottom) (luôn = 0) nên e2e cũ "PASS" mà máy thật vẫn hỏng.
// Ở đây: (1) assert #sidenav position:fixed bám đáy viewport, (2) inject 34px giả lập home indicator
// iPhone 15 Pro rồi ĐO boundingBox: tab button phải nằm TRÊN vùng 34px, input bar không bị tab bar đè.
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { ({ chromium } = require(require('path').join(process.cwd(), 'node_modules', 'playwright-core'))); }
const URL = process.env.DASH_URL || 'http://localhost:7799/';
const INSET = 34; // home indicator iPhone 15 Pro
const results = [];
const ok = (name, pass, extra) => { results.push(pass); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra !== undefined ? ' | ' + extra : '')); };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // ---- iPhone 15 Pro 393x852 ----
  const VP = { width: 393, height: 852 };
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const pos = await page.evaluate(() => getComputedStyle(document.getElementById('sidenav')).position);
  ok('mobile: #sidenav position === fixed', pos === 'fixed', pos);

  let nav = await page.locator('#sidenav').boundingBox();
  ok('mobile: tab bar full-width bám đáy viewport (env=0)',
    nav && Math.abs(nav.x) < 1 && Math.abs(nav.width - VP.width) < 1 && Math.abs(nav.y + nav.height - VP.height) < 1,
    JSON.stringify(nav));

  // giả lập env(safe-area-inset-bottom)=34px như iOS standalone thật
  await page.addStyleTag({ content: [
    '#sidenav { padding-bottom: ' + INSET + 'px !important; }',
    '#content { padding-bottom: calc(64px + ' + INSET + 'px) !important; }',
  ].join('\n') });
  await page.waitForTimeout(300);

  nav = await page.locator('#sidenav').boundingBox();
  ok('mobile+inset34: tab bar vẫn bám đáy, không bị cắt',
    nav && Math.abs(nav.y + nav.height - VP.height) < 1, JSON.stringify(nav));

  const btn = await page.locator('#tabbtn-cli').boundingBox();
  ok('mobile+inset34: tab button nằm TRÊN home indicator (bottom <= ' + (VP.height - INSET) + ')',
    btn && btn.y + btn.height <= VP.height - INSET + 0.5, btn && (btn.y + btn.height));

  const inputbar = await page.locator('#list .safepad').boundingBox();
  ok('mobile+inset34: input bar không bị tab bar fixed đè (bottom <= nav.top)',
    inputbar && nav && inputbar.y + inputbar.height <= nav.y + 0.5,
    inputbar && nav && (inputbar.y + inputbar.height) + ' vs nav.y=' + nav.y);

  await page.screenshot({ path: '/tmp/safearea-iphone15pro.png' });
  console.log('screenshot: /tmp/safearea-iphone15pro.png');
  await ctx.close();

  // ---- desktop 1440x900: sidebar trái giữ nguyên, KHÔNG fixed ----
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dpage = await dctx.newPage();
  await dpage.goto(URL, { waitUntil: 'networkidle' });
  await dpage.waitForTimeout(1500);
  const dpos = await dpage.evaluate(() => getComputedStyle(document.getElementById('sidenav')).position);
  const dnav = await dpage.locator('#sidenav').boundingBox();
  ok('desktop: sidebar trái không fixed', dpos !== 'fixed' && dnav && dnav.x < 1 && dnav.width < 120 && dnav.height > 300,
    dpos + ' ' + JSON.stringify(dnav));
  await dctx.close();

  await browser.close();
  const fails = results.filter(p => !p).length;
  console.log('---- ' + (results.length - fails) + '/' + results.length + ' PASS ----');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
