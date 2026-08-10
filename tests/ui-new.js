/* Test tự động cho GIAO DIỆN MỚI (web-next).
   Bộ e2e.js sẵn có chỉ chạy trên bản legacy (NEW_UI=0) — toàn bộ tính năng làm mới
   trong đợt này chưa có test nào, mà docs/FEATURES.md ghi 19 mục "kiểm bằng tay".
   Phần lớn trong đó tự động hoá được; file này làm việc đó.

   Cách chạy:  node tests/ui-new.js            (server 7799)
               DASH_URL=http://localhost:7801/ node tests/ui-new.js
*/
let pw;
try { pw = require('playwright-core'); }
catch { pw = require(require('path').join(process.cwd(), 'node_modules', 'playwright-core')); }

const fs = require('fs');
const path = require('path');
const os = require('os');

const URL = process.env.DASH_URL || 'http://localhost:7799/';
const PASS_FILE = path.join(os.homedir(), '.claude', 'dashboard-passcode.json');
const TOKEN_FILE = path.join(os.homedir(), '.claude', 'dashboard-token.json');
const layToken = () => {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token || ''; } catch { return ''; }
};
const PUSH_FILE = path.join(process.cwd(), '.push-state.json');

const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
};

// Passcode phải KHÔNG tồn tại lúc bắt đầu, nếu không mọi màn đều bị màn khoá che.
// Lưu lại bản cũ (nếu Vinh đang đặt mã thật) rồi trả về đúng như cũ ở cuối.
let passBackup = null;
function gomPasscode() {
  try { passBackup = fs.readFileSync(PASS_FILE, 'utf8'); } catch { passBackup = null; }
  try { fs.rmSync(PASS_FILE, { force: true }); } catch {}
}
function traPasscode() {
  try {
    if (passBackup) fs.writeFileSync(PASS_FILE, passBackup, { mode: 0o600 });
    else fs.rmSync(PASS_FILE, { force: true });
  } catch {}
}

/* Trả mã KỂ CẢ KHI CHẾT GIỮA CHỪNG. Trước đây traPasscode chỉ chạy ở cuối hàm main,
   nên hễ bộ này ném lỗi (Playwright timeout chẳng hạn) là file mã do chính nó tạo
   nằm lại trong ~/.claude — LẦN CHẠY SAU của e2e gặp màn khoá và fail 423 hàng loạt.
   Mất cả buổi tưởng e2e hỏng, thật ra là rác của ui-new để lại. */
let daTra = false;
const traMotLan = () => { if (!daTra) { daTra = true; traPasscode(); } };
process.on('exit', traMotLan);
process.on('uncaughtException', (e) => { traMotLan(); console.error(e); process.exit(1); });
process.on('unhandledRejection', (e) => { traMotLan(); console.error(e); process.exit(1); });
process.on('SIGINT', () => { traMotLan(); process.exit(130); });

const TABS = ['cli', 'hermes', 'agy', 'docker', 'stats'];

