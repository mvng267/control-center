// Test safe-area iPhone — chạy: PORT=7899 node src/server/index.js & DASH_URL=http://localhost:7899/ node tests/safearea.js
//
// Chromium KHÔNG giả lập env(safe-area-inset-bottom) (luôn = 0) nên test thường "PASS"
// mà máy thật vẫn hỏng: thanh tab nằm ĐÈ lên home indicator, bấm không trúng.
// Ở đây tự bơm 34px như iPhone 15 Pro rồi ĐO boundingBox thật.
//
// Bộ này từng viết cho giao diện cũ (#sidenav, #tabbtn-cli) — đã viết lại theo
// data-testid của giao diện hiện tại sau khi bỏ web/legacy.
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { ({ chromium } = require(require('path').join(process.cwd(), 'node_modules', 'playwright-core'))); }
const URL = process.env.DASH_URL || 'http://localhost:7799/';
const INSET = 34; // home indicator iPhone 15 Pro
const results = [];
const ok = (name, pass, extra) => {
  results.push(pass);
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra !== undefined ? ' | ' + extra : ''));
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // ---- iPhone 15 Pro ----
  const VP = { width: 393, height: 852 };
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=tabbar]', { timeout: 30000 });
  await page.waitForTimeout(1200);

  let nav = await page.locator('[data-testid=tabbar]').boundingBox();
  ok('iPhone: thanh tab rộng hết màn và bám đáy (inset=0)',
    !!nav && Math.abs(nav.x) < 1 && Math.abs(nav.width - VP.width) < 1
      && Math.abs(nav.y + nav.height - VP.height) < 1,
    nav ? `x=${Math.round(nav.x)} w=${Math.round(nav.width)} đáy=${Math.round(nav.y + nav.height)}` : 'không thấy');

  /* Bơm 34px như iOS standalone thật. Chromium trả env(safe-area-inset-bottom)=0 nên
     không bơm thì bài luôn xanh dù máy thật hỏng — đó chính là lý do bộ này tồn tại. */
  await page.addStyleTag({ content:
    `[data-testid=tabbar] { padding-bottom: ${INSET}px !important; }` });
  await page.waitForTimeout(400);

  nav = await page.locator('[data-testid=tabbar]').boundingBox();
  ok('iPhone+inset34: thanh tab vẫn bám đáy, không bị cắt',
    !!nav && Math.abs(nav.y + nav.height - VP.height) < 1,
    nav ? `đáy=${Math.round(nav.y + nav.height)} vs màn=${VP.height}` : 'không thấy');

  /* Nút tab phải nằm TRÊN vùng home indicator. Nằm đè lên thì vuốt lên đóng app thay
     vì bấm trúng nút — lỗi chỉ lộ trên máy thật. */
  const nut = await page.locator('[data-testid=tabbar-cli]').boundingBox();
  ok(`iPhone+inset34: nút tab nằm TRÊN home indicator (đáy <= ${VP.height - INSET})`,
    !!nut && nut.y + nut.height <= VP.height - INSET + 0.5,
    nut ? String(Math.round(nut.y + nut.height)) : 'không thấy');

  // ---- safe-area TRÊN (notch) ở khung chat ----
  await page.locator('[data-testid=session-row]').first().click();
  await page.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
  await page.waitForTimeout(1000);
  const dauChat = await page.evaluate(() => {
    const e = document.querySelector('[data-testid=chat-back]');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { y: Math.round(r.y), cao: Math.round(r.height) };
  });
  /* Nút back phải cách mép trên đủ để không chui vào notch. Trang đặt
     paddingTop: calc(env(safe-area-inset-top) + 10px) — Chromium cho env=0 nên chỉ
     chốt được nó KHÔNG dính sát mép (>= 8px). */
  ok('iPhone: nút back trong chat không dính sát mép trên',
    !!dauChat && dauChat.y >= 8, dauChat ? `y=${dauChat.y}` : 'không thấy');

  await page.screenshot({ path: '/tmp/safearea-iphone15pro.png' });
  console.log('ảnh chụp: /tmp/safearea-iphone15pro.png');
  await ctx.close();

  // ---- desktop: sidebar trái KHÔNG fixed, thanh tab dưới biến mất ----
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dpage = await dctx.newPage();
  await dpage.goto(URL, { waitUntil: 'networkidle' });
  await dpage.waitForTimeout(1500);
  const d = await dpage.evaluate(() => {
    const sb = document.querySelector('[data-testid=sidebar]');
    const tb = document.querySelector('[data-testid=tabbar]');
    if (!sb) return null;
    const r = sb.getBoundingClientRect();
    return {
      pos: getComputedStyle(sb).position,
      x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height),
      tabHien: tb ? !!tb.offsetParent : false,
    };
  });
  ok('desktop: sidebar trái không fixed, thanh tab dưới ẩn',
    !!d && d.pos !== 'fixed' && d.x < 1 && d.h > 300 && d.tabHien === false,
    d ? `pos=${d.pos} x=${d.x} w=${d.w} tabHien=${d.tabHien}` : 'không thấy sidebar');
  await dctx.close();

  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log(`---- ${pass}/${results.length} PASS ----`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
