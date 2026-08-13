#!/usr/bin/env node
/* Rà "nút chết": phần tử bấm được nhưng KHÔNG gắn handler nào.
 *
 * Vì sao cần: nút chết trông y hệt nút thường — có viền, có hover, bấm vào không
 * báo lỗi, chỉ là không xảy ra gì. Không ai phát hiện cho tới lúc cần dùng thật.
 * Đã bắt được nút "Lọc" ở màn danh sách phiên (commit cee39fa).
 *
 * Vì sao quét trên TRANG THẬT chứ không đọc source: handler có thể bị điều kiện
 * loại bỏ lúc chạy (truyền undefined, nhánh sớm...), source vẫn thấy onClick.
 *
 * Dùng:  node scripts/dead-buttons.js [url]
 * Mặc định http://localhost:7799/
 */
const path = require('path');
const pw = require(path.join(__dirname, '..', 'node_modules', 'playwright-core'));

/* Nhận URL qua tham số dòng lệnh HOẶC biến DASH_URL. Trước đây chỉ đọc argv, mà
   scripts/test-all.js lại truyền bằng DASH_URL — nên bộ này luôn quét server 7799
   thay vì server tạm mà test-all vừa dựng. Không lộ ra vì máy Vinh gần như lúc nào
   cũng có dashboard chạy sẵn ở 7799; tắt nó đi là bộ này ném ECONNREFUSED. */
const URL = process.argv[2] || process.env.DASH_URL || 'http://localhost:7799/';
const TABS = ['cli', 'hermes', 'agy', 'stats'];

(async () => {
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  let total = 0;
  try {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    for (const tab of TABS) {
      await page.evaluate((id) => document.querySelector('[data-testid=nav-' + id + ']')?.click(), tab);
      await page.waitForTimeout(2200);

      const dead = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('button, [role=button]')) {
          if (!el.offsetParent || el.disabled) continue;   // ẩn hoặc đã tắt
          if (el.closest('a') || el.type === 'submit') continue;
          // React gắn handler qua props nội bộ chứ không đặt onclick lên DOM
          const key = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
          const props = key ? el[key] : null;
          const song = !!(el.onclick || (props && (props.onClick || props.onPointerDown
            || props.onMouseDown || props.onKeyDown || props.onSelect)));
          if (!song) out.push({
            testid: el.getAttribute('data-testid') || '',
            chu: (el.innerText || el.getAttribute('title') || '').trim().slice(0, 40),
          });
        }
        return out;
      });

      total += dead.length;
      console.log(tab + ':', dead.length ? JSON.stringify(dead) : 'không có nút chết');
    }
  } finally {
    await browser.close();
  }
  console.log(total ? `\n==> CÓ ${total} NÚT CHẾT` : '\n==> Sạch, không nút chết nào');
  process.exit(total ? 1 : 0);
})();
