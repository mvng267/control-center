// Test soft keyboard iOS — chạy: PORT=7802 node claude-dashboard.js & DASH_URL=http://localhost:7802/ node kb-test.js
// Chromium KHÔNG giả lập được bàn phím ảo iOS (visualViewport không co) -> fake visualViewport
// bằng addInitScript TRƯỚC khi script trang chạy, rồi bơm resize như iOS thật:
// height co 336px (bàn phím iPhone), đo boundingBox input bar phải nằm TRÊN mép bàn phím.
let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { ({ chromium } = require(require('path').join(process.cwd(), 'node_modules', 'playwright-core'))); }
const URL = process.env.DASH_URL || 'http://localhost:7799/';
const VP = { width: 393, height: 852 }; // iPhone 15 Pro
const KB = 336; // bàn phím tiếng Việt iOS ~336px (gồm cả suggestion bar)
const results = [];
const ok = (name, pass, extra) => { results.push(pass); console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra !== undefined ? ' | ' + extra : '')); };

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();

  // fake visualViewport: page script capture window.visualViewport lúc parse -> phải define trước load
  await page.addInitScript(() => {
    const listeners = {};
    let h = null;
    const fake = {
      offsetTop: 0, offsetLeft: 0, scale: 1,
      get width() { return window.innerWidth; },
      get height() { return h == null ? window.innerHeight : h; },
      set height(v) { h = v; },
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      removeEventListener() {},
      dispatch(t) { (listeners[t] || []).forEach(fn => fn({})); },
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  const kbTop = VP.height - KB;
  const fireKb = (height) => page.evaluate(hh => {
    window.visualViewport.height = hh;
    window.visualViewport.dispatch('resize');
  }, height);

  // ---- 1. list view: bàn phím bật -> --kb + kb-open + input bar (taskinput) trên bàn phím ----
  await page.focus('#taskinput');
  await fireKb(VP.height - KB);
  await page.waitForTimeout(500); // rAF + transition 150ms + focus timeout 250ms

  const state = await page.evaluate(() => ({
    kb: getComputedStyle(document.documentElement).getPropertyValue('--kb').trim(),
    open: document.body.classList.contains('kb-open'),
    pad: getComputedStyle(document.getElementById('content')).paddingBottom,
  }));
  ok('kb bật: body.kb-open + --kb=' + KB + 'px', state.open && state.kb === KB + 'px', JSON.stringify(state));
  ok('kb bật: #content padding-bottom = --kb (thay reserve tab bar)', state.pad === KB + 'px', state.pad);

  let bar = await page.locator('#list .safepad').boundingBox();
  ok('kb bật: input bar (taskinput) nằm TRÊN bàn phím (bottom <= ' + kbTop + ')',
    bar && bar.y + bar.height <= kbTop + 0.5, bar && 'bottom=' + (bar.y + bar.height) + ' vs kbTop=' + kbTop);
  const inp = await page.locator('#taskinput').boundingBox();
  ok('kb bật: #taskinput visible trên bàn phím', inp && inp.y >= 0 && inp.y + inp.height <= kbTop + 0.5,
    inp && 'bottom=' + (inp.y + inp.height));

  await page.screenshot({ path: '/tmp/kb-list-open.png' });

  // ---- 2. chat view: bubbles nhiều + focus #chatinput -> auto-scroll xuống cuối ----
  await page.evaluate(() => {
    document.getElementById('list').classList.add('hidden');
    const chat = document.getElementById('chat');
    chat.classList.remove('hidden');
    chat.classList.add('flex');
    const box = document.getElementById('bubbles');
    box.style.scrollBehavior = 'auto'; // test đo tức thì, khỏi đợi smooth animate
    for (let i = 0; i < 40; i++) {
      const d = document.createElement('div');
      d.className = 'bub ai';
      d.textContent = 'msg ' + i;
      d.style.padding = '14px';
      box.appendChild(d);
    }
    box.scrollTop = 0; // giả lập đang đọc tin cũ phía trên
  });
  await page.focus('#chatinput');
  await fireKb(VP.height - KB); // iOS fire resize lại khi focus input mới
  await page.waitForTimeout(500);

  const scrolled = await page.evaluate(() => {
    const b = document.getElementById('bubbles');
    return { top: b.scrollTop, h: b.scrollHeight, c: b.clientHeight };
  });
  ok('chat: focus #chatinput + kb bật -> #bubbles cuộn xuống cuối',
    scrolled.h - scrolled.top - scrolled.c < 5, JSON.stringify(scrolled));

  bar = await page.locator('#chat .safepad').boundingBox();
  ok('chat: input bar (chatinput) nằm TRÊN bàn phím (bottom <= ' + kbTop + ')',
    bar && bar.y + bar.height <= kbTop + 0.5, bar && 'bottom=' + (bar.y + bar.height));
  const bub = await page.locator('#bubbles').boundingBox();
  ok('chat: vùng bubbles không bị bàn phím che (bottom <= kbTop)',
    bub && bub.y + bub.height <= kbTop + 0.5, bub && 'bottom=' + (bub.y + bub.height));

  await page.screenshot({ path: '/tmp/kb-chat-open.png' });

  // ---- 3. tắt bàn phím -> reset về layout thường (reserve tab bar + safe-area) ----
  await fireKb(VP.height);
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    kb: getComputedStyle(document.documentElement).getPropertyValue('--kb').trim(),
    open: document.body.classList.contains('kb-open'),
  }));
  ok('kb tắt: kb-open gỡ + --kb=0px', !after.open && after.kb === '0px', JSON.stringify(after));
  bar = await page.locator('#chat .safepad').boundingBox();
  const nav = await page.locator('#sidenav').boundingBox();
  ok('kb tắt: input bar về trên tab bar như cũ', bar && nav && bar.y + bar.height <= nav.y + 0.5,
    bar && nav && 'bottom=' + (bar.y + bar.height) + ' vs nav.y=' + nav.y);

  await ctx.close();
  await browser.close();
  const fails = results.filter(p => !p).length;
  console.log('---- ' + (results.length - fails) + '/' + results.length + ' PASS ----');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
