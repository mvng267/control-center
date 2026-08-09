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
      await card.click();
      await page.waitForTimeout(500);
      const mo1 = await card.getAttribute('data-open');
      // 8s > nhiều vòng poll (700ms khi chạy / 2s khi rảnh)
      await page.waitForTimeout(8000);
      const mo2 = await page.locator(`[data-tid="${tid}"]`).getAttribute('data-open').catch(() => 'MẤT');
      ok('thẻ tool giữ mở qua nhiều vòng poll', mo1 === 'true' && mo2 === 'true',
        `mở=${mo1} sau 8s=${mo2}`);
    }

    // Chat kiểu CLI: có avatar + nhãn vai, thẻ tool THỤT LỀ so với bong bóng
    const cli = await page.evaluate(() => {
      const box = document.querySelector('[data-testid=chat-bubbles]');
      const L = (s) => {
        const e = box.querySelector(s);
        return e ? Math.round(e.getBoundingClientRect().left - box.getBoundingClientRect().left) : -1;
      };
      return {
        avatar: box.querySelectorAll('[data-testid=msg-avatar]').length,
        vai: box.querySelectorAll('[data-testid=msg-role]').length,
        Lbubble: L('[data-testid=bubble]'),
        Ltool: L('[data-testid=tool-card]'),
      };
    });
    ok('chat kiểu CLI: có avatar + nhãn vai', cli.avatar > 0 && cli.vai > 0, JSON.stringify(cli));
    ok('nội dung thụt lề (không dính lề trái như bảng log)',
      cli.Lbubble > 20 || cli.Ltool > 20, `bubble L=${cli.Lbubble} tool L=${cli.Ltool}`);

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

    // đặt mã qua giao diện (2 bước: nhập + xác nhận)
    await page.click('[data-testid=lock-btn]');
    await page.waitForTimeout(700);
    const MA = ['9', '1', '7', '3'];
    for (const k of MA) await page.click(`[data-testid=key-${k}]`);
    await page.click('[data-testid=passcode-submit]');
    await page.waitForTimeout(600);
    for (const k of MA) await page.click(`[data-testid=key-${k}]`);
    await page.click('[data-testid=passcode-submit]');
    await page.waitForTimeout(2000);
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
