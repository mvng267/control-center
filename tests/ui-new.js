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

/* Đóng context ĐANG CÓ route chặn: phải gỡ route TRƯỚC.
   Khung chat poll /api/history liên tục (700ms–2s). Đóng thẳng context thì handler
   đang dở dang gọi r.fetch() trên một context vừa bị huỷ -> ném TargetClosedError
   và giết cả bộ test, dù mọi assertion đã PASS. Đúng lỗi này làm test-all báo
   "giao diện mới HỎNG" ba lần liên tiếp trong khi chạy riêng vẫn 57/57. */
async function dongSach(pg, cx) {
  await pg.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  await cx.close().catch(() => {});
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
      /* Thẻ BIẾN MẤT khác hẳn với thẻ TỰ ĐÓNG. Cửa sổ chỉ giữ 30 tin cuối: phiên
         được ghi thêm trong 8 giây chờ thì thẻ trôi ra khỏi cửa sổ — dữ liệu đổi,
         không phải mất trạng thái mở. Bài này chọn phiên đã nghỉ, nhưng "đã nghỉ" là
         trạng thái LÚC MỞ; dưới test-all thì phiên control đang chạy và ghi liên tục
         nên vẫn trôi (chạy riêng 3/3 lần đều PASS, chỉ đỏ khi chạy cùng).
         Nên: mất thẻ -> báo bỏ qua kèm lý do; còn thẻ mà đóng -> đỏ thật. */
      if (mo2 === 'MẤT') {
        ok('thẻ tool giữ mở qua nhiều vòng poll', true,
          'bỏ qua: thẻ trôi khỏi cửa sổ 30 tin (phiên được ghi thêm), không phải tự đóng');
      } else {
        ok('thẻ tool giữ mở qua nhiều vòng poll', mo1 === 'true' && mo2 === 'true',
          `mở=${mo1} sau 8s=${mo2}`);
      }
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
        // Bọc kín: vòng poll có thể còn bay giữa chừng khi context đóng
        let res, j;
        try { res = await r.fetch(); j = await res.json(); } catch { return; }
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
        await r.fulfill({ response: res, json: j }).catch(() => {});
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
      await dongSach(pg, cx);
    }

    /* NHIỀU câu hỏi -> xếp thành TAB NGANG như Claude CLI, mỗi lúc một câu.
       Bản trước đổ hết xuống một cột dọc: đo với 3 câu (đúng bộ trong ảnh Vinh gửi)
       ra 623px — dài gần trọn màn điện thoại, cuộn mãi mới tới nút Gửi. */
    {
      const cx = await browser.newContext({ viewport: { width: 900, height: 900 } });
      const pg = await cx.newPage();
      let daGui = null;
      const cauHoi = [
        { hoi: 'Sua toi dau?', nhan: 'Pham vi', nhieu: false,
          chon: [{ nhan: 'Chi log', mo: 'a' }, { nhan: 'Ca bao cao', mo: 'b' }] },
        { hoi: 'Co kem loi khong?', nhan: 'Loi kem theo', nhieu: false,
          chon: [{ nhan: 'Co', mo: 'a' }, { nhan: 'Khong', mo: 'b' }] },
        { hoi: 'Them nut chay thu?', nhan: 'Chay thu', nhieu: false,
          chon: [{ nhan: 'Co goi thu', mo: 'a' }, { nhan: 'Khong can', mo: 'b' }] },
      ];
      await pg.route('**/api/history/**', async (r) => {
        let res, j;
        try { res = await r.fetch(); j = await res.json(); } catch { return; }
        j.awaiting = false; j.typing = false;
        j.messages = [{
          role: 'assistant', content: '', ts: new Date().toISOString(),
          parts: [{
            t: 'tool', name: 'AskUserQuestion', id: 't-ask3', disp: 'AskUserQuestion',
            summary: '', input: '', status: 'ok', result: '', images: [], hoi: cauHoi,
          }],
        }];
        await r.fulfill({ response: res, json: j }).catch(() => {});
      });
      await pg.route('**/api/chat/**', async (r) => {
        try { daGui = JSON.parse(r.request().postData() || '{}').message; } catch {}
        await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }).catch(() => {});
      });
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForSelector('[data-testid=session-row]:visible', { timeout: 20000 });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(2500);

      const d = await pg.evaluate(() => {
        const c = document.querySelector('[data-testid=ask-card]');
        return {
          cao: c ? Math.round(c.getBoundingClientRect().height) : 0,
          soTab: document.querySelectorAll('[data-testid=ask-tab]').length,
          // chỉ lựa chọn của tab ĐANG mở mới được hiện
          hien: [...document.querySelectorAll('[data-testid=ask-option]')]
            .filter((e) => e.offsetParent).length,
        };
      });
      ok('nhieu cau hoi -> xep thanh TAB NGANG', d.soTab === 3, d.soTab + ' tab');
      ok('moi luc chi hien MOT cau (2 lua chon)', d.hien === 2, d.hien + ' lua chon hien');
      ok('the gon lai han (truoc 623px voi 3 cau)', d.cao > 0 && d.cao < 400, d.cao + 'px');

      // Chọn xong câu này phải TỰ nhảy sang câu chưa trả lời
      await pg.locator('[data-testid=ask-option]:visible').first().click();
      await pg.waitForTimeout(600);
      const tab2 = await pg.evaluate(() => {
        const ts = [...document.querySelectorAll('[data-testid=ask-tab]')];
        return ts.findIndex((t) => t.dataset.active === 'true');
      });
      ok('chon xong -> tu nhay sang cau CHUA tra loi', tab2 === 1, 'dang o tab ' + tab2);

      // Còn câu bỏ trống thì phải NÓI RÕ, không để nút xám câm lặng
      const nhac = await pg.locator('[data-testid=ask-card]').innerText();
      ok('con cau bo trong -> noi ro con may cau',
        /Còn 2 câu chưa chọn/.test(nhac), (nhac.match(/Còn .* chưa chọn/) || ['(khong co)'])[0]);

      /* Chọn nốt hai câu còn lại — thẻ tự nhảy tab nên cứ bấm lựa chọn đang hiện.
         Chờ nút mở HẲN rồi mới bấm: nút còn disabled thì click treo tới hết giờ, và
         thông báo timeout không nói được vì sao (đúng bẫy đã dính). */
      await pg.locator('[data-testid=ask-option]:visible').first().click();
      await pg.waitForTimeout(400);
      await pg.locator('[data-testid=ask-option]:visible').first().click();
      await pg.locator('[data-testid=ask-send]:not([disabled])')
        .waitFor({ timeout: 8000 }).catch(() => {});
      await pg.locator('[data-testid=ask-send]').click();
      await pg.waitForTimeout(1500);
      ok('gui di kem DU ca ba cau tra loi',
        !!daGui && /Pham vi/.test(daGui) && /Loi kem theo/.test(daGui) && /Chay thu/.test(daGui),
        JSON.stringify(String(daGui || '(khong gui)').slice(0, 90)));

      await dongSach(pg, cx);
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
        let res, j;
        try { res = await r.fetch(); j = await res.json(); } catch { return; }
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
        await r.fulfill({ response: res, json: j }).catch(() => {});
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
        let res, j;
        try { res = await r.fetch(); j = await res.json(); } catch { return; }
        const t0 = Date.now();
        const gio = (s) => new Date(t0 + s * 1000).toISOString();
        j.messages = [
          { role: 'assistant', content: 'truoc khi don', ts: gio(1) },
          { role: 'system', content: '', ts: gio(2),
            parts: [{ t: 'note', kind: 'compact', title: 'Da don ngu canh tai day', body: '' }] },
          { role: 'assistant', content: 'sau khi don', ts: gio(3) },
        ];
        await r.fulfill({ response: res, json: j }).catch(() => {});
      });
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(2500);
      const sauCompact = await pg.locator('[data-testid=msg-wrap][data-role=assistant]').count();
      ok('moc /compact VAN cat luot (do la ranh gioi that)',
        sauCompact === 2, sauCompact + ' khoi "Claude" (dung phai 2)');

      /* Các dạng CLI khac ma dashboard truoc day BO HET. Dem that tren phien 58MB:
         121 file vua sua, 20 lenh xep hang, 10 moc ke hoach, 3 lan sang ngay moi. */
      await pg.unroute('**/api/history/**');
      await pg.route('**/api/history/**', async (r) => {
        let res, j;
        try { res = await r.fetch(); j = await res.json(); } catch { return; }
        const t0 = Date.now();
        const gio = (s) => new Date(t0 + s * 1000).toISOString();
        j.messages = [
          { role: 'system', content: '', ts: gio(0),
            parts: [{ t: 'note', kind: 'ngay', title: 'Sang ngày 2026-08-11', body: '' }] },
          { role: 'system', content: '', ts: gio(1),
            parts: [{ t: 'note', kind: 'hang-doi', title: 'Lệnh xếp hàng chờ tới lượt', body: 'lam tiep di' }] },
          { role: 'system', content: '', ts: gio(2),
            parts: [{ t: 'note', kind: 'ke-hoach', title: 'Bật chế độ lập kế hoạch', body: '' }] },
          { role: 'assistant', content: 'xong', ts: gio(3) },
        ];
        await r.fulfill({ response: res, json: j }).catch(() => {});
      });
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(2500);

      const kieu = await pg.$$eval('[data-testid=note-line]',
        (ns) => ns.map((n) => n.dataset.kind));
      ok('hien duoc cac dang CLI moi: doi ngay / lenh xep hang / moc ke hoach',
        ['ngay', 'hang-doi', 'ke-hoach'].every((k) => kieu.includes(k)),
        JSON.stringify(kieu));
      await dongSach(pg, cx);
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
      await dongSach(pg, cx);
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
          /* Chọn file KHÔNG có dấu cách trong tên. Token "@" dừng ở khoảng trắng
             (đúng như terminal), nên file kiểu "videoAMC 1.mp4" không gõ trọn được —
             lấy trúng nó thì bài đỏ vì TÊN FILE chứ không phải vì code sai. */
          const hop = (j.files || []).find((f) => !/\s/.test(f.slice(f.lastIndexOf('/') + 1)));
          if (hop) return { ma, sid, file: hop, root: j.root };
        }
        return { ma };
      }, sids);
      const chon = dodac.file ? dodac : null;

      const sidThu = chon ? chon.sid : sids[0];
      await pg.locator(`[data-testid=session-row][data-sid="${sidThu}"]:visible`).first().click();
      await pg.waitForSelector('[data-testid=chat-input]', { timeout: 20000 });
      const thuc = chon ? chon.file : '';
      const ten = thuc.slice(thuc.lastIndexOf('/') + 1);
      /* Cắt ở DẤU CÁCH đầu tiên nữa, không chỉ ở dấu chấm. Token "@" theo đúng cách
         terminal hiểu: dừng lại khi gặp khoảng trắng. Gặp file tên "videoAMC 1.mp4"
         mà gõ cả "@videoAMC 1" thì phần sau khoảng trắng không còn thuộc token, gợi ý
         tắt — bài đỏ vì TÊN FILE chứ không phải vì code sai. */
    const cach = ten.indexOf(' ');
    const tenGon = cach > 0 ? ten.slice(0, cach) : ten;
    const cham = tenGon.indexOf('.');
    const gocTen = tenGon.slice(0, Math.max(3, cham > 0 ? cham : tenGon.length));

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

    /* Trên ĐIỆN THOẠI, đang đọc chat thì ẩn cả header vỏ app lẫn thanh tab dưới.
       Header 64px + thanh tab 58px = 122px, gần 1/7 màn hình 844px, mà cả hai chỉ
       lặp lại thứ thanh đầu khung chat đã có. Terminal thật dùng trọn màn.
       Trên DESKTOP giữ nguyên: màn rộng không thiếu chỗ, và breadcrumb ở header là
       cách duy nhất biết đang ở tab nào. */
    {
      const mp = await browser.newContext({
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      });
      const pg = await mp.newPage();
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForSelector('[data-testid=session-row]:visible', { timeout: 20000 });
      await pg.waitForTimeout(1500);

      const oDs = await pg.evaluate(() => ({
        header: !!document.querySelector('[data-testid=app-header]')?.offsetParent,
        tabbar: !!document.querySelector('[data-testid=tabbar]')?.offsetParent,
      }));
      ok('o DANH SACH: van co header + thanh tab de chuyen tab',
        oDs.header && oDs.tabbar, JSON.stringify(oDs));

      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(2000);

      const oChat = await pg.evaluate(() => {
        const box = document.querySelector('[data-testid=chat-bubbles]');
        return {
          header: !!document.querySelector('[data-testid=app-header]')?.offsetParent,
          tabbar: !!document.querySelector('[data-testid=tabbar]')?.offsetParent,
          caoChat: Math.round(box.getBoundingClientRect().height),
        };
      });
      ok('trong CHAT tren iPhone: an header va thanh tab',
        !oChat.header && !oChat.tabbar, JSON.stringify(oChat));
      /* 656px là số đo TRƯỚC khi ẩn header+tab bar; sau khi ẩn phải cao hơn.
         Ngưỡng 665 chứ không phải 700: khung chat còn chia chỗ cho thanh việc-đang-làm
         và banner lỗi, phiên nào đang có chúng thì thấp hơn — đo được 667px ở một
         phiên có thanh todo. Đặt sát quá thì bài đỏ theo NỘI DUNG phiên, không phải
         theo việc ẩn có chạy hay không (điều đó đã có bài riêng ngay trên). */
      ok('an xong thi khung chat cao hon (truoc 656px)',
        oChat.caoChat > 665, oChat.caoChat + 'px / man 844px');

      // Vẫn phải quay lại được danh sách — nếu không thì ẩn tab bar là cụt đường
      await pg.locator('[data-testid=chat-back]').click();
      await pg.waitForTimeout(1200);
      const veLai = await pg.evaluate(() => ({
        tabbar: !!document.querySelector('[data-testid=tabbar]')?.offsetParent,
        coDs: !!document.querySelector('[data-testid=session-grid]'),
      }));
      ok('bam quay lai -> thanh tab hien lai, khong bi cut duong',
        veLai.tabbar && veLai.coDs, JSON.stringify(veLai));
      await mp.close();
    }

    /* Desktop KHÔNG được ẩn — header là chỗ duy nhất biết đang ở tab nào. */
    {
      const cx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pg = await cx.newPage();
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForSelector('[data-testid=session-row]:visible', { timeout: 20000 });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(1500);
      ok('desktop: VAN giu header khi dang chat',
        !!(await pg.evaluate(() => !!document.querySelector('[data-testid=app-header]')?.offsetParent)));
      await cx.close();
    }

    /* Thẻ KẾ HOẠCH (ExitPlanMode) vẽ kiểu terminal, không phải thẻ bo góc nền tím.
       Kế hoạch thật rất dài — đo hai mẫu trong phiên 58MB: 15.371 và 6.754 ký tự —
       nên phải GẬP mặc định, và tiêu đề "# ..." hiện ngay lúc gập để biết kế hoạch
       về cái gì mà không cần mở. */
    {
      const cx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pg = await cx.newPage();
      const KE = '# Sửa khung chat cho giống CLI\n\n## Bối cảnh\n\n'
        + 'x'.repeat(1200) + '\n\n## Các bước\n\n1. Một\n2. Hai\n';
      await pg.route('**/api/history/**', async (r) => {
        let res, j;
        try { res = await r.fetch(); j = await res.json(); } catch { return; }
        j.awaiting = true; j.typing = false;
        j.messages = [{
          role: 'assistant', content: '', ts: new Date().toISOString(),
          parts: [{
            t: 'tool', name: 'ExitPlanMode', id: 't-ke', disp: 'ExitPlanMode',
            summary: '', input: '', status: 'ok', result: '', images: [],
            ke: KE, keFile: process.env.HOME + '/.claude/plans/thu-nghiem.md',
          }],
        }];
        await r.fulfill({ response: res, json: j }).catch(() => {});
      });
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForSelector('[data-testid=session-row]:visible', { timeout: 20000 });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(2500);

      ok('ke hoach hien thanh the rieng, khong phai JSON tho',
        (await pg.locator('[data-testid=plan-card]').count()) === 1);

      const gap = await pg.locator('[data-testid=plan-card]').getAttribute('data-open');
      ok('ke hoach DAI thi gap lai mac dinh', gap === 'false', 'data-open=' + gap);

      const chu = await pg.locator('[data-testid=plan-card]').innerText();
      ok('luc gap van hien TIEU DE ke hoach',
        /Sửa khung chat cho giống CLI/.test(chu), chu.slice(0, 70).replace(/\n/g, ' '));

      // vẽ kiểu terminal: có ⏺ và ⌐, KHÔNG có khung bo góc nền màu
      ok('the ke hoach ve kieu terminal (co ⏺ va ⌐)',
        chu.includes('⏺') && chu.includes('⌐'), JSON.stringify(chu.slice(0, 40)));

      await pg.locator('[data-testid=plan-toggle]').click();
      await pg.waitForTimeout(500);
      ok('bam vao thi MO ra doc duoc',
        (await pg.locator('[data-testid=plan-card]').getAttribute('data-open')) === 'true');

      ok('co nut Duyet va nut mo ban .md',
        (await pg.locator('[data-testid=plan-approve]').count()) === 1
        && (await pg.locator('[data-testid=plan-file]').count()) === 1);

      /* /api/plan chỉ được đọc trong ~/.claude/plans. Kiểm bằng đường dẫn đã resolve
         chứ không phải chuỗi thô — nếu không thì `../../.ssh/id_rsa` lọt qua và
         dashboard thành công cụ đọc trộm cả đĩa. */
      const chan = await pg.evaluate(async () => {
        const thu = async (p) => (await fetch('/api/plan?path=' + encodeURIComponent(p))).status;
        return {
          ssh: await thu('/Users/mvng/.ssh/id_rsa'),
          cheo: await thu('/Users/mvng/.claude/plans/../../.zshrc'),
        };
      });
      ok('/api/plan chan doc file ngoai thu muc ke hoach',
        chan.ssh === 400 && chan.cheo === 400, JSON.stringify(chan));

      await dongSach(pg, cx);
    }

    /* Tab Docker: thống kê tài nguyên + khối PostgreSQL.
       Máy này KHÔNG có psql (đã kiểm `which psql`), nên server đi qua `docker exec`
       vào chính container. Cả hai đều PHỤ THUỘC MÔI TRƯỜNG (Docker Desktop bật/tắt,
       có container Postgres hay không) nên chỉ khẳng định khi thật sự có dữ liệu —
       không thì báo bỏ qua, đừng đỏ vì máy chưa bật Docker. */
    {
      const cx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
      const pg = await cx.newPage();
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.locator('[data-testid=nav-docker]:visible').first().click();
      await pg.waitForTimeout(5000);

      const dk = await pg.evaluate(async () => {
        const r = await fetch('/api/docker/ps').then((x) => x.json()).catch(() => ({}));
        const chay = (r.containers || []).filter((c) => c.State === 'running');
        return {
          dockerOk: !!r.ok,
          soChay: chay.length,
          coCpu: chay.filter((c) => c.cpu).length,
          hienTaiNguyen: document.querySelectorAll('[data-testid=dk-taiNguyen]').length,
        };
      });

      if (!dk.dockerOk) {
        ok('Docker: hien CPU/RAM cho container dang chay', true, 'bo qua: Docker dang tat');
      } else if (!dk.soChay) {
        ok('Docker: hien CPU/RAM cho container dang chay', true, 'bo qua: khong container nao chay');
      } else {
        ok('Docker: server tra CPU/RAM cho container dang chay',
          dk.coCpu === dk.soChay, dk.coCpu + '/' + dk.soChay + ' container co so lieu');
        ok('Docker: giao dien HIEN CPU/RAM',
          dk.hienTaiNguyen === dk.soChay, dk.hienTaiNguyen + ' dong co so lieu');
      }

      // Khối Postgres phải LUÔN có mặt — kể cả khi CSDL tắt, để báo lý do
      ok('tab Docker co khoi PostgreSQL',
        (await pg.locator('[data-testid=pg-panel]').count()) === 1);

      const pgSt = await pg.evaluate(() => fetch('/api/pg/status').then((x) => x.json()).catch(() => ({})));
      if (!pgSt.ok) {
        // Postgres tắt -> khối vẫn phải có mặt và NÓI RÕ lý do, không để trắng
        const coBao = await pg.locator('[data-testid=pg-tat]').count();
        ok('Postgres tat -> hien ly do, khong de trong', coBao === 1,
          (pgSt.error || 'khong ro').slice(0, 60));
        ok('Postgres: hien phien ban + so ket noi', true, 'bo qua: Postgres dang tat');
        ok('Postgres: liet ke database co that', true, 'bo qua: Postgres dang tat');
        ok('Postgres: chan ten database co ky tu la (chong tiem SQL)', true, 'bo qua: Postgres dang tat');
      } else {
        const noi = await pg.locator('[data-testid=pg-panel]').innerText();
        ok('Postgres: hien phien ban + so ket noi',
          /\d+\.\d+/.test(noi) && /kết nối/.test(noi), noi.slice(0, 60).replace(/\n/g, ' '));
        ok('Postgres: liet ke database co that',
          (pgSt.dbs || []).length > 0 && (await pg.locator('[data-testid=pg-db]').count()) === 1,
          (pgSt.dbs || []).length + ' database');

        // Chặn tiêm SQL qua tên database — client chỉ được chọn từ danh sách server trả
        const chan = await pg.evaluate(() => fetch('/api/pg/tables?db=a;DROP TABLE x')
          .then((r) => r.status).catch(() => 0));
        ok('Postgres: chan ten database co ky tu la (chong tiem SQL)',
          chan === 400, 'HTTP ' + chan);
      }
      await cx.close();
    }

    /* Tab AGY: biểu đồ hạn mức + thẻ số gọn trên điện thoại.
       /api/agy/quota-history có ở server TỪ LÂU mà không giao diện nào gọi — quét cả
       web-next tìm chuỗi đó ra 0 kết quả, nên dữ liệu (7 điểm, gemini 90-94%)
       chưa từng hiện ra. */
    {
      const cx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pg = await cx.newPage();
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.locator('[data-testid=nav-agy]:visible').first().click();
      await pg.waitForTimeout(4000);

      const coKhoi = await pg.locator('[data-testid=agy-quota-history]').count();
      ok('tab AGY co bieu do HAN MUC con lai', coKhoi === 1, coKhoi + ' khoi');
      if (coKhoi) {
        await pg.locator('[data-testid=agy-quota-history]').scrollIntoViewIfNeeded();
        await pg.waitForTimeout(1500);
        const d = await pg.evaluate(() => {
          const c = document.querySelector('[data-testid=agy-quota-history]');
          return { duong: c.querySelectorAll('.recharts-area').length, chu: c.innerText || '' };
        });
        // hai đường vì Gemini và bên thứ ba cạn theo nhịp khác nhau
        ok('bieu do han muc ve DU HAI duong + co chu giai mau',
          d.duong === 2 && /Gemini/.test(d.chu) && /thứ ba/.test(d.chu),
          d.duong + ' duong');
      }
      await cx.close();
    }

    /* Thẻ số AGY phải GỌN trên iPhone. Bản cũ dùng grid-cols-1 nên ba thẻ xếp dọc,
       mỗi thẻ ~250px, nuốt gần trọn màn 844px chỉ để hiện ba số 0. */
    {
      const mp = await browser.newContext({
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      });
      const pg = await mp.newPage();
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.locator('[data-testid=tabbar-agy]:visible').first().click();
      await pg.waitForTimeout(3500);

      const the = await pg.evaluate(() => {
        const ids = ['agy-reqs', 'agy-errs', 'agy-tokens'];
        const r = ids.map((i) => {
          const e = document.querySelector(`[data-testid=${i}]`);
          return e ? Math.round(e.getBoundingClientRect().height) : -1;
        });
        const a = document.querySelector('[data-testid=agy-reqs]');
        const b = document.querySelector('[data-testid=agy-errs]');
        return {
          cao: r,
          // 2 cột: thẻ 1 và 2 phải CÙNG hàng (chênh lệch top nhỏ)
          cungHang: !!(a && b)
            && Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 8,
        };
      });
      ok('the so AGY xep 2 cot tren iPhone (khong phai 1 cot)',
        the.cungHang, 'cao=' + JSON.stringify(the.cao));
      ok('the so AGY gon lai duoi 170px moi the',
        the.cao.every((h) => h > 0 && h < 170), JSON.stringify(the.cao));

      // 24h rỗng phải NÓI RÕ, không để ba số 0 trần
      const coBao = await pg.locator('[data-testid=agy-khong-luu-luong]').count();
      const reqs = await pg.locator('[data-testid=agy-reqs-value]').innerText().catch(() => '?');
      ok('24h khong co request -> noi ro ly do, khong de ba so 0 tran',
        reqs.trim() !== '0' || coBao === 1, 'reqs=' + reqs.trim() + ' bao=' + coBao);
      await mp.close();
    }

    /* Khung chat dùng TRỌN bề ngang, không kẹp 920px giữa màn hình như trước.
       Terminal không căn giữa nội dung; ở đây phần lớn là log tool và đường dẫn dài,
       bó lại thành ra xuống dòng liên tục còn hai bên bỏ trống. */
    {
      const cx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pg = await cx.newPage();
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForSelector('[data-testid=session-row]:visible', { timeout: 20000 });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(2000);

      const bd = await pg.evaluate(() => {
        const box = document.querySelector('[data-testid=chat-bubbles]');
        const o = document.querySelector('[data-testid=chat-input]').closest('div');
        return {
          rongChat: Math.round(box.getBoundingClientRect().width),
          rongMan: window.innerWidth,
          rongO: Math.round(o.getBoundingClientRect().width),
        };
      });
      // Trừ hao sidebar 256px + lề; cốt lõi là KHÔNG còn bị chặn ở 920px
      ok('khung chat dung tron be ngang (khong ke.p 920px)',
        bd.rongChat > 920, bd.rongChat + 'px / man ' + bd.rongMan + 'px');
      ok('khung go cung dan het be ngang', bd.rongO > 920, bd.rongO + 'px');

      ok('co dong goi y phim duoi o go (nhu CLI in ra)',
        (await pg.locator('[data-testid=input-hint]').count()) === 1);

      /* "!" chay bash, "#" ghi nho — hai che do cua Claude CLI.
         Da thu THAT truoc khi lam: ca hai chay qua `claude -p`, dung duong dashboard
         dang dung. Gui "!echo NOI_TU_DASHBOARD" qua dashboard tra ve dung chuoi do. */
      const o = pg.locator('[data-testid=chat-input]');
      await o.click();
      await o.fill('!ls -la');
      await pg.waitForTimeout(400);
      ok('go "!" -> bao che do chay bash',
        (await pg.locator('[data-testid=mode-hint]').getAttribute('data-che')) === 'bash',
        'data-che=' + await pg.locator('[data-testid=mode-hint]').getAttribute('data-che'));
      ok('dau nhac doi thanh "!"',
        (await pg.locator('[data-testid=prompt-sign]').innerText()).trim() === '!');

      await o.fill('#du an nay dung Node thuan');
      await pg.waitForTimeout(400);
      ok('go "#" -> bao che do ghi nho',
        (await pg.locator('[data-testid=mode-hint]').getAttribute('data-che')) === 'nho');
      ok('dau nhac doi thanh "#"',
        (await pg.locator('[data-testid=prompt-sign]').innerText()).trim() === '#');

      // Chu thuong thi KHONG duoc bao che do nao
      await o.fill('chao Claude');
      await pg.waitForTimeout(400);
      ok('cau thuong khong bao che do nao',
        (await pg.locator('[data-testid=mode-hint]').count()) === 0
        && (await pg.locator('[data-testid=prompt-sign]').innerText()).trim() === '>');

      // Go moi dau "!" (chua co lenh) thi chua tinh la che do
      await o.fill('!');
      await pg.waitForTimeout(400);
      ok('go moi dau "!" chua tinh la che do',
        (await pg.locator('[data-testid=mode-hint]').count()) === 0);
      await o.fill('');

      /* Thanh công cụ gom vào MỘT menu ⋯. Bản cũ bày 5 nút icon trần trên desktop;
         cộng nút quyền và effort là 7 hình vuông xám không nhãn cạnh nhau. */
      ok('cong cu phien gom vao mot menu ⋯',
        (await pg.locator('[data-testid=chat-more]').count()) === 1);
      await pg.locator('[data-testid=chat-more]').click();
      await pg.waitForTimeout(600);
      const soMuc = await pg.locator('[data-testid^=m-], [data-testid=model-chip]').count();
      ok('menu ⋯ co du 5 muc CO NHAN CHU', soMuc === 5, soMuc + ' muc');
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(400);

      /* Esc trong o go = dung Claude, dung nhu terminal.
         Dung phien GIA dang chay + chan /api/kill: khong duoc dung phien that cua Vinh. */
      let daKill = false;
      await pg.route('**/api/kill/**', async (r) => {
        daKill = true;
        await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }).catch(() => {});
      });
      await pg.route('**/api/history/**', async (r) => {
        let res, j;
        try { res = await r.fetch(); j = await res.json(); } catch { return; }
        j.status = 'RUNNING'; j.typing = true;
        await r.fulfill({ response: res, json: j }).catch(() => {});
      });
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-input]', { timeout: 20000 });
      await pg.waitForTimeout(1500);

      await pg.locator('[data-testid=chat-input]').click();
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(1200);
      ok('Esc trong o go -> DUNG Claude (nhu terminal)', daKill, 'da goi /api/kill=' + daKill);

      /* Chu hien DAN thay vi bung mot cuc khi xong.
         .jsonl chi duoc ghi KHI LUOT XONG. Do that: `claude -p` tran xa stdout DUNG
         MOT LAN luc ket thuc (5747ms/1 lan) -> doc stdout tran la vo ich. Phai co
         --output-format stream-json --include-partial-messages moi nhan tung doan
         (do lai: chu toi rai rac tu 5209ms qua 13 lan). Server gom delta.text va
         gan vao truong `nhap` cua /api/history. */
      await pg.unroute('**/api/history/**');
      await pg.route('**/api/history/**', async (r) => {
        let res, j;
        try { res = await r.fetch(); j = await res.json(); } catch { return; }
        j.typing = true; j.status = 'RUNNING';
        j.nhap = 'Dang go do dang tu ban nhap...';
        await r.fulfill({ response: res, json: j }).catch(() => {});
      });
      await pg.reload({ waitUntil: 'networkidle' });
      await pg.waitForTimeout(1200);
      await pg.locator('[data-testid=session-row]:visible').first().click();
      await pg.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
      await pg.waitForTimeout(2500);
      const goDo = await pg.locator('[data-testid=dang-go]').count();
      const chuGoDo = goDo ? await pg.locator('[data-testid=dang-go]').innerText() : '';
      ok('chu dang chay hien DAN trong khung chat',
        goDo === 1 && chuGoDo.includes('ban nhap'), goDo + ' khoi | ' + JSON.stringify(chuGoDo.slice(0, 50)));

      /* Gui vao phien KHONG TON TAI phai bao loi ro rang.
         Loi CO SAN tu truoc: /api/history tra ve som khi chua co .jsonl nao, nen
         banner loi khong bao gio hien — tin nhan roi vao hu khong ma man hinh im
         nhu khong co chuyen gi. Bat duoc khi doi sang stream-json. */
      await pg.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
      const bao = await pg.evaluate(async () => {
        const sid = '00000000-1111-4222-8333-44444444beef';
        await fetch('/api/chat/' + sid, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'thu' }),
        });
        for (let i = 0; i < 25; i++) {
          await new Promise((s) => setTimeout(s, 700));
          const h = await (await fetch('/api/history/' + sid)).json();
          if (h.error) return h.error;
          if (!h.typing && i > 5) return '(khong co loi nao)';
        }
        return '(het gio)';
      });
      ok('gui vao phien khong ton tai -> hien banner loi, khong im lang',
        /không tìm thấy phiên này/.test(bao), JSON.stringify(String(bao).slice(0, 90)));

      await dongSach(pg, cx);
    }

    /* Danh sách phiên kiểu THẺ — thay cho bảng 6 cột.
       Kiểm ở 390px vì đó là chỗ lỗi thật đã xảy ra: ô lưới mặc định min-width:auto,
       nên câu cuối dài đẩy thẻ phình lên 455px trong khung 356px, chữ bị cắt mất
       bên phải. Đo cả bề rộng chứ không chỉ đếm thẻ. */
    {
      const mp = await browser.newContext({
        viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      });
      const pg = await mp.newPage();
      await pg.goto(URL, { waitUntil: 'networkidle' });
      await pg.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
      await pg.waitForTimeout(2000);

      const d = await pg.evaluate(() => {
        const luoi = document.querySelector('[data-testid=session-grid]');
        if (!luoi) return null;
        const g = luoi.getBoundingClientRect();
        const the = [...document.querySelectorAll('[data-testid=session-row]')];
        return {
          so: the.length,
          tran: the.filter((c) => c.getBoundingClientRect().right > g.right + 1).length,
          coCauCuoi: document.querySelectorAll('[data-testid=card-last]').length,
          tranTrang: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      ok('danh sach phien dung LUOI THE', !!d && d.so > 0, d ? d.so + ' the' : 'khong thay luoi');
      ok('the KHONG tran khoi luoi tren iPhone 390px',
        !!d && d.tran === 0 && !d.tranTrang,
        d ? d.tran + ' the tran, trang tran=' + d.tranTrang : '-');
      ok('the co hien cau cuoi (dang do viec gi)',
        !!d && d.coCauCuoi > 0, d ? d.coCauCuoi + '/' + d.so + ' the co cau cuoi' : '-');

      /* Phan dau trang khong duoc an het cho cua noi dung.
         Do that truoc khi sua: header 133px, the dau tien nam o 439px tren man 844px
         -> qua NUA man hinh chi de toi duoc phien dau. Sau khi gom hang: 60px / 288px.
         Chot nguong long hon so do that de con cho thay doi nho. */
      const cao = await pg.evaluate(() => {
        const the = [...document.querySelectorAll('[data-testid=session-row]')];
        return {
          header: Math.round(document.querySelector('[data-testid=page-header]').getBoundingClientRect().height),
          top: Math.round(the[0].getBoundingClientRect().top),
          nhinThay: the.filter((c) => {
            const r = c.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight;
          }).length,
        };
      });
      ok('phan dau trang gon tren iPhone (truoc 133px)',
        cao.header <= 80, cao.header + 'px');
      ok('the phien dau tien khong bi day qua nua man hinh',
        cao.top < 340, 'top=' + cao.top + 'px (truoc 439px, man 844px)');
      ok('nhin thay it nhat 3 the cung luc',
        cao.nhinThay >= 3, cao.nhinThay + ' the trong khung nhin');

      // Ô chọn và menu ⋯ trước chỉ có ở bảng desktop; bản mobile cũ thiếu hẳn.
      ok('the co O CHON va menu ⋯ ngay tren dien thoai',
        (await pg.locator('[data-testid=sel-row]').count()) > 0
        && (await pg.locator('[data-testid=row-menu]').count()) > 0,
        'sel-row=' + (await pg.locator('[data-testid=sel-row]').count())
        + ' row-menu=' + (await pg.locator('[data-testid=row-menu]').count()));

      // Sắp xếp: bảng cũ để ở tiêu đề cột, bỏ bảng thì phải còn chỗ khác
      await pg.locator('[data-testid=sort-title]').click();
      await pg.waitForTimeout(700);
      ok('doi sap xep tu thanh dieu khien cua luoi',
        (await pg.locator('[data-testid=sort-title]').getAttribute('data-active')) === 'true',
        'data-active=' + (await pg.locator('[data-testid=sort-title]').getAttribute('data-active')));
      await mp.close();
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