(async () => {
  gomPasscode();
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true });

  /* ---------- A. Desktop: 5 tab, không lỗi, không tràn ngang ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.slice(0, 80)));
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    for (const t of TABS) {
      await page.click(`[data-testid=nav-${t}]`);
      await page.waitForTimeout(1600);
      const m = await page.evaluate(() => ({
        tran: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        coHeader: !!document.querySelector('[data-testid=page-header]'),
      }));
      ok(`desktop /${t}: không tràn ngang + có page header`, !m.tran && m.coHeader);
    }

    // Vỏ khớp Atlas — số đo trong memory/atlas-theme.md
    const shell = await page.evaluate(() => {
      const cs = (e) => getComputedStyle(e);
      const side = document.querySelector('[data-testid=sidebar]');
      const item = document.querySelector('[data-testid=nav-cli]');
      const head = document.querySelector('header');
      return {
        w: Math.round(side.getBoundingClientRect().width),
        vien: cs(side).borderRightWidth,
        muc: Math.round(item.getBoundingClientRect().height),
        bo: cs(item).borderRadius,
        head: Math.round(head.getBoundingClientRect().height),
      };
    });
    ok('vỏ khớp Atlas (sidebar 256/không viền, mục 32/bo 8, header 64)',
      shell.w === 256 && shell.vien === '0px' && shell.muc === 32
      && shell.bo === '8px' && shell.head === 64, JSON.stringify(shell));

    // Chart: lưới nét đứt 4 8, KHÔNG có trục Y (Atlas không có)
    await page.click('[data-testid=nav-stats]');
    await page.waitForTimeout(2200);
    const chart = await page.evaluate(() => {
      const gl = document.querySelector('.recharts-cartesian-grid line');
      return {
        luoi: gl ? (gl.getAttribute('stroke-dasharray') || getComputedStyle(gl).strokeDasharray) : '',
        trucY: document.querySelectorAll('.recharts-yAxis').length,
        spark: document.querySelectorAll('[data-testid=spark]').length,
      };
    });
    ok('chart theo Atlas: lưới "4 8", 0 trục Y, 4 sparkline',
      chart.luoi.replace(/px|,/g, '').trim() === '4 8' && chart.trucY === 0 && chart.spark === 4,
      JSON.stringify(chart));

    ok('không lỗi console (desktop)', errs.length === 0, errs[0] || '');
    await ctx.close();
  }

  /* ---------- B. Thẻ tool mở ra KHÔNG tự đóng khi poll ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=session-row]', { timeout: 15000 });
    await page.waitForTimeout(1200);
    // Chọn phiên ĐÃ NGHỈ: phiên đang chạy thì cửa sổ 30 tin trượt liên tục, thẻ tool
    // rời khỏi danh sách và biến mất — đó là dữ liệu đổi, không phải mất trạng thái mở.
    const idx = await page.evaluate(() => {
      const rs = [...document.querySelectorAll('[data-testid=session-row]')].filter((r) => r.offsetParent);
      const i = rs.findIndex((r) => !['RUNNING', 'ACTIVE'].includes(r.dataset.status));
      return i < 0 ? 0 : i;
    });
    await page.locator('[data-testid=session-row]:visible').nth(idx).click();
    await page.waitForSelector('[data-testid=chat-view]', { timeout: 15000 });
    await page.waitForTimeout(2000);

    const n = await page.locator('[data-testid=tool-card]').count();
    if (!n) {
      ok('thẻ tool giữ mở qua nhiều vòng poll', true, 'bỏ qua: phiên không có tool');
    } else {
      const card = page.locator('[data-testid=tool-card]').first();
      const tid = await card.getAttribute('data-tid');
      /* Bấm đúng NÚT, đừng bấm giữa thẻ. Bản viết lại tách nút gập thành một hàng
         cao 21px, còn cả thẻ cao 85px vì có sẵn dòng ⎿ kết quả bên dưới — bấm giữa
         thẻ là trượt xuống vùng kết quả, không toggle gì cả. Đo được: bấm giữa thẻ
         -> data-open vẫn false; bấm vào nút -> true. */
      await page.locator('[data-testid=tool-card-head]').first().click();
      await page.waitForTimeout(500);
      const mo1 = await card.getAttribute('data-open');
      // 8s > nhiều vòng poll (700ms khi chạy / 2s khi rảnh)
      await page.waitForTimeout(8000);
      const mo2 = await page.locator(`[data-tid="${tid}"]`).getAttribute('data-open').catch(() => 'MẤT');
      ok('thẻ tool giữ mở qua nhiều vòng poll', mo1 === 'true' && mo2 === 'true',
        `mở=${mo1} sau 8s=${mo2}`);
    }

    /* Bản chép phải TRÔNG như terminal, không phải khung chat của app:
       - phông chữ đều (monospace) cho cả khối
       - ký tự đánh dấu ⏺ / ⎿ / > đúng như Claude CLI in ra
       - KHÔNG bong bóng bo tròn, KHÔNG nền màu cho câu chữ
       Bản trước có avatar tròn + nhãn "Claude"/"Vinh" + bong bóng nền xanh; terminal
       không có thứ nào trong đó nên đây là chỗ sai rõ nhất. */
    const cli = await page.evaluate(() => {
      const box = document.querySelector('[data-testid=chat-bubbles]');
      const chu = getComputedStyle(box).fontFamily.toLowerCase();
      const noiDung = box.innerText;
      const bb = box.querySelector('[data-testid=bubble]');
      const st = bb ? getComputedStyle(bb) : null;
      return {
        mono: /mono|consol|menlo|courier|ui-monospace/.test(chu),
        chamTron: (noiDung.match(/⏺/g) || []).length,
        ngoac: (noiDung.match(/⎿/g) || []).length,
        avatarCu: box.querySelectorAll('[data-testid=msg-avatar]').length,
        vaiCu: box.querySelectorAll('[data-testid=msg-role]').length,
        // bong bóng cũ bo 12px + nền đặc; kiểu CLI thì không bo, nền trong suốt
        bo: st ? parseFloat(st.borderRadius) : -1,
        nen: st ? st.backgroundColor : '',
      };
    });
    ok('bản chép dùng phông chữ đều như terminal', cli.mono, JSON.stringify(cli).slice(0, 120));
    /* ⎿ chỉ có khi phiên CÓ tool. Phiên nào đứng đầu danh sách là tuỳ máy, gặp phiên
       chỉ toàn câu chữ thì đòi ⎿ là bắt lỗi môi trường chứ không phải lỗi code
       (đã dính: ⏺=1 ⎿=0 ở một phiên không có tool nào). */
    ok('có ký tự đánh dấu ⏺ như Claude CLI', cli.chamTron > 0, `⏺=${cli.chamTron}`);
    if (n) {
      ok('có ký tự ⎿ cho dòng kết quả tool', cli.ngoac > 0, `⎿=${cli.ngoac} (${n} tool)`);
    } else {
      ok('có ký tự ⎿ cho dòng kết quả tool', true, 'bỏ qua: phiên không có tool');
    }
    ok('KHÔNG còn avatar tròn / nhãn vai (terminal không có)',
      cli.avatarCu === 0 && cli.vaiCu === 0, `avatar=${cli.avatarCu} vai=${cli.vaiCu}`);
    ok('câu chữ không nằm trong bong bóng bo tròn có nền',
      cli.bo <= 0 && /rgba\(0, 0, 0, 0\)|transparent/.test(cli.nen), `bo=${cli.bo} nền=${cli.nen}`);

    await ctx.close();
  }

  /* ---------- C. Docker: đọc được, và CHẶN mọi lệnh nguy hiểm ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.click('[data-testid=nav-docker]');
    await page.waitForTimeout(2500);

    const co = await page.locator('[data-testid=dk-row]').count();
    const loi = await page.locator('[data-testid=docker-loi]').count();
    ok('tab Docker: có bảng container hoặc báo Docker tắt', co > 0 || loi > 0, `hàng=${co}`);

    // KHÔNG được có nút xoá — volume postgres/neo4j nằm trong đó
    const coXoa = await page.evaluate(() =>
      !!document.querySelector('[data-testid*=dk-rm], [data-testid*=dk-delete], [data-testid=dk-prune-all]'));
    ok('Docker KHÔNG có nút xoá container/volume', !coXoa);

    // whitelist hành động + kiểm id
    const chan = await page.evaluate(async () => {
      const thu = async (body) => {
        const r = await fetch('/api/docker/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return r.status;
      };
      return {
        rm: await thu({ action: 'rm', id: 'x' }),
        exec: await thu({ action: 'exec', id: 'x' }),
        idXau: await thu({ action: 'start', id: 'a; rm -rf /' }),
        prune: await (await fetch('/api/docker/prune-build', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        })).status,
      };
    });
    ok('Docker chặn lệnh nguy hiểm + id xấu + prune không xác nhận',
      chan.rm === 400 && chan.exec === 400 && chan.idXau === 400 && chan.prune === 400,
      JSON.stringify(chan));
    await ctx.close();
  }

  /* ---------- D. Passcode: chặn CẢ loopback, chống dò, có đường thoát ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    ok('chưa đặt mã: vào thẳng, không có màn khoá',
      (await page.locator('[data-testid=passcode-gate]').count()) === 0);

    /* Đặt mã qua giao diện: 2 bước (nhập rồi xác nhận).
       CHỜ THEO TRẠNG THÁI, đừng ngủ cố định. Bản cũ chờ 600ms giữa hai bước; máy bận
       (đang chạy song song server + bộ test khác) thì màn chưa kịp chuyển sang bước
       xác nhận, 4 phím của lần hai rơi tiếp vào ô bước một -> mã thành 8 số, bấm xong
       vẫn ở bước một, gate không tắt. Cả loạt test sau đó đứng sau màn khoá rồi chết
       vì "passcode-gate intercepts pointer events" — nhìn như hỏng chỗ khác. */
    await page.click('[data-testid=lock-btn]');
    await page.waitForSelector('[data-testid=passcode-gate]', { timeout: 15000 });
    const MA = ['9', '1', '7', '3'];
    for (const k of MA) await page.click(`[data-testid=key-${k}]`);
    await page.click('[data-testid=passcode-submit]');
    // bước 2 hiện ra thì chữ trên màn đổi thành "Nhập lại mã vừa tạo"
    await page.waitForFunction(
      () => /Nhập lại mã/.test(document.querySelector('[data-testid=passcode-gate]')?.innerText || ''),
      null, { timeout: 15000 });
    for (const k of MA) await page.click(`[data-testid=key-${k}]`);
    await page.click('[data-testid=passcode-submit]');
    await page.waitForSelector('[data-testid=passcode-gate]', { state: 'detached', timeout: 15000 })
      .catch(() => {});
    ok('tạo mã qua giao diện (nhập 2 lần)',
      (await page.locator('[data-testid=passcode-gate]').count()) === 0
      && fs.existsSync(PASS_FILE));

    // file chỉ chứa salt+hash, quyền 0600
    let quyen = '', loMa = true;
    try {
      quyen = (fs.statSync(PASS_FILE).mode & 0o777).toString(8);
      const j = JSON.parse(fs.readFileSync(PASS_FILE, 'utf8'));
      loMa = JSON.stringify(j).includes('9173');
    } catch {}
    ok('file mã: quyền 600 và KHÔNG lưu mã thật', quyen === '600' && !loMa, `quyền=${quyen}`);

    // ĐIỂM MẤU CHỐT: loopback không cookie phải bị chặn
    const chanLocal = await page.evaluate(async () => {
      // fetch không kèm cookie -> giả lập người khác mở trình duyệt khác trên cùng máy
      const r = await fetch('/api/jobs', { credentials: 'omit' });
      return r.status;
    });
    ok('mã khoá chặn CẢ localhost (423, trước đây luôn 200)', chanLocal === 423, `status=${chanLocal}`);

    // khoá ngay -> gate hiện; mã SAI phải xoá ô; mã ĐÚNG vào được
    await page.click('[data-testid=lock-btn]');
    await page.waitForTimeout(2500);
    ok('bấm "Khoá ngay" -> hiện màn khoá',
      (await page.locator('[data-testid=passcode-gate]').count()) > 0);

    for (const k of ['1', '1', '1', '1']) await page.click(`[data-testid=key-${k}]`);
    await page.click('[data-testid=passcode-submit]');
    await page.waitForTimeout(1500);
    const conLai = await page.locator('[data-testid=passcode-dots]').getAttribute('data-len');
    ok('mã sai -> ô mã được XOÁ (không cộng dồn thành mã rác)', conLai === '0', `còn ${conLai} ký tự`);

    for (const k of MA) await page.click(`[data-testid=key-${k}]`);
    await page.click('[data-testid=passcode-submit]');
    await page.waitForTimeout(3000);
    ok('mã đúng sau khi sai -> vào được',
      (await page.locator('[data-testid=passcode-gate]').count()) === 0);

    // chống dò: sai nhiều lần phải bị bắt chờ
    const dò = await page.evaluate(async () => {
      let cuoi = 0;
      for (let i = 0; i < 7; i++) {
        const r = await fetch('/api/passcode/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: '0000' }),
        });
        cuoi = r.status;
      }
      return cuoi;
    });
    ok('chống dò mã: sai 7 lần -> bị chặn (429)', dò === 429, `status=${dò}`);

    // đường thoát: xoá file là mở lại được
    fs.rmSync(PASS_FILE, { force: true });
    // server đọc lại file mỗi 2s (docPass) — chờ qua mốc đó rồi mới hỏi, không thì
    // đang đọc bản cache và tưởng là lỗi.
    await page.waitForTimeout(2800);
    const sauXoa = await page.evaluate(async () =>
      (await fetch('/api/passcode/status')).json());
    ok('quên mã: xoá file là gỡ khoá', sauXoa.daDat === false, JSON.stringify(sauXoa));
    await ctx.close();
  }

  /* ---------- E. Mobile: 5 mốc màn hình + vùng chạm 44px ---------- */
  {
    for (const [ten, w, h] of [['320', 320, 568], ['iphone', 390, 844], ['ipad', 768, 1024]]) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 768,
      });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message.slice(0, 60)));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);

      let tran = 0;
      for (const t of TABS) {
        const sel = w >= 768 ? `[data-testid=nav-${t}]` : `[data-testid=tabbar-${t}]`;
        if (!(await page.locator(sel).count())) continue;
        await page.click(sel);
        await page.waitForTimeout(1300);
        if (await page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth)) tran++;
      }
      ok(`${ten}px: 5 tab không tràn ngang`, tran === 0, `tràn=${tran}`);
      ok(`${ten}px: không lỗi console`, errs.length === 0, errs[0] || '');

      if (w < 768) {
        // vùng chạm gồm cả ::after của .tap44
        const nho = await page.evaluate(() => {
          const out = [];
          [...document.querySelectorAll('button')].filter((e) => e.offsetParent).forEach((e) => {
            const r = e.getBoundingClientRect();
            let hh = r.height, ww = r.width;
            const af = getComputedStyle(e, '::after');
            if (af.content && af.content !== 'none') {
              hh = Math.max(hh, parseFloat(af.minHeight) || 0);
              ww = Math.max(ww, parseFloat(af.minWidth) || 0);
            }
            if (hh > 0 && (hh < 44 || ww < 44)) {
              out.push((e.dataset.testid || e.title || '?') + ':' + Math.round(hh) + 'x' + Math.round(ww));
            }
          });
          return out;
        });
        ok(`${ten}px: mọi nút đạt vùng chạm 44px`, nho.length === 0, nho.slice(0, 4).join(', '));

        const thieuNhan = await page.evaluate(() =>
          [...document.querySelectorAll('button')].filter((e) => e.offsetParent
            && !e.textContent.trim() && !e.title && !e.getAttribute('aria-label')).length);
        ok(`${ten}px: không nút nào thiếu nhãn`, thieuNhan === 0, `thiếu=${thieuNhan}`);
      }
      await ctx.close();
    }
  }

  /* ---------- F. Bảng lệnh ⌘K + gợi ý lệnh / trong chat ---------- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(700);
    const soLenh = await page.locator('[data-testid=palette-item]').count();
    ok('⌘K mở bảng lệnh, có đủ lệnh', soLenh >= 20, `${soLenh} lệnh`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    await page.waitForSelector('[data-testid=session-row]', { timeout: 10000 });
    await page.locator('[data-testid=session-row]:visible').first().click();
    await page.waitForSelector('[data-testid=chat-input]', { timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.fill('[data-testid=chat-input]', '/');
    await page.waitForTimeout(600);
    const goiY = await page.locator('[data-testid=slash-item]').count();
    ok('gõ "/" trong chat -> gợi ý lệnh ngay tại chỗ', goiY > 0, `${goiY} gợi ý`);

    await page.fill('[data-testid=chat-input]', '/comp');
    await page.waitForTimeout(500);
    const loc = await page.locator('[data-testid=slash-item]').count();
    ok('gõ "/comp" -> lọc còn đúng lệnh cần', loc >= 1 && loc <= 3, `${loc} kết quả`);
    await page.fill('[data-testid=chat-input]', '');
    await ctx.close();
  }

  /* ---- NHẮN THẬT: gửi tin, đợi Claude trả lời ----
     Đây là luồng dùng hằng ngày, và là thứ e2e cũ không phủ được vì nó chạy trên
     bản legacy. Gọi Claude THẬT nên chậm (vài giây tới hơn phút) — đặt SKIP_CHAT=1
     để bỏ qua khi chỉ muốn kiểm nhanh phần giao diện. */
  if (!process.env.SKIP_CHAT) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
    await page.waitForTimeout(1500);

    // chọn phiên KHÔNG chạy, để không chen ngang việc đang làm
    const i = await page.evaluate(() => [...document.querySelectorAll('[data-testid=session-row]')]
      .filter((r) => r.offsetParent)
      .findIndex((r) => !['RUNNING', 'ACTIVE'].includes(r.dataset.status)));
    await page.locator('[data-testid=session-row]:visible').nth(Math.max(0, i)).click();
    await page.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
    await page.waitForTimeout(2500);

    const dau = 'ping-' + Math.floor(Math.random() * 9000 + 1000);
    await page.fill('[data-testid=chat-input]', 'Đáp đúng một từ, không giải thích: ' + dau);
    const t0 = Date.now();
    await page.click('[data-testid=chat-send]');

    // tin CỦA MÌNH phải hiện gần như tức thì — trước đây mất ~4s vì đợi server
    let tMinh = -1;
    try {
      await page.waitForFunction((m) => document.body.innerText.includes(m), dau, { timeout: 15000 });
      tMinh = Date.now() - t0;
    } catch {}
    ok('tin của mình hiện ngay (< 1s, không đợi server ghi file)',
      tMinh >= 0 && tMinh < 1000, tMinh < 0 ? 'không hiện' : tMinh + 'ms');

    // Claude trả lời: dấu hiệu xuất hiện LẦN THỨ HAI (một của mình, một của Claude)
    let tClaude = -1;
    try {
      await page.waitForFunction(
        (m) => (document.querySelector('[data-testid=chat-bubbles]').innerText.split(m).length - 1) >= 2,
        dau, { timeout: 150000 });
      tClaude = Date.now() - t0;
    } catch {}
    ok('Claude trả lời thật trong khung chat',
      tClaude > 0, tClaude > 0 ? tClaude + 'ms' : 'không thấy trả lời trong 150s');

    await ctx.close();
  }

  /* ---- các mục còn ghi "kiểm tay" mà máy làm được ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    /* Bảng chọn khi Claude hỏi: bấm lựa chọn rồi "Gửi lựa chọn" phải GỬI THẬT vào
       phiên.

       DỰNG HẲN danh sách tin, không chèn vào lịch sử thật. Bản trước chèn part hỏi
       vào lượt assistant CUỐI của phiên đang chạy — nhưng phiên đó vẫn đang chạy nên
       nội dung đổi liên tục: hễ tin cuối là của người dùng thì thẻ hỏi không còn nằm
       ở lượt cuối, `daTraLoi` bật lên và mọi nút bị disabled. Test treo 30 giây rồi
       ném TimeoutError, nhìn như code hỏng trong khi chỉ là dữ liệu đã trôi. */
    {
      const cx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pg = await cx.newPage();
      let daGui = null;
      await pg.route('**/api/history/**', async (r) => {
        const res = await r.fetch();
        const j = await res.json();
        const t0 = Date.now();
        const gio = (s) => new Date(t0 + s * 1000).toISOString();
        j.awaiting = false;
        j.messages = [
          { role: 'user', content: 'lam giup tao viec nay', ts: gio(0) },
          { role: 'assistant', content: '', ts: gio(1), parts: [{
            t: 'tool', name: 'AskUserQuestion', id: 't-ask', disp: 'AskUserQuestion',
            summary: '', input: '', status: 'ok', result: '', images: [],
            hoi: [{ hoi: 'Thu bang chon?', nhan: 'Pham vi', nhieu: false,
              chon: [{ nhan: 'Lua chon A', mo: 'mo ta a' }, { nhan: 'Lua chon B', mo: 'mo ta b' }] }],
          }] },
        ];
        await r.fulfill({ response: res, json: j });
      });
      // Chặn gửi thật: test không được làm bẩn phiên đang dùng, nhưng vẫn xem được
      // nội dung gửi đi để khẳng định nút hoạt động.
      await pg.route('**/api/chat/**', async (r) => {
        try { daGui = JSON.parse(r.request().postData() || '{}').message; } catch {}
        await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      });

      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(2500);

      const soOption = await pg.locator('[data-testid=ask-option]').count();
      ok('cau hoi cua Claude hien thanh bang chon bam duoc', soOption === 2, soOption + ' lua chon');

      if (soOption) {
        await pg.locator('[data-testid=ask-option]').first().click();
        await pg.waitForTimeout(400);
        const active = await pg.locator('[data-testid=ask-option]').first().getAttribute('data-active');
        ok('bam lua chon -> danh dau da chon', active === 'true', 'data-active=' + active);
        await pg.locator('[data-testid=ask-send]').click();
        await pg.waitForTimeout(1500);
        ok('bam "Gui lua chon" -> gui THAT vao phien',
          !!daGui && daGui.indexOf('Lua chon A') >= 0, JSON.stringify(daGui || '(khong gui)'));
      }
      await cx.close();
    }

    /* Dòng "hook lỗi" KHÔNG được cắt đôi lượt của Claude.
       Lỗi thật đã gặp (chụp màn hình phiên 11:54–11:55): mỗi dòng hook lỗi đẩy ra một
       nhóm mới, nên một lượt bị xé thành 6 khối "Claude · 1 tool" liên tiếp. Trên
       terminal chúng chảy liền một mạch.
       Dựng đúng cảnh: assistant -> note hook -> assistant, cách nhau vài giây. */
    {
      const cx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pg = await cx.newPage();
      await pg.route('**/api/history/**', async (r) => {
        const res = await r.fetch();
        const j = await res.json();
        const t0 = Date.now();
        const gio = (s) => new Date(t0 + s * 1000).toISOString();
        j.messages = [
          { role: 'user', content: 'lam gi do di', ts: gio(0) },
          { role: 'assistant', content: '', ts: gio(1),
            parts: [{ t: 'tool', name: 'Bash', id: 'b1', disp: 'Bash', summary: 'lenh 1',
              input: '', status: 'ok', result: '', images: [] }] },
          { role: 'system', content: '', ts: gio(2),
            parts: [{ t: 'note', kind: 'hook-error', title: 'Hook loi: PreToolUse:Bash', body: 'chi tiet' }] },
          { role: 'assistant', content: '', ts: gio(3),
            parts: [{ t: 'tool', name: 'Edit', id: 'e1', disp: 'Edit', summary: 'sua file',
              input: '', status: 'ok', result: '', images: [] }] },
          { role: 'system', content: '', ts: gio(4),
            parts: [{ t: 'note', kind: 'hook-error', title: 'Hook loi: PreToolUse:Edit', body: 'chi tiet' }] },
          { role: 'assistant', content: 'xong roi', ts: gio(5) },
        ];
        await r.fulfill({ response: res, json: j });
      });
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(2500);

      const soClaude = await pg.locator('[data-testid=msg-wrap][data-role=assistant]').count();
      ok('dong hook loi KHONG cat doi luot cua Claude',
        soClaude === 1, soClaude + ' khoi "Claude" (dung phai 1, truoc khi sua la 3)');

      // và dòng hook lỗi vẫn phải HIỆN, chỉ là hiện BÊN TRONG lượt đó
      const trongLuot = await pg.locator(
        '[data-testid=msg-wrap][data-role=assistant] [data-testid=note-line]').count();
      ok('hook loi van hien, nam trong than luot', trongLuot === 2, trongLuot + ' dong ghi chu');

      // mốc /compact thì NGƯỢC LẠI: phải cắt lượt, vì đó là ranh giới thật của phiên
      await pg.unroute('**/api/history/**');
      await pg.route('**/api/history/**', async (r) => {
        const res = await r.fetch();
        const j = await res.json();
        const t0 = Date.now();
        const gio = (s) => new Date(t0 + s * 1000).toISOString();
        j.messages = [
          { role: 'assistant', content: 'truoc khi don', ts: gio(1) },
          { role: 'system', content: '', ts: gio(2),
            parts: [{ t: 'note', kind: 'compact', title: 'Da don ngu canh tai day', body: '' }] },
          { role: 'assistant', content: 'sau khi don', ts: gio(3) },
        ];
        await r.fulfill({ response: res, json: j });
      });
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(2500);
      const sauCompact = await pg.locator('[data-testid=msg-wrap][data-role=assistant]').count();
      ok('moc /compact VAN cat luot (do la ranh gioi that)',
        sauCompact === 2, sauCompact + ' khoi "Claude" (dung phai 2)');
      await cx.close();
    }

    /* Dán ảnh từ clipboard vào ô chat -> ảnh phải lên thanh đính kèm.
       Claude CLI trên terminal dán thẳng được; trước đây ở đây chỉ có nút chọn file
       nên chụp màn hình xong phải lưu ra đĩa rồi mới đính được. */
    {
      const cx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pg = await cx.newPage();
      let daTai = false;
      await pg.route('**/api/upload', async (r) => {
        daTai = true;
        await r.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ ok: true, path: '/tmp/dan-thu.png', name: 'dan-thu.png' }) });
      });
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-input]', { timeout: 20000 });

      // PNG 1x1 thật, dựng thành File rồi bắn sự kiện paste đúng như trình duyệt làm
      await pg.evaluate(() => {
        const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const f = new File([u8], 'dan-thu.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(f);
        const el = document.querySelector('[data-testid=chat-input]');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await pg.waitForTimeout(2000);
      const soAnh = await pg.locator('[data-testid=attach-item]').count();
      ok('dan anh tu clipboard -> len thanh dinh kem',
        daTai && soAnh === 1, 'da goi upload=' + daTai + ', so anh=' + soAnh);
      await cx.close();
    }

    /* Gõ "@" -> gợi ý file trong thư mục của phiên, chọn thì điền vào ô nhập. */
    {
      const cx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pg = await cx.newPage();
      // Ghi lại lời gọi /api/files để khi hỏng còn biết vì sao (sai sid? rỗng? 404?)
      let veFile = '(chua goi /api/files)';
      pg.on('response', async (r) => {
        if (r.url().includes('/api/files')) {
          veFile = r.status() + ' ' + r.url().split('?')[1] + ' -> '
            + (await r.text().catch(() => '?')).slice(0, 160);
        }
      });
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
      await pg.waitForTimeout(1200);

      /* CHỌN PHIÊN CÓ THƯ MỤC THẬT, đừng lấy phiên đầu danh sách.
         Hai lần đã hỏng vì chỗ này: lần đầu nó bấm trúng phiên 7e31e9e3 (thư mục
         agy-proxy, không có file tên "chat-view"); lần sau trúng e2e00000-... là
         PHIÊN GIẢ do chính bộ e2e dựng ra, không có thư mục nào cả.
         Hỏi thẳng server từng phiên cho tới khi gặp phiên phân giải được thư mục. */
      const sids = await pg.$$eval('[data-testid=session-row]',
        (rs) => rs.filter((r) => r.offsetParent).map((r) => r.dataset.sid).slice(0, 10));
      /* Giữ lại MÃ HTTP của lần hỏi đầu. Có lần cả 10 phiên đều "không phân giải
         được thư mục" mà thật ra server trả 423 (màn khoá còn bật do bộ test trước
         chết giữa chừng) — nuốt mất mã lỗi thì lần sau lại đi mò từ đầu. */
      const dodac = await pg.evaluate(async (ds) => {
        let ma = 0;
        for (const sid of ds) {
          const r = await fetch('/api/files?sid=' + encodeURIComponent(sid) + '&q=');
          if (!ma) ma = r.status;
          const j = await r.json().catch(() => ({}));
          if ((j.files || []).length) return { ma, sid, file: j.files[0], root: j.root };
        }
        return { ma };
      }, sids);
      const chon = dodac.file ? dodac : null;

      const sidThu = chon ? chon.sid : sids[0];
      await pg.locator(`[data-testid=session-row][data-sid="${sidThu}"]:visible`).first().click();
      await pg.waitForSelector('[data-testid=chat-input]', { timeout: 20000 });
      const thuc = chon ? chon.file : '';
      const ten = thuc.slice(thuc.lastIndexOf('/') + 1);
      const gocTen = ten.slice(0, Math.max(3, ten.indexOf('.') > 0 ? ten.indexOf('.') : ten.length));

      if (!thuc) {
        /* Không phiên nào phân giải được thư mục. Nếu server trả 200 thì đúng là máy
           này thiếu dữ liệu -> bỏ qua. Còn trả mã khác (423 màn khoá, 401 thiếu
           token) thì đó là HỎNG THẬT, không được im lặng cho qua. */
        const laMoiTruong = dodac.ma === 200;
        ok('go "@" -> hien goi y duong dan file', laMoiTruong,
          laMoiTruong
            ? 'bo qua: ' + sids.length + ' phien deu khong phan giai duoc thu muc'
            : 'server tra HTTP ' + dodac.ma + ' cho /api/files');
        ok('Esc dong bang goi y "@"', true, 'bo qua: nhu tren');
        ok('sau Esc, go "@" MOI van mo lai duoc goi y', true, 'bo qua: nhu tren');
      } else {
        await pg.locator('[data-testid=chat-input]').click();
        await pg.locator('[data-testid=chat-input]').type('sua @' + gocTen, { delay: 30 });
        // Chờ CÓ ĐIỀU KIỆN, không ngủ cố định: gợi ý phải đi một vòng server (quét cây
        // thư mục lần đầu ~vài trăm ms) nên mốc 1200ms cố định lúc đạt lúc không.
        await pg.waitForSelector('[data-testid=mention-item]', { timeout: 15000 }).catch(() => {});
        const soGoiY = await pg.locator('[data-testid=mention-item]').count();
        ok('go "@" -> hien goi y duong dan file', soGoiY > 0,
          soGoiY + ' goi y cho "@' + gocTen + '" | ' + veFile);

        if (soGoiY) {
          const file = await pg.locator('[data-testid=mention-item]').first().getAttribute('data-file');
          await pg.locator('[data-testid=mention-item]').first().click();
          await pg.waitForTimeout(500);
          const val = await pg.locator('[data-testid=chat-input]').inputValue();
          ok('chon goi y -> dien duong dan vao o nhap, giu nguyen chu da go',
            val.indexOf('@' + file) >= 0 && val.startsWith('sua '), JSON.stringify(val));
        }

        /* Esc đóng gợi ý, nhưng gõ "@" MỚI phải mở lại được.
           Lỗi đã gặp: chỉ mở lại khi chuỗi hết sạch "@", nên sau một lần Esc là câm
           luôn tới cuối câu. */
        await pg.locator('[data-testid=chat-input]').fill('');
        await pg.locator('[data-testid=chat-input]').type('@' + gocTen, { delay: 30 });
        await pg.waitForSelector('[data-testid=mention-item]', { timeout: 15000 }).catch(() => {});
        await pg.keyboard.press('Escape');
        await pg.waitForTimeout(400);
        const sauEsc = await pg.locator('[data-testid=mention-item]').count();
        ok('Esc dong bang goi y "@"', sauEsc === 0, sauEsc + ' goi y');

        await pg.locator('[data-testid=chat-input]').type(' roi @' + gocTen, { delay: 30 });
        await pg.waitForSelector('[data-testid=mention-item]', { timeout: 15000 }).catch(() => {});
        const moLai = await pg.locator('[data-testid=mention-item]').count();
        ok('sau Esc, go "@" MOI van mo lai duoc goi y', moLai > 0, moLai + ' goi y');
      }

      // "@" trong email KHÔNG được kích hoạt gợi ý — chạy được kể cả khi không có
      // thư mục nào, vì phép này chỉ cần "KHÔNG hiện gì".
      await pg.locator('[data-testid=chat-input]').fill('');
      await pg.locator('[data-testid=chat-input]').type('gui cho a@b', { delay: 30 });
      await pg.waitForTimeout(900);
      const emailGoiY = await pg.locator('[data-testid=mention-item]').count();
      ok('"@" giua email khong kich hoat goi y', emailGoiY === 0, emailGoiY + ' goi y');
      await cx.close();
    }

    // Nút chọn phân đoạn phải CUỘN được trên màn hẹp. Lỗi thật đã gặp: vùng cuộn
    // đặt nhầm ở div cha nên nút cuối ("Creative") tràn ra 290px trong khi khung chỉ
    // tới 170px — bị cắt, ngón tay không với tới, chế độ đó thành không chọn được.
    {
      const mp = await browser.newContext({
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      });
      const pg = await mp.newPage();
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForTimeout(2200);
      const seg = await pg.evaluate(() => {
        const s = document.querySelector('[data-testid=mode-seg]');
        if (!s) return null;
        return { cuonDuoc: s.scrollWidth > s.clientWidth, rong: Math.round(s.clientWidth) };
      });
      ok('nút chọn chế độ CUỘN được trên iPhone (không cắt mất nút cuối)',
        !!seg && seg.cuonDuoc, seg ? `khung ${seg.rong}px, cuộn được ${seg.cuonDuoc}` : 'không thấy');
      // bấm được nút cuối sau khi cuộn tới
      await pg.evaluate(() => {
        const s = document.querySelector('[data-testid=mode-seg]');
        if (s) s.scrollLeft = s.scrollWidth;
      });
      await pg.waitForTimeout(400);
      await pg.click('[data-testid=mode-seg-creative]').catch(() => {});
      await pg.waitForTimeout(500);
      const chon = await pg.locator('[data-testid=mode-seg-creative]').getAttribute('data-active');
      ok('chọn được chế độ cuối cùng sau khi cuộn', chon === 'true', 'data-active=' + chon);
      await mp.close();
    }

    // 48: link ?t= tự điền token rồi TỰ DỌN khỏi URL (để không lộ token khi chia sẻ link)
    const tok = layToken();
    if (tok) {
      await page.goto(URL + '?t=' + tok, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1800);
      const con = await page.evaluate(() => location.search);
      const luu = await page.evaluate(() => localStorage.getItem('dashToken'));
      ok('link ?t= tự điền token rồi dọn khỏi URL',
        !con.includes('t=') && luu === tok, `URL còn "${con}"`);
    }

    // 70: nhịp poll co giãn — Claude rảnh thì 2s, đang chạy thì 700ms
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
    await page.waitForTimeout(1200);
    const j = await page.evaluate(() => [...document.querySelectorAll('[data-testid=session-row]')]
      .filter((r) => r.offsetParent)
      .findIndex((r) => !['RUNNING', 'ACTIVE'].includes(r.dataset.status)));
    await page.locator('[data-testid=session-row]:visible').nth(Math.max(0, j)).click();
    await page.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
    await page.waitForTimeout(2000);
    let lanGoi = 0;
    page.on('response', (r) => { if (r.url().includes('/api/history/')) lanGoi++; });
    await page.waitForTimeout(6200);
    // phiên RẢNH -> nhịp 2s -> trong 6.2s gọi khoảng 3 lần; nhịp 700ms sẽ ra ~9
    ok('nhịp poll giãn ra 2s khi Claude rảnh (đỡ tốn pin)',
      lanGoi >= 2 && lanGoi <= 5, `${lanGoi} lần trong 6.2s`);

    // 62: tạo job lặp/cron rồi HUỶ — kiểm cả endpoint xoá (trước đây không có, job chạy mãi)
    await page.click('[data-testid=chat-back]').catch(() => {});
    await page.waitForTimeout(1200);
    const truoc = await page.locator('[data-testid=job-row]').count();
    await page.click('[data-testid=jobs-toggle]').catch(() => {});
    await page.waitForTimeout(500);
    await page.click('[data-testid=job-new-cron]');
    await page.waitForTimeout(700);
    await page.fill('[data-testid=job-prompt]', 'kiểm tra tự động');
    await page.click('[data-testid=job-create]');
    await page.waitForTimeout(3000);
    const sauTao = await page.locator('[data-testid=job-row]').count();
    ok('tạo việc nền (hẹn giờ) qua giao diện', sauTao === truoc + 1, `${truoc} -> ${sauTao}`);
    if (sauTao > truoc) {
      await page.locator('[data-testid=job-del]').last().click();
      await page.waitForTimeout(3000);
      const sauXoa = await page.locator('[data-testid=job-row]').count();
      ok('huỷ việc nền (trước đây KHÔNG có cách dừng, phải restart server)',
        sauXoa === truoc, `${sauTao} -> ${sauXoa}`);
    }
    await ctx.close();
  }

  await browser.close();
  traPasscode();
  const fails = results.filter((r) => !r.pass);
  console.log('\n==== UI MỚI: ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  traPasscode();
  console.error('SCRIPT ERROR', e);
  process.exit(2);
});
