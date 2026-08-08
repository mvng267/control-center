// Sinh bộ icon PWA từ một file SVG nguồn.
//
// Vì sao không dùng thư viện (sharp/canvas): backend giữ zero-dependency. Playwright
// đã có sẵn cho test, nên mượn Chrome headless render SVG rồi chụp PNG — không thêm gì.
//
// Chạy: node scripts/make-icons.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'web-next', 'public');

let pw;
try { pw = require('playwright-core'); }
catch { pw = require(path.join(ROOT, 'node_modules', 'playwright-core')); }

// Logo: nền gradient xanh→tím bo góc kiểu iOS, dấu nhắc terminal >_ ở giữa.
// viewBox 512 để scale xuống mọi cỡ vẫn nét.
function logoSvg({ padding = 0 } = {}) {
  const s = 512;
  const inset = padding;          // maskable cần chừa lề an toàn ~10%
  const box = s - inset * 2;
  const r = box * 0.225;          // bo góc squircle xấp xỉ iOS
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="55%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity=".22"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${r}" fill="url(#bg)"/>
  <rect x="${inset}" y="${inset}" width="${box}" height="${box}" rx="${r}" fill="url(#gloss)"/>
  <g transform="translate(${s / 2} ${s / 2})" fill="none" stroke="#fff"
     stroke-width="${box * 0.072}" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="${-box * 0.20},${-box * 0.13} ${-box * 0.045},0 ${-box * 0.20},${box * 0.13}"/>
    <line x1="${box * 0.03}" y1="${box * 0.145}" x2="${box * 0.21}" y2="${box * 0.145}"/>
  </g>
</svg>`;
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  // maskable: Android cắt tròn/squircle -> chừa 10% lề để không cụt dấu nhắc
  { file: 'icon-maskable-512.png', size: 512, pad: 52 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
  { file: 'favicon-32.png', size: 32, pad: 0 },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'icon.svg'), logoSvg());

  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });
  for (const t of TARGETS) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
    const svg = logoSvg({ padding: t.pad });
    await page.setContent(
      `<body style="margin:0;background:transparent">
         <div style="width:${t.size}px;height:${t.size}px">${svg.replace('width="512" height="512"', `width="${t.size}" height="${t.size}"`)}</div>
       </body>`,
    );
    await page.screenshot({ path: path.join(OUT, t.file), omitBackground: true });
    await page.close();
    console.log('  ' + t.file + '  ' + t.size + 'px' + (t.pad ? ' (maskable)' : ''));
  }
  await browser.close();
  console.log('\nĐã sinh ' + (TARGETS.length + 1) + ' file vào web-next/public/');
})();
