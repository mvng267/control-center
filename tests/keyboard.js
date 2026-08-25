// Test bàn phím ảo iOS — chạy: PORT=7899 node src/server/index.js & DASH_URL=http://localhost:7899/ node tests/keyboard.js
//
// Chromium KHÔNG giả lập được bàn phím ảo iOS (visualViewport không co) -> tự dựng
// visualViewport giả bằng addInitScript TRƯỚC khi script trang chạy, rồi bơm resize
// như iOS thật: chiều cao co 336px, đo boundingBox ô nhập phải nằm TRÊN mép bàn phím.
//
// Vì sao đáng có bộ riêng: CLAUDE.md ghi đây là bẫy đã gặp thật — trên iOS layout
// viewport KHÔNG co khi bàn phím bật, kể cả dùng dvh, nên ô nhập nằm sau bàn phím.
// lib/use-soft-keyboard.ts đo visualViewport rồi bơm biến --kb để layout tự trừ.
//
// Bộ này từng viết cho giao diện cũ (#taskinput, #bubbles, #sidenav) — đã viết lại
// theo data-testid của giao diện hiện tại sau khi bỏ web/legacy.
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { ({ chromium } = require(require('path').join(process.cwd(), 'node_modules', 'playwright-core'))); }
const URL = process.env.DASH_URL || 'http://localhost:7799/';
const VP = { width: 393, height: 852 }; // iPhone 15 Pro
const KB = 336; // bàn phím tiếng Việt iOS ~336px (gồm cả thanh gợi ý)
const results = [];
const ok = (name, pass, extra) => {
  results.push(pass);
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra !== undefined ? ' | ' + extra : ''));
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();

  // Trang đọc window.visualViewport lúc parse -> phải định nghĩa TRƯỚC khi load
  await page.addInitScript(() => {
    const listeners = {};
    const fake = {
      width: window.innerWidth, height: window.innerHeight, offsetTop: 0, scale: 1,
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      removeEventListener(t, fn) {
        listeners[t] = (listeners[t] || []).filter((f) => f !== fn);
      },
      dispatch(t) { (listeners[t] || []).forEach((fn) => fn({})); },
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=session-row]', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const kbTop = VP.height - KB;
  const bomKb = (h) => page.evaluate((hh) => {
    window.visualViewport.height = hh;
    window.visualViewport.dispatch('resize');
  }, h);

  // ---- Mở một phiên rồi bật bàn phím ----
  await page.locator('[data-testid=session-row]').first().click();
  await page.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
  await page.waitForTimeout(1200);

  await page.focus('[data-testid=chat-input]');
  await bomKb(kbTop);
  await page.waitForTimeout(700);   // rAF + transition + timeout focus

  const trangThai = await page.evaluate(() => ({
    kb: getComputedStyle(document.documentElement).getPropertyValue('--kb').trim(),
    moKb: document.body.classList.contains('kb-open'),
  }));
  ok('bàn phím bật: --kb = chiều cao bàn phím', trangThai.kb === KB + 'px', trangThai.kb);
  ok('bàn phím bật: body có class kb-open', trangThai.moKb === true, String(trangThai.moKb));

  /* Điều quan trọng nhất: ô nhập phải nằm TRÊN mép bàn phím. Sai chỗ này thì gõ mà
     không thấy mình gõ gì — đúng lỗi CLAUDE.md ghi. */
  const oNhap = await page.locator('[data-testid=chat-input]').boundingBox();
  ok('bàn phím bật: ô nhập nằm TRÊN bàn phím',
    !!oNhap && oNhap.y >= 0 && oNhap.y + oNhap.height <= kbTop + 1,
    oNhap ? `đáy=${Math.round(oNhap.y + oNhap.height)} vs mépKb=${kbTop}` : 'không thấy ô nhập');

  /* Thanh tab dưới phải ẨN khi bàn phím bật: màn 852px trừ 336px bàn phím còn ~500px,
     giữ thêm 58px thanh tab là cướp chỗ đọc chat. */
  const tabBar = await page.evaluate(() => {
    const e = document.querySelector('[data-testid=tabbar]');
    return e ? !!e.offsetParent : null;
  });
  ok('bàn phím bật: thanh tab dưới ẩn đi (nhường chỗ)', tabBar === false || tabBar === null,
    String(tabBar));

  // vùng chat không bị bàn phím che
  const khungChat = await page.locator('[data-testid=chat-bubbles]').boundingBox();
  ok('bàn phím bật: vùng chat không bị che',
    !!khungChat && khungChat.y + khungChat.height <= kbTop + 1,
    khungChat ? `đáy=${Math.round(khungChat.y + khungChat.height)}` : 'không thấy');

  // ---- Tắt bàn phím: mọi thứ về như cũ ----
  await bomKb(VP.height);
  await page.waitForTimeout(700);
  const sauTat = await page.evaluate(() => ({
    kb: getComputedStyle(document.documentElement).getPropertyValue('--kb').trim(),
    moKb: document.body.classList.contains('kb-open'),
  }));
  ok('bàn phím tắt: --kb về 0', sauTat.kb === '0px', sauTat.kb);
  ok('bàn phím tắt: gỡ class kb-open', sauTat.moKb === false, String(sauTat.moKb));

  await browser.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n---- ${pass}/${results.length} PASS ----`);
  process.exit(pass === results.length ? 0 : 1);
})().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1); });
