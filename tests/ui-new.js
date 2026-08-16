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
// Lưu lại bản cũ (nếu người dùng đang đặt mã thật) rồi trả về đúng như cũ ở cuối.
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
      /* Tab CLI KHÔNG còn page-header: tiêu đề "Phiên Claude" + mô tả + dải tóm tắt
         đẩy thẻ phiên đầu tiên xuống 296px trên iPhone (35% màn hình). Thay bằng
         hàng tab lọc (`tab-loc`) vừa gọn hơn vừa bấm được. Các tab khác giữ nguyên. */
      const m = await page.evaluate(() => ({
        tran: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        coHeader: !!document.querySelector('[data-testid=page-header]'),
        coTabLoc: !!document.querySelector('[data-testid=tab-loc]'),
      }));
      ok(`desktop /${t}: không tràn ngang + có phần đầu trang`,
        !m.tran && (t === 'cli' ? m.coTabLoc : m.coHeader), JSON.stringify(m));
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

    /* MÀN CẤU HÌNH — mở từ ô tên ở chân sidebar.
       KHÔNG làm thành tab thứ 6: thanh tab dưới ở 390px đã chật với 5 tab (xem bài
       "5 tab không tràn ngang"). */
    const oTen = (await page.locator('[data-testid=mo-cau-hinh]').innerText().catch(() => ''))
      .replace(/\s+/g, ' ').trim();
    /* Tên lấy từ tài khoản đang chạy server, KHÔNG viết cứng nữa — trước đây ai cài về
       cũng thấy tên chủ máy dev trên giao diện của mình. Nên chỉ kiểm "có tên", không
       kiểm tên cụ thể: máy khác chạy bài này sẽ ra tên khác. */
    ok('chân sidebar hiện tên người dùng (không phải tên viết cứng)',
      oTen.length >= 2, JSON.stringify(oTen));

    await page.click('[data-testid=mo-cau-hinh]');
    const moCH = await page.waitForSelector('[data-testid=man-cau-hinh]', { timeout: 10000 })
      .then(() => true).catch(() => false);
    ok('mở được màn cấu hình từ ô tên', moCH, String(moCH));

    if (moCH) {
      await page.waitForTimeout(600);
      const ch = await page.evaluate(() => ({
        cliKhoa: !!document.querySelector('[data-testid=cau-hinh-bat-cli]')?.disabled,
        coCapNhat: !!document.querySelector('[data-testid=nut-cap-nhat]'),
        ban: document.querySelector('[data-testid=cap-nhat-ban]')?.textContent?.trim() || '',
      }));
      // 'cli' là lý do tồn tại của app — tắt được nó thì mở dashboard ra không còn gì
      ok('tab Claude bị khoá, không tắt được', ch.cliKhoa, String(ch.cliKhoa));
      /* Nút cập nhật gom vào đây (trước nằm rời ở chân sidebar): cấu hình và cập nhật
         cùng là thứ thỉnh thoảng mới đụng. Phải cho biết đang ở bản nào — bấm cập nhật
         mà không biết mình đứng đâu thì không đoán được nó sẽ làm gì. */
      ok('màn cấu hình có nút cập nhật kèm số bản', ch.coCapNhat && !!ch.ban,
        `capNhat=${ch.coCapNhat} bản=${ch.ban}`);

      /* Tắt một tab thì nó phải biến khỏi thanh bên NGAY, không chờ tải lại trang.
         Giao diện đổi ngay (cập nhật lạc quan) rồi mới gọi server — bấm công tắc mà ô
         vuông đứng im tới khi mạng về thì người dùng tưởng bấm trượt rồi bấm lại.
         Đã gặp thật: bản đầu chờ server nên Playwright báo "clicking did not change
         its state". */
      const truocTat = await page.locator('[data-testid=nav-stats]').count();
      await page.uncheck('[data-testid=cau-hinh-bat-stats]');
      await page.waitForTimeout(1200);
      await page.click('[data-testid=cau-hinh-dong]');
      await page.waitForTimeout(800);
      const sauTat = await page.locator('[data-testid=nav-stats]').count();
      ok('tắt tab thì tab biến khỏi thanh bên', truocTat === 1 && sauTat === 0,
        `trước=${truocTat} sau=${sauTat}`);

      // trả lại như cũ, không để bài sau chạy trên trạng thái đã đổi
      await page.click('[data-testid=mo-cau-hinh]');
      await page.waitForTimeout(500);
      await page.check('[data-testid=cau-hinh-bat-stats]');
      await page.waitForTimeout(1000);
      await page.click('[data-testid=cau-hinh-dong]');
      await page.waitForTimeout(800);
      ok('bật lại thì tab hiện lại',
        (await page.locator('[data-testid=nav-stats]').count()) === 1, '');
    }

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
       Bản trước có avatar tròn + nhãn "Claude"/tên người dùng + bong bóng nền xanh; terminal
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

    /* CẤU TRÚC như Claude CLI in ra:
         ⏺ câu Claude nói      <- chấm màu CHỮ THƯỜNG
         ⏺ Bash(lệnh)          <- chấm TÍM, tím dành riêng cho tool
           ⎿ kết quả           <- THỤT VÀO, là con của tool
       Trước đây tô tím cả câu văn lẫn tool nên không phân biệt được Claude đang NÓI
       hay đang CHẠY LỆNH; còn ⎿ chỉ thụt 3px nên dính sát lề, nhìn ra ngang hàng
       với ⏺ trong khi nó là con. */
    const cauTruc = await page.evaluate(() => {
      const bub = document.querySelector('[data-testid=bubble] span');
      const tool = document.querySelector('[data-testid=tool-card-status]');
      const kq = document.querySelector('[data-testid=tool-card] > div:nth-child(2)');
      const note = document.querySelector('[data-testid=note-line] button');
      return {
        mauLuot: bub ? getComputedStyle(bub).color : '',
        mauTool: tool ? getComputedStyle(tool).color : '',
        thutKQ: kq ? Math.round(parseFloat(getComputedStyle(kq).paddingLeft)) : -1,
        thutNote: note ? Math.round(parseFloat(getComputedStyle(note).paddingLeft)) : -1,
      };
    });
    if (cauTruc.mauLuot && cauTruc.mauTool) {
      ok('cham cua LUOT khac mau cham cua TOOL (nhu CLI)',
        cauTruc.mauLuot !== cauTruc.mauTool,
        'luot=' + cauTruc.mauLuot + ' tool=' + cauTruc.mauTool);
    } else {
      ok('cham cua LUOT khac mau cham cua TOOL (nhu CLI)', true, 'bo qua: phien khong du phan tu');
    }
    ok('dong ⎿ ket qua THUT VAO lam con cua tool',
      cauTruc.thutKQ < 0 || cauTruc.thutKQ >= 12, cauTruc.thutKQ + 'px');
    ok('dong ⎿ hook loi cung thut vao', cauTruc.thutNote < 0 || cauTruc.thutNote >= 12,
      cauTruc.thutNote + 'px');
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
        /* Mốc thời gian PHẢI cố định. Dùng Date.now() thì mỗi vòng poll (2s) sinh mốc
           mới -> React key đổi -> thẻ dựng lại -> lựa chọn vừa bấm bị xoá sau ~3 giây.
           Đo được: data-active true ở 400ms và 1200ms, false ở 3000ms. Đây là lỗi của
           FIXTURE, không phải sản phẩm: thử lại với mốc cố định thì giữ nguyên. */
        const gio = (s) => new Date(Date.parse('2026-08-12T09:00:00.000Z') + s * 1000).toISOString();
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
       Bản trước đổ hết xuống một cột dọc: đo với 3 câu (đúng bộ trong ảnh người dùng gửi)
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
          role: 'assistant', content: '', ts: '2026-08-12T09:00:00.000Z',   // mốc CỐ ĐỊNH: giờ hiện tại làm React key đổi mỗi vòng poll -> mất state
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
        // Mốc CỐ ĐỊNH: Date.now() làm mỗi vòng poll sinh mốc mới -> React key
        // đổi -> thẻ dựng lại -> mất state đang thao tác dở.
        const t0 = Date.parse('2026-08-12T09:00:00.000Z');
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
        // Mốc CỐ ĐỊNH: Date.now() làm mỗi vòng poll sinh mốc mới -> React key
        // đổi -> thẻ dựng lại -> mất state đang thao tác dở.
        const t0 = Date.parse('2026-08-12T09:00:00.000Z');
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
        // Mốc CỐ ĐỊNH: Date.now() làm mỗi vòng poll sinh mốc mới -> React key
        // đổi -> thẻ dựng lại -> mất state đang thao tác dở.
        const t0 = Date.parse('2026-08-12T09:00:00.000Z');
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
        /* Thanh viec-dang-lam chiem 53px va CHI hien o phien dang co todo — nen
           chieu cao bong bong doi theo PHIEN NAO tinh co dung dau danh sach
           (do that: 636px voi todo-bar, 688px khong co). Cong lai phan do de bai
           nay do dung thu no muon: viec an header + tab bar co chay khong. */
        const tb = document.querySelector('[data-testid=todo-bar]');
        const buTodo = tb?.offsetParent ? Math.round(tb.getBoundingClientRect().height) : 0;
        /* Hang nut goi y (/ @ ! #) chiem 29px — them vao co chu dinh, doi lay 4 nut
           BAM DUOC tren iPhone thay vi chu nhac bi `hidden sm:` an het. Cong lai
           giong thanh todo, de bai nay van do dung thu no muon: viec an header +
           tab bar co chay khong. */
        const gy = document.querySelector('[data-testid=goi-y]');
        const buGoiY = gy?.offsetParent ? Math.round(gy.getBoundingClientRect().height) : 0;
        /* Alert "dang chay" (hoa Claude xoay + nut Dung) noi tren o go, CHI hien khi
           phien dang chay. Cung ly do voi todo-bar: khong bu thi bai nay do theo viec
           phien nao tinh co dung dau danh sach co dang chay hay khong. */
        const dc = document.querySelector('[data-testid=typing]');
        const buChay = dc?.offsetParent ? Math.round(dc.getBoundingClientRect().height) : 0;
        return {
          header: !!document.querySelector('[data-testid=app-header]')?.offsetParent,
          tabbar: !!document.querySelector('[data-testid=tabbar]')?.offsetParent,
          caoChat: Math.round(box.getBoundingClientRect().height) + buTodo + buGoiY + buChay,
          buTodo, buGoiY, buChay,
        };
      });
      ok('trong CHAT tren iPhone: an header va thanh tab',
        !oChat.header && !oChat.tabbar, JSON.stringify(oChat));

      /* Che do quyen + muc nghi phai HIEN tren dien thoai — hai thu quyet dinh Claude
         co tu sua file hay khong. Truoc day chung nam trong dong `input-hint` rieng;
         gio gop vao HANG 2 (`goi-y`) va ghim ben phai de khong bi cuon mat.
         Kiem CA su hien dien LAN noi dung doc duoc. */
      const dongTT = await pg.evaluate(() => {
        const h = document.querySelector('[data-testid=goi-y]');
        return { hien: !!h?.offsetParent, chu: (h?.innerText || '').trim() };
      });
      ok('hang 2 HIEN tren iPhone, doc duoc che do',
        dongTT.hien && dongTT.chu.length > 0,
        JSON.stringify(dongTT.chu.replace(/\n/g, ' · ').slice(0, 50)));
      /* 656px là số đo TRƯỚC khi ẩn header+tab bar; sau khi ẩn phải cao hơn.
         caoChat ĐÃ cộng lại phần thanh việc-đang-làm chiếm (xem trên), nếu không bài
         này đỏ NGẪU NHIÊN theo phiên nào tình cờ đứng đầu danh sách: phiên có todo
         cho 636px, phiên không có cho 688px. Đã đo 6 lần liên tiếp để xác định. */
      /* Nguong 655 chu khong phai 665: bai nay do "an header + tab bar co hieu qua
         khong", va con so goc la 656px TRUOC khi an. Moi lan them mot thanh chuc nang
         duoi o go (todo-bar, hang goi y) thi khung bong bong lai thap di vai px — dat
         nguong sat qua thi bai do chinh so thanh, khong phai thu no muon do. */
      ok('an xong thi khung chat cao hon (truoc 656px)',
        oChat.caoChat > 655, oChat.caoChat + 'px / man 844px'
        + (oChat.buTodo ? ' (bù ' + oChat.buTodo + 'px thanh todo)' : '')
        + (oChat.buGoiY ? ' (bù ' + oChat.buGoiY + 'px hàng gợi ý)' : ''));

      /* Hang nut goi y phai BAM DUOC va hien tren iPhone. Truoc day `/ @ ! #` chi la
         chu nhac `hidden sm:inline` -> tren iPhone khong thay gi, ma cung kho go vi
         ban phim ao phai chuyen sang bang ky hieu moi co `/` va `@`. */
      /* Tren iPhone hang nut nay `hidden sm:flex` — bay 5 nut tren mot hang cuon ngang
         o 390px thi chi thay hai nut ruoi, `#ghi nho` nam han ngoai man. Thay bang MOT
         nut mo sheet truot len, moi chuc nang deu thay cung luc kem mo ta. */
      await pg.locator('[data-testid=mo-chuc-nang]').click();
      await pg.waitForTimeout(400);
      const mucSheet = await pg.evaluate(() => {
        // bo `sheet-chuc-nang` (vo sheet) va `sheet-nen` (nen bam de dong) — khong phai muc
        const BO = ['sheet-chuc-nang', 'sheet-nen'];
        const ds = [...document.querySelectorAll('[data-testid^=sheet-]')]
          .filter((e) => !BO.includes(e.getAttribute('data-testid')));
        return { so: ds.length, hien: ds.filter((e) => !!e.offsetParent).length,
          nhan: ds.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)) };
      });
      // 4 ky tu mo dau + dinh anh + xem file
      ok('iPhone: sheet chuc nang hien du 6 muc', mucSheet.hien === 6,
        mucSheet.hien + '/' + mucSheet.so + ': ' + mucSheet.nhan.join(' | '));

      // Bam muc `/` trong sheet phai CHEN ky tu vao o nhap (nhu go tay)
      const truocGo = await pg.inputValue('[data-testid=chat-input]').catch(() => '');
      await pg.click('[data-testid=sheet-lệnh]').catch(() => {});
      await pg.waitForTimeout(400);
      const sauGo = await pg.inputValue('[data-testid=chat-input]').catch(() => '');
      ok('bam muc sheet chen ky tu vao o nhap', sauGo.endsWith('/') && sauGo !== truocGo,
        JSON.stringify(truocGo) + ' -> ' + JSON.stringify(sauGo));

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
          role: 'assistant', content: '', ts: '2026-08-12T09:00:00.000Z',   // mốc CỐ ĐỊNH: giờ hiện tại làm React key đổi mỗi vòng poll -> mất state
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

      /* Nút "Góp ý" phải MỞ Ô SOẠN ngay trong thẻ. Trước đây nó chỉ gọi .focus() vào
         ô nhập chính rồi thôi — người dùng phải tự đoán rằng gõ vào đó rồi bấm Duyệt
         thì chữ đó thành ghi chú. Server vốn ĐÃ nhận body.note và ghép vào prompt
         duyệt từ lâu, chỉ giao diện không nói ra. */
      await pg.locator('[data-testid=plan-edit]').click();
      await pg.waitForTimeout(600);
      const oGopY = await pg.locator('[data-testid=plan-note]').count();
      ok('bam "Gop y" -> mo o soan NGAY TRONG the (truoc: chi focus, khong noi gi)',
        oGopY === 1, 'plan-note=' + oGopY);

      /* Bản đầy đủ phải đọc được TRONG APP. Trước đây là thẻ <a target="_blank"> trỏ
         /api/plan, mà endpoint đó trả text/plain — kế hoạch 15.000 ký tự hiện ra dạng
         chữ thô, không tiêu đề, không xuống dòng hợp lý. */
      await pg.locator('[data-testid=plan-file]').click();
      await pg.waitForTimeout(800);
      const moDayDu = await pg.locator('[data-testid=plan-full]').count();
      ok('bam "Xem day du" -> mo man doc trong app (khong phai tab moi)',
        moDayDu === 1, 'plan-full=' + moDayDu);
      if (moDayDu) {
        await pg.locator('[data-testid=plan-full-dong]').click();
        await pg.waitForTimeout(400);
        ok('dong duoc man xem day du',
          (await pg.locator('[data-testid=plan-full]').count()) === 0);
      }

      /* /api/plan chỉ được đọc trong ~/.claude/plans. Kiểm bằng đường dẫn đã resolve
         chứ không phải chuỗi thô — nếu không thì `../../.ssh/id_rsa` lọt qua và
         dashboard thành công cụ đọc trộm cả đĩa. */
      /* Truyền HOME vào chứ không viết cứng "/Users/<tên>": bài này từng chỉ chạy đúng
         trên đúng một máy, máy khác thì đường dẫn không tồn tại nên 400 vì lý do SAI —
         xanh mà không kiểm được gì. */
      const chan = await pg.evaluate(async (nha) => {
        const thu = async (p) => (await fetch('/api/plan?path=' + encodeURIComponent(p))).status;
        return {
          ssh: await thu(nha + '/.ssh/id_rsa'),
          cheo: await thu(nha + '/.claude/plans/../../.zshrc'),
        };
      }, os.homedir());
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

      ok('co hang 2 duoi o go (nut chuc nang + che do)',
        (await pg.locator('[data-testid=goi-y]').count()) === 1);

      /* Che do quyen + MODEL nam trong HANG 2 duoi o go — hai thu quyet dinh Claude
         co tu sua file hay khong va tra loi bang model nao, phai luon nhin thay.
         Truoc day o header va bi `hidden sm:flex` an han tren dien thoai; roi chuyen
         xuong dong `input-hint` rieng; gio gop vao hang 2 va GHIM BEN PHAI
         (shrink-0) nen khong bao gio bi cuon mat khi hang chat.

         Cho MUC NGHI da doi cho MODEL: model anh huong chat luong nhieu hon, lai la
         thu can liec thay ngay khi dang nhan. Muc nghi chuyen vao menu ⋯ — van doi
         duoc, chi khong chiem cho hang chinh. */
      const trongDong = await pg.evaluate(() => {
        const h = document.querySelector('[data-testid=goi-y]');
        return {
          perm: !!h?.querySelector('[data-testid=chat-perm]'),
          model: !!h?.querySelector('[data-testid=chat-model-btn]'),
          // muc nghi KHONG con o hang 2 nua
          effortHang2: !!h?.querySelector('[data-testid=effort-btn]'),
        };
      });
      ok('che do quyen + model nam trong hang 2',
        trongDong.perm && trongDong.model && !trongDong.effortHang2,
        JSON.stringify(trongDong));

      // ...va muc nghi phai VAO menu ⋯, khong bi mat han
      await pg.click('[data-testid=chat-more]');
      await pg.waitForTimeout(600);
      const coEffort = await pg.locator('[data-testid=m-effort]').count();
      ok('muc nghi chuyen vao menu ⋯ (khong bi mat)', coEffort === 1, 'm-effort=' + coEffort);
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(400);

      /* Khung nhap KHONG duoc la hop bo goc — dau nhac `❯`/`!`/`#` la thu bao che do,
         giong dong nhap cua Claude CLI.
         Duong ke ngang phia tren o go DA BO co y: tren iPhone no an 10px vung doc chat
         ma chi noi lai dung thu dau nhac ngay ben canh da noi (dau nhac doi mau y het).
         Nen o day chi con kiem: dau nhac dung, va khung khong bo goc kieu hop chat. */
      const khung = await pg.evaluate(() => {
        const dau = document.querySelector('[data-testid=prompt-sign]');
        const k = dau?.closest('div');
        const cs = k ? getComputedStyle(k) : null;
        const o = document.querySelector('[data-testid=chat-input]');
        return {
          dauNhac: (dau?.textContent || '').trim(),
          bo: cs ? Math.round(parseFloat(cs.borderRadius)) : -1,
          nenOGo: o ? getComputedStyle(o).backgroundColor : '',
        };
      });
      ok('dau nhac la ❯ dung nhu CLI', khung.dauNhac === '❯', khung.dauNhac);
      ok('khung nhap khong phai hop bo goc', khung.bo === 0, `bo=${khung.bo}`);

      /* Ô NHẬP KHI VIẾT DÀI. Đo trước khi sửa trên iPhone 390px: rỗng 44px, 6 dòng
         188px, 40 dòng chạm trần 295px (35% màn) và vùng đọc chat còn 411px.
         Ba lỗi đã sửa: `field-sizing-content` (kế thừa từ Textarea gốc) đánh nhau với
         `style.height` gán tay — hai cơ chế co giãn cùng chạy trên một phần tử; hai
         mốc trần lệch nhau (`innerHeight*0.35` trong JS vs `35dvh` trong CSS, khác
         nhau trên iOS khi thanh URL co giãn); và thiếu `overflow-y-auto` tường minh. */
      await pg.fill('[data-testid=chat-input]', 'dòng test dài hơn chút\n'.repeat(60));
      await pg.waitForTimeout(700);
      const oDai = await pg.evaluate(() => {
        const t = document.querySelector('[data-testid=chat-input]');
        const box = document.querySelector('[data-testid=chat-bubbles]');
        return {
          cao: Math.round(t.getBoundingClientRect().height),
          tran: Math.round(window.innerHeight * 0.35),
          /* Cộng lại thanh việc-đang-làm và dải đang-chạy như các bài khác trong file:
             chúng CHỈ hiện ở phiên có todo / đang chạy, nên không bù thì bài này đỏ
             ngẫu nhiên theo việc phiên nào tình cờ đứng đầu danh sách. */
          chat: Math.round(box.getBoundingClientRect().height)
            + ['todo-bar', 'typing'].reduce((s, id) => {
              const e = document.querySelector(`[data-testid=${id}]`);
              return s + (e && e.offsetParent ? Math.round(e.getBoundingClientRect().height) : 0);
            }, 0),
          cuonDuoc: t.scrollHeight > t.clientHeight + 1,
          coNutMoRong: !!document.querySelector('[data-testid=chat-mo-rong]'),
        };
      });
      ok('o nhap dai KHONG vuot tran 35% man',
        oDai.cao <= oDai.tran + 2, `${oDai.cao}px / tran ${oDai.tran}px`);
      ok('o nhap dai CUON duoc trong o', oDai.cuonDuoc, String(oDai.cuonDuoc));
      /* Ngưỡng 340 chứ không phải 380: đo trên phiên này ra 410px, nhưng phiên khác
         có tên dài 2 dòng hay dải chờ duyệt thì tụt còn 366px — đặt sát quá là bài
         đỏ ngẫu nhiên theo phiên nào tình cờ đứng đầu danh sách. Điều cần bảo đảm là
         ô nhập KHÔNG nuốt hết chỗ đọc, chứ không phải một con số cụ thể. */
      ok('van con cho doc chat khi o nhap day', oDai.chat > 340, oDai.chat + 'px');

      /* Nút mở rộng: viết dài trong ô 295px rất khổ, mà bỏ trần thì ô nuốt hết màn.
         Mở màn soạn riêng, ô gõ chiếm trọn chiều cao còn lại. */
      ok('viet dai thi hien nut mo rong', oDai.coNutMoRong, String(oDai.coNutMoRong));
      if (oDai.coNutMoRong) {
        await pg.click('[data-testid=chat-mo-rong]');
        await pg.waitForSelector('[data-testid=man-soan]', { timeout: 10000 });
        await pg.waitForTimeout(600);
        const soan = await pg.evaluate(() => {
          const t = document.querySelector('[data-testid=soan-input]');
          return { cao: Math.round(t.getBoundingClientRect().height),
            dem: (document.querySelector('[data-testid=soan-dem]') || {}).textContent || '' };
        });
        ok('man soan cho o go cao hon han o trong chat',
          soan.cao > oDai.tran * 1.5, `${soan.cao}px vs ${oDai.cao}px`);
        ok('man soan dem so ky tu va dong', /ký tự/.test(soan.dem) && /dòng/.test(soan.dem), soan.dem);
        await pg.click('[data-testid=soan-dong]');
        await pg.waitForTimeout(500);
        ok('dong duoc man soan', (await pg.locator('[data-testid=man-soan]').count()) === 0);
      }
      await pg.fill('[data-testid=chat-input]', '');
      await pg.waitForTimeout(400);
      /* Textarea goc co san `dark:bg-input/30` — bien the dark THANG `bg-transparent`
         thuong, nen o giao dien toi o go noi mot mang xam giua khung mono. */
      ok('o go KHONG co nen (terminal khong co nen nao)',
        /rgba\(0, 0, 0, 0\)|transparent/.test(khung.nenOGo), khung.nenOGo);

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
        // ❯ chứ không phải ">": bắt được trong bản ghi PTY của Claude CLI thật
        && (await pg.locator('[data-testid=prompt-sign]').innerText()).trim() === '❯');

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
      ok('menu ⋯ co du 6 muc CO NHAN CHU', soMuc === 6, soMuc + ' muc');

      /* XEM ANH CA PHIEN. Khung chat chi doc 30 tin CUOI (payload 25KB moi 2 giay)
         nen anh cu khong voi toi duoc — do tren phien 58MB that: 128 anh, KHONG cai
         nao nam trong cua so do. Day dung la chuyen "chua xem duoc anh": anh khong
         hong, chi la khong co duong toi. */
      await pg.locator('[data-testid=m-anh]').click();
      await pg.waitForSelector('[data-testid=anh-phien]', { timeout: 20000 });
      // endpoint quet ca file (do 285ms tren file 58MB) nen cho co dieu kien
      await pg.waitForSelector('[data-testid=anh-o], [data-testid=anh-trong]', { timeout: 25000 })
        .catch(() => {});
      const soAnh = await pg.locator('[data-testid=anh-o]').count();
      const trong = await pg.locator('[data-testid=anh-trong]').count();
      ok('bang "Anh trong phien" mo duoc va co ket qua',
        soAnh > 0 || trong === 1, soAnh + ' anh' + (trong ? ' (phien nay khong co anh)' : ''));

      if (soAnh) {
        /* Anh phai TAI THAT, khong phai o vuong trong.
           Cho CO DIEU KIEN: anh dung loading=lazy va moi anh ~100KB, do ngay sau khi
           bang mo ra thi complete=false — bai do oan khoang 1/3 lan chay. */
        await pg.waitForFunction(() => {
          const im = document.querySelector('[data-testid=anh-o] img');
          return !!im && im.complete && im.naturalWidth > 0;
        }, { timeout: 20000 }).catch(() => {});
        const taiDuoc = await pg.evaluate(() => {
          const im = document.querySelector('[data-testid=anh-o] img');
          return !!im && im.complete && im.naturalWidth > 0;
        });
        ok('anh trong bang tai THAT (co kich thuoc that)', taiDuoc, 'naturalWidth > 0');

        /* O anh phai CAO bang anh ben trong. Loi da gap: o co lai con 11px trong khi
           anh cao 104px -> anh tran ra ngoai, ca bang thanh mot day o rong chi co
           dong chu kich thuoc. Dem so anh van dung 128, nen KHONG bat duoc neu chi
           dem — phai do chieu cao. */
        const cao = await pg.evaluate(() => {
          const o = document.querySelector('[data-testid=anh-o]');
          const im = o.querySelector('img');
          return { o: Math.round(o.getBoundingClientRect().height),
            anh: Math.round(im.getBoundingClientRect().height) };
        });
        ok('o anh cao bang anh ben trong (khong bi co lai)',
          cao.o >= cao.anh && cao.anh > 40, `o=${cao.o}px anh=${cao.anh}px`);

        /* HANG LUOI cung phai cao theo noi dung. Thieu auto-rows-max thi trinh duyet
           chia deu chieu cao khung cho 33 hang — do duoc 10.78px/hang trong khi o cao
           144px, cac o tran xuong de len nhau. */
        const hang = await pg.evaluate(() => {
          const luoi = document.querySelector('[data-testid=anh-o]').parentElement;
          const r = getComputedStyle(luoi).gridTemplateRows.split(' ')[0];
          return Math.round(parseFloat(r) || 0);
        });
        ok('hang luoi cao theo noi dung (khong bi chia deu)',
          hang >= cao.anh, hang + 'px/hang, o cao ' + cao.o + 'px');
      }
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(500);
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(400);

      /* Esc trong o go = dung Claude, dung nhu terminal.
         Dung phien GIA dang chay + chan /api/kill: khong duoc dung phien that cua nguoi dung. */
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

      /* Trang thai DANG CHAY kieu CLI: bong hoa XOAY + dong tu + so giay troi.
         Ban cu chi co ba cham xam nhap nhay — khong biet Claude dang lam gi, chay bao
         lau, hay da treo. */
      const co = await pg.locator('[data-testid=hoa-xoay]').count();
      if (co) {
        const a = await pg.locator('[data-testid=hoa-xoay]').innerText();
        await pg.waitForTimeout(700);
        const b = await pg.locator('[data-testid=hoa-xoay]').innerText();
        ok('bong hoa Claude XOAY (khong dung yen)', a !== b, JSON.stringify(a + ' -> ' + b));
        const chu = await pg.locator('[data-testid=typing]').innerText();
        /* Chu doi theo thoi gian cho — giong Claude CLI, de biet no khong dung im.
           Da chot giong suong sa ("De tao nghi ti", "Kho vcl, cho ti") nen KHONG
           khop cung chuoi: chi doi hoi co chu tieng Viet + so giay. */
        ok('co dong tu + so giay troi',
          /[a-zà-ỹ]{3,}/i.test(chu) && /\d+s/.test(chu), JSON.stringify(chu.replace(/\n/g, ' ')));
      } else {
        ok('bong hoa Claude XOAY (khong dung yen)', true, 'bo qua: khong o trang thai dang chay');
        ok('co dong tu + so giay troi', true, 'bo qua: khong o trang thai dang chay');
      }

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

      /* NUT TRON NOI khong duoc de len nut `⋯` cua the nao.
         No neo `fixed` o goc phai, con the thi CUON QUA DUOI no — the nao troi toi do
         la nut menu cua the do bi che. Do that tren Debian qua Tailscale: the o
         top=715px co nut ⋯ nam gon duoi nut noi (x 318-374), bam vao ra man giao viec
         chu khong ra menu the. Sua bang cach chua cho o cuoi vung cuon (pb-24).
         Kiem sau khi CUON XUONG DAY — luc do the cuoi moi sat nut nhat. */
      await pg.evaluate(() => {
        const el = document.querySelector('[data-testid=cli-list] .overflow-y-auto');
        if (el) el.scrollTop = el.scrollHeight;
      });
      await pg.waitForTimeout(900);
      const deLen = await pg.evaluate(() => {
        const fab = document.querySelector('[data-testid=new-session]');
        /* KHONG dung offsetParent de xet "co hien khong": nut nay `position: fixed`,
           ma offsetParent LUON tra null voi phan tu fixed — bai nay tung bao "khong co
           nut noi" va xanh gia trong khi nut van nam do de len the that. Do bang
           kich thuoc thuc te. */
        const f = fab && fab.getBoundingClientRect();
        if (!f || f.width === 0 || f.height === 0) return { bo: true };
        const cham = [];
        for (const e of document.querySelectorAll('[data-testid=row-menu]')) {
          if (!e.offsetParent) continue;
          const r = e.getBoundingClientRect();
          if (r.bottom < 0 || r.top > innerHeight) continue;   // ngoai khung nhin
          if (!(r.right < f.left || r.left > f.right || r.bottom < f.top || r.top > f.bottom))
            cham.push(Math.round(r.top));
        }
        return { cham, fab: Math.round(f.top) };
      });
      ok('nut noi khong de len nut ⋯ cua the nao',
        deLen.bo || deLen.cham.length === 0,
        deLen.bo ? 'khong co nut noi' : `nut noi top=${deLen.fab}, the bi che: ${deLen.cham.join(',') || 'khong'}`);

      /* Phan dau trang khong duoc an het cho cua noi dung.
         Do that truoc khi sua: header 133px, the dau tien nam o 439px tren man 844px
         -> qua NUA man hinh chi de toi duoc phien dau. Sau khi gom hang: 60px / 288px.
         Chot nguong long hon so do that de con cho thay doi nho. */
      const cao = await pg.evaluate(() => {
        const the = [...document.querySelectorAll('[data-testid=session-row]')];
        /* `page-header` da bo han: tieu de + dai tom tat chiem 296px tren 844px chi de
           noi lai thu hang tab da noi. Gio phan dau trang bat dau bang hang tab. */
        const dau = document.querySelector('[data-testid=tab-loc]');
        return {
          header: dau ? Math.round(dau.getBoundingClientRect().height) : -1,
          top: the.length ? Math.round(the[0].getBoundingClientRect().top) : -1,
          nhinThay: the.filter((c) => {
            const r = c.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight;
          }).length,
        };
      });
      ok('phan dau trang gon tren iPhone (truoc 133px)',
        cao.header <= 80, cao.header + 'px');

      /* Ca BON tab phai nam tron trong 390px. Hang tab cuon ngang duoc, nen tab thu tu
         ("Viec nen") tran ra ngoai thi khong vo giao dien — nhung nhin vao tuong chi co
         ba tab, khong ai vuot di tim cai thu tu. Do that: da bi cat mot lan. */
      const tabTran = await pg.evaluate(() => {
        const h = document.querySelector('[data-testid=tab-loc]');
        if (!h) return { loi: 'khong thay hang tab' };
        const g = h.getBoundingClientRect();
        const ds = [...h.querySelectorAll('[data-testid^=tab-]')];
        return {
          so: ds.length,
          tran: ds.filter((e) => e.getBoundingClientRect().right > g.right + 1).length,
          cuoi: ds.length ? (ds[ds.length - 1].textContent || '').trim() : '',
        };
      });
      ok('ca 4 tab loc nam tron trong man 390px',
        tabTran.so === 4 && tabTran.tran === 0, JSON.stringify(tabTran));
      ok('the phien dau tien khong bi day qua nua man hinh',
        cao.top < 340, 'top=' + cao.top + 'px (truoc 439px, man 844px)');
      ok('nhin thay it nhat 3 the cung luc',
        cao.nhinThay >= 3, cao.nhinThay + ' the trong khung nhin');

      /* VUNG CHAM cua o chon phai du 44px. O vuong chi 16x16 — do that: ngon tay lech
         18px la TRUOT, ma truot thi roi vao the va MO NHAM PHIEN chu khong phai khong
         an gi. Bao ve bang <label> boc ngoai, khong phong to o vuong (giu bo cuc).
         Do VUNG CHAM (label) chu khong do o vuong: do o vuong thi luon bao 16px.

         Tren iPhone o chon gio AN cho toi khi cham giu mot the (hang "Chon ca trang"
         da bo han vi chi con mot o vuong tro troi khong ai hieu). Nen phai bat che do
         chon TRUOC khi do — do luc dang an thi ra 0x0, bao loi gia. */
      await pg.evaluate(() => {
        const el = document.querySelector('[data-testid=session-row]');
        if (el) el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
      });
      await pg.waitForTimeout(800);
      const cham = await pg.evaluate(() => {
        const do1 = (id) => {
          const c = document.querySelector(`[data-testid=${id}]`);
          if (!c || !c.offsetParent) return null;   // dang an -> khong do
          const lb = c.closest('label') || c;
          const r = lb.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height) };
        };
        return { row: do1('sel-row'), all: do1('sel-all') };
      });
      ok('o chon tung the co vung cham >= 40px (sau khi cham giu)',
        !!cham.row && cham.row.w >= 40 && cham.row.h >= 40,
        JSON.stringify(cham.row));
      // "Chon ca trang" CO CHU DINH khong co tren iPhone: hang do an 45px ma chu bi an,
      // chi con mot o vuong tro troi. Desktop van co (kiem o phan G).
      ok('iPhone khong con hang "Chon ca trang" (da thay bang cham giu)',
        cham.all === null, JSON.stringify(cham.all));

      // Ô chọn và menu ⋯ trước chỉ có ở bảng desktop; bản mobile cũ thiếu hẳn.
      ok('the co O CHON va menu ⋯ ngay tren dien thoai',
        (await pg.locator('[data-testid=sel-row]').count()) > 0
        && (await pg.locator('[data-testid=row-menu]').count()) > 0,
        'sel-row=' + (await pg.locator('[data-testid=sel-row]').count())
        + ' row-menu=' + (await pg.locator('[data-testid=row-menu]').count()));

      /* Sắp xếp: bảng cũ để ở tiêu đề cột, bỏ bảng thì phải còn chỗ khác.
         Bốn nút sắp xếp GIỜ NẰM TRONG MENU (nút `mo-loc`), không còn bày phẳng thành
         một hàng riêng — hàng đó ăn 43px vĩnh viễn cho thứ phần lớn thời gian để
         nguyên "Mới nhất". Phải mở menu rồi mới bấm được. */
      await pg.locator('[data-testid=mo-loc]').click();
      await pg.waitForSelector('[data-testid=menu-loc]', { timeout: 10000 });
      await pg.waitForTimeout(400);
      await pg.locator('[data-testid=sort-title]').click();
      await pg.waitForTimeout(700);
      ok('doi sap xep tu menu loc',
        (await pg.locator('[data-testid=sort-title]').getAttribute('data-active')) === 'true',
        'data-active=' + (await pg.locator('[data-testid=sort-title]').getAttribute('data-active')));
      await pg.locator('[data-testid=sheet-nen]').click().catch(() => {});
      await pg.waitForTimeout(400);
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
      /* Nút chọn chế độ đã chuyển vào MÀN GIAO VIỆC riêng — trước đây nó nằm trong
         thanh dẹt dưới đáy danh sách, thanh đó chiếm 109px vĩnh viễn mà lúc cần gõ
         lại quá chật. Phải mở màn ra mới thấy. */
      await pg.click('[data-testid=new-session]');
      await pg.waitForSelector('[data-testid=man-tao-task]', { timeout: 10000 });
      await pg.waitForTimeout(600);
      const seg = await pg.evaluate(() => {
        const s = document.querySelector('[data-testid=mode-seg]');
        if (!s) return null;
        const cuoi = document.querySelector('[data-testid=mode-seg-creative]');
        const r = cuoi?.getBoundingClientRect();
        return {
          cuonDuoc: s.scrollWidth > s.clientWidth,
          rong: Math.round(s.clientWidth),
          // Nút CUỐI có nằm trọn trong khung không — đây mới là thứ cần bảo đảm
          nutCuoiTron: !!r && r.right <= s.getBoundingClientRect().right + 1,
        };
      });
      /* Điều cần bảo đảm là KHÔNG CẮT MẤT NÚT CUỐI, chứ không phải "phải cuộn được".
         Trong thanh dẹt cũ 4 nút tràn nên bắt buộc cuộn; màn giao việc riêng rộng
         hơn nên vừa hết — vừa hết thì tốt hơn cuộn, miễn là nút cuối không bị cắt. */
      ok('nút chọn chế độ không cắt mất nút cuối trên iPhone',
        !!seg && (seg.nutCuoiTron || seg.cuonDuoc),
        seg ? `khung ${seg.rong}px, cuộn ${seg.cuonDuoc}, nút cuối trọn ${seg.nutCuoiTron}` : 'không thấy');
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

      /* BA CÔNG TẮC phải cao BẰNG NHAU. Chúng nằm cùng một hàng flex ở màn này, nên
         lệch là nhìn thấy ngay. Đã lệch thật: ModelSwitch để `h-10` trong khi Perm và
         Effort `h-8` — chênh 8px, hậu quả của việc chép thành ba file riêng (trùng
         nhau 75-80%). Giờ cả ba gọi chung cong-tac.tsx nên không còn chỗ để lệch. */
      const caoNut = await pg.evaluate(() => {
        const ra = {};
        for (const id of ['model-btn', 'perm-btn', 'effort-btn']) {
          const e = document.querySelector(`[data-testid=${id}]`);
          if (e && e.offsetParent) ra[id] = Math.round(e.getBoundingClientRect().height);
        }
        return ra;
      });
      const ds = Object.values(caoNut);
      ok('ba công tắc cao bằng nhau (trước: model lệch 8px)',
        ds.length >= 2 && new Set(ds).size === 1, JSON.stringify(caoNut));
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

    /* CUỘN LÊN ĐỌC LẠI thì chữ dưới mắt phải ĐỨNG YÊN qua các vòng poll.
       Server chỉ trả 30 tin gần nhất: mỗi lượt mới đến là tin cũ nhất bị đẩy ra khỏi
       mảng, khung co lại TỪ PHÍA TRÊN, mà scrollTop vẫn nguyên số cũ -> con trỏ cuộn
       trỏ sang đoạn chữ khác. Người dùng mô tả đúng triệu chứng: "kéo lên quá thì nó dính
       trên cùng màn hình" — dính ở top=0 trong khi nội dung bên dưới trượt đi.
       Đo trước khi sửa, phiên đang chạy, giữ nguyên 8 vòng: cao 2683 -> 2725 -> 2661,
       lượt đầu đổi 2 lần. Sau khi bù chênh lệch chiều cao: 8/8 vòng đứng yên. */
    await page.evaluate(() => { document.querySelector('[data-testid=chat-bubbles]').scrollTop = 120; });
    await page.waitForTimeout(400);
    const dauCuon = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=chat-bubbles]');
      return { top: Math.round(el.scrollTop), cao: Math.round(el.scrollHeight) };
    });
    await page.waitForTimeout(6500);   // ~3 vòng poll
    const sauCuon = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=chat-bubbles]');
      return { top: Math.round(el.scrollTop), cao: Math.round(el.scrollHeight) };
    });
    /* Khung không đổi chiều cao -> scrollTop phải y nguyên. Khung có đổi (lượt mới về)
       -> scrollTop phải dịch ĐÚNG bằng phần chênh, tức chữ dưới mắt không nhúc nhích. */
    const chenh = sauCuon.cao - dauCuon.cao;
    const lech = Math.abs((sauCuon.top - dauCuon.top) - chenh);
    ok('cuộn lên đọc lại: chữ không trượt khi có tin mới về',
      lech <= 2, `cao ${dauCuon.cao}->${sauCuon.cao} (chênh ${chenh}), top ${dauCuon.top}->${sauCuon.top}, lệch ${lech}px`);
    // và vẫn phải cuộn xuống được đáy như thường
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid=chat-bubbles]');
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(2600);
    const oDay = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=chat-bubbles]');
      return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    });
    ok('cuộn xuống đáy rồi thì vẫn tự bám tin mới', oDay, String(oDay));

    // 62: tạo job lặp/cron rồi HUỶ — kiểm cả endpoint xoá (trước đây không có, job chạy mãi)
    await page.click('[data-testid=chat-back]').catch(() => {});
    await page.waitForTimeout(1200);
    /* Viec nen gio nam o TAB RIENG, khong con la dai nhet giua danh sach phien nua —
       phai bam tab truoc, khong thi JobsPanel chua duoc dung ra. */
    await page.click('[data-testid=tab-jobs]');
    await page.waitForTimeout(600);
    const truoc = await page.locator('[data-testid=job-row]').count();
    /* KHONG bam `jobs-toggle` nua: trong tab rieng JobsPanel mo san (`moSan`), bam vao
       la GAP LAI dung thu vua mo ra. Chi bam khi no dang gap. */
    if (!(await page.locator('[data-testid=job-new-cron]').isVisible().catch(() => false))) {
      await page.click('[data-testid=jobs-toggle]').catch(() => {});
      await page.waitForTimeout(500);
    }
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

  /* ---------- F2. Xem file trong du an (kieu VSCode, khong to mau) ----------
     Doc ma nguon ngay tren dashboard: truoc day muon xem file Claude vua sua phai mo
     may tinh ra. Kiem ca giao dien LAN chot chan duong dan o server — day la thu duy
     nhat trong app doc file tuy y theo yeu cau tu ngoai. */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
    await page.waitForTimeout(2000);
    /* Phai mo dung phien CO thu muc du an. The dau danh sach hay la phien "(khong ro)"
       — phien khong ghi cwd trong .jsonl (vd phien tao roi bo ngay), luc do cay thu muc
       RONG la dung: giao dien bao "Phien nay khong co thu muc lam viec".
       Loc bang o tim de chac chan roi vao du an that. */
    await page.fill('[data-testid=search-box]', 'control');
    await page.waitForTimeout(900);
    await page.locator('[data-testid=session-row]:visible').first().click();
    await page.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
    await page.waitForTimeout(1500);

    // iPhone: nut xem file nam trong sheet chuc nang (hang nut la `hidden sm:flex`)
    await page.click('[data-testid=mo-chuc-nang]');
    await page.waitForTimeout(400);
    await page.click('[data-testid=sheet-xem-file]');
    const hienPanel = await page.waitForSelector('[data-testid=xem-file]', { timeout: 15000 })
      .then(() => true).catch(() => false);
    ok('mo duoc panel xem file tu sheet chuc nang', hienPanel, String(hienPanel));

    if (hienPanel) {
      await page.waitForTimeout(1800);
      const soFile = await page.locator('[data-testid=file-item]').count();
      ok('cay thu muc co file', soFile > 0, soFile + ' file');

      /* Bam mot file .js roi kiem CO SO DONG va noi dung — khong to mau cu phap (shiki
         nang ~1MB, gap doi bundle, ma nguoi dung vao qua Tailscale). */
      await page.locator('[data-testid=file-item]').first().click();
      /* Cho den khi CO noi dung that, khong cho cung mot khoang thoi gian: file doc
         xong nhanh hay cham con tuy kich thuoc, cho cung 2s la bai nay do ngau nhien. */
      await page.waitForFunction(
        () => (document.querySelector('[data-testid=file-content]')?.textContent || '').length > 20,
        null, { timeout: 15000 },
      ).catch(() => {});
      const noi = await page.evaluate(
        () => document.querySelector('[data-testid=file-content]')?.textContent || '');
      ok('mo file hien duoc noi dung', noi.length > 20, noi.length + ' ky tu');

      /* iPhone mot cot: chon file roi thi cay AN di, nhuong ca man cho noi dung —
         chia doi tren 390px thi ca hai ben deu khong doc noi. */
      const cayAn = await page.evaluate(() => {
        const c = document.querySelector('[data-testid=file-tree]');
        return !c || !c.offsetParent;
      });
      ok('iPhone: chon file thi cay thu muc an di', cayAn, String(cayAn));

      // Nut ← phai quay lai duoc cay, khong thi cut duong
      await page.click('[data-testid=file-back]');
      await page.waitForTimeout(600);
      const cayHien = await page.locator('[data-testid=file-tree]').isVisible().catch(() => false);
      ok('nut back quay lai duoc cay thu muc', cayHien, String(cayHien));

      await page.click('[data-testid=file-close]');
      await page.waitForTimeout(500);
      const daDong = (await page.locator('[data-testid=xem-file]').count()) === 0;
      ok('dong duoc panel xem file', daDong, String(daDong));
    }
    await ctx.close();
  }

  /* ---------- G. Danh sách phiên: tên dự án, gom nhóm, nhóm Nháp ----------
     Trước đợt này KHÔNG bài nào phủ trường project, bộ lọc hay phân trang — nên
     bốn lỗi dưới đây sống suốt mà không ai biết. Mỗi bài bọc đúng một lỗi đã đo. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
    await page.waitForTimeout(2500);

    /* Lỗi phân trang: dòng "1 – 10 / 133" dùng hằng PAGE thay vì biến perPage, nên
       chọn 50 dòng/trang thì lưới hiện 50 thẻ mà chữ vẫn nói "1 – 10". */
    await page.selectOption('[data-testid=per-page]', '50');
    await page.waitForTimeout(600);
    const info = await page.locator('[data-testid=pagination-info]').textContent();
    const soThe = await page.locator('[data-testid=session-row]').count();
    ok('phân trang nói đúng số (trước: chọn 50 vẫn nói "1 – 10")',
      /^1 – 50 \//.test(info || '') && soThe === 50, `"${info}" / ${soThe} thẻ`);

    // Mặc định KHÔNG hiện phiên nháp, và có nút mở nói rõ giấu bao nhiêu
    const nutNhap = await page.locator('[data-testid=mo-nhap]').textContent().catch(() => '');
    const soNhap = +((nutNhap || '').match(/(\d+)/)?.[1] || 0);
    ok('phiên nháp gập sẵn, nói rõ đang giấu bao nhiêu', soNhap > 0, nutNhap?.trim());

    // Mở nhóm Nháp -> tổng ở phân trang phải TĂNG đúng bằng số đã báo.
    // Ẩn mà vẫn đếm thì người dùng đếm tay ra số khác — đúng loại lỗi đang đi sửa.
    const tong = (t) => +((t || '').match(/\/\s*(\d+)/)?.[1] || 0);
    const truocMo = tong(info);
    await page.click('[data-testid=mo-nhap]');
    await page.waitForTimeout(600);
    const sauMo = tong(await page.locator('[data-testid=pagination-info]').textContent());
    ok('mở nhóm Nháp: tổng tăng đúng bằng số đã báo',
      sauMo === truocMo + soNhap, `${truocMo} + ${soNhap} = ${sauMo}`);
    await page.click('[data-testid=an-nhap]');
    await page.waitForTimeout(500);

    /* Ô tìm trước đây chỉ quét sid + project + title. Gõ chữ đang HIỆN NGAY trên
       thẻ (câu cuối) lại ra 0 kết quả. */
    // Quét vài thẻ, không chỉ thẻ đầu: câu cuối của một thẻ có thể toàn từ ngắn.
    // Bỏ dấu câu bám quanh từ, nếu không "(ENOTFOUND)" bị loại vì có ngoặc.
    const cacCau = await page.locator('[data-testid=card-last]').allTextContents().catch(() => []);
    const tu = cacCau.slice(0, 12)
      // Tiền tố là "<tên người dùng>: " hoặc "Claude: " — tên nay lấy từ tài khoản
      // đang chạy server nên KHÔNG viết cứng được, khớp theo hình dạng thay vì nội dung.
      .flatMap((c) => c.replace(/^\s*[^:]{1,32}:\s*/, '').split(/\s+/))
      .map((w) => w.replace(/^[^\wÀ-ỹ]+|[^\wÀ-ỹ]+$/g, ''))
      .find((w) => w.length >= 6 && /^[\wÀ-ỹ]+$/.test(w));
    if (!tu) console.log('SKIP | tìm theo câu cuối (không có từ đủ dài để thử)');
    else {
      await page.fill('[data-testid=search-box]', tu);
      await page.waitForTimeout(700);
      const n = await page.locator('[data-testid=session-row]').count();
      ok('tìm được theo nội dung câu cuối (trước: ra 0 kết quả)', n > 0, `"${tu}" -> ${n} thẻ`);
      await page.fill('[data-testid=search-box]', '');
      await page.waitForTimeout(500);
    }

    /* Nút sắp xếp theo dự án: SortKey đã khai báo 'project' nhưng KHÔNG có nút nào
       bấm được. Giờ nút nằm trong menu `mo-loc`, phải mở ra mới thấy trong DOM. */
    await page.click('[data-testid=mo-loc]');
    await page.waitForSelector('[data-testid=menu-loc]', { timeout: 10000 });
    await page.waitForTimeout(400);
    const coNut = await page.locator('[data-testid=sort-project]').count();
    ok('có nút sắp xếp theo dự án (trước: khai báo rồi mà không bấm được)', coNut === 1);

    // Bấm vào -> gom nhóm theo dự án, đầu nhóm hiện repo hoặc đường dẫn
    await page.click('[data-testid=sort-project]');
    await page.waitForTimeout(400);
    await page.click('[data-testid=sheet-nen]').catch(() => {});
    await page.waitForTimeout(700);
    const g = await page.evaluate(() => ({
      nhom: document.querySelectorAll('[data-testid=nhom-du-an]').length,
      ten: [...document.querySelectorAll('[data-testid=nhom-ten]')].map((e) => e.textContent),
      repo: [...document.querySelectorAll('[data-testid=nhom-repo]')].map((e) => e.textContent),
    }));
    ok('gom nhóm theo dự án', g.nhom > 1, g.nhom + ' nhóm');
    ok('đầu nhóm nào cũng cho biết dự án nằm ở đâu (repo hoặc đường dẫn)',
      g.repo.length === g.nhom && g.repo.every((r) => (r || '').trim()),
      g.repo.slice(0, 3).join(' | '));
    ok('có nhóm hiện repo GitHub', g.repo.some((r) => /^[^/\s]+\/[^/\s]+ · /.test(r || '')),
      g.repo.find((r) => /·/.test(r || '')) || '(không có)');

    /* Tên dự án phải là tên thư mục thật. Chặn tái phát cả ba kiểu sai:
       "agy/proxy" (tách tên có gạch ngang), "6debb715b13d/scratchpad" (rò UUID),
       "plastic/" (chuỗi rác). */
    ok('không tên dự án nào chứa "/" (chặn "agy/proxy")',
      g.ten.every((t) => !(t || '').includes('/')),
      g.ten.filter((t) => (t || '').includes('/')).join(', '));
    ok('không tên dự án nào là chuỗi hex dài (chặn rò UUID)',
      g.ten.every((t) => !/^[0-9a-f]{8,}$/i.test(t || '')),
      g.ten.filter((t) => /^[0-9a-f]{8,}$/i.test(t || '')).join(', '));

    // Lọc dùng khoa (cwd), KHÔNG dùng chuỗi hiển thị: hai dự án có thể trùng basename
    // ("web" là con của agy-proxy), lọc theo tên sẽ trộn lẫn chúng.
    const opts = await page.$$eval('[data-testid=project-filter] option',
      (es) => es.map((e) => e.value).filter(Boolean));
    ok('bộ lọc dự án dùng đường dẫn làm khoá (không trộn dự án trùng tên)',
      opts.length > 0 && opts.every((v) => v.startsWith('/')),
      opts.slice(0, 2).join(' | '));

    /* ---- BA BỘ LỌC TRONG MENU ----
       Ba trường server ĐÃ trả từ lâu mà giao diện chưa đụng tới. Đáng giá nhất là
       "ẩn thư mục đã xoá": đo trên máy này 24/136 phiên (18%) có thư mục gốc không
       còn — nhắn vào rơi vào hư không, mà trước đây không có cách nào giấu đi. */
    {
      // về "Mới nhất" cho khỏi vướng gom nhóm của bài trước
      await page.click('[data-testid=mo-loc]');
      await page.waitForSelector('[data-testid=menu-loc]', { timeout: 10000 });
      await page.waitForTimeout(300);
      await page.click('[data-testid=sort-mtimeMs]');
      await page.waitForTimeout(400);

      const tongCua = (t) => +((t || '').match(/\/\s*(\d+)/)?.[1] || 0);
      const truoc = tongCua(await page.locator('[data-testid=pagination-info]').textContent());

      // số ghi trên nút = số phiên khớp, phải khớp với mức tổng tụt đi khi bật
      const demXoa = +(await page.locator('[data-testid=loc-da-xoa]').innerText())
        .trim().split(/\s+/).pop();
      await page.click('[data-testid=loc-da-xoa]');
      await page.waitForTimeout(500);
      await page.click('[data-testid=sheet-nen]').catch(() => {});
      await page.waitForTimeout(600);
      const sau = tongCua(await page.locator('[data-testid=pagination-info]').textContent());

      ok('ẩn phiên thư mục đã xoá: tổng tụt đúng bằng số ghi trên nút',
        demXoa > 0 ? truoc - sau === demXoa : truoc === sau,
        `${truoc} - ${demXoa} = ${sau}`);

      // Bật lọc mà không có dấu hiệu gì thì ngồi nhìn danh sách thiếu phiên không hiểu vì sao
      ok('có chấm báo đang bật lọc',
        (await page.locator('[data-testid=loc-dang-bat]').count()) === 1,
        'chấm=' + (await page.locator('[data-testid=loc-dang-bat]').count()));

      /* Nhớ qua F5 — nhưng CHỈ những thứ an toàn. Tab và ô tìm cố ý KHÔNG nhớ: mở app
         ra thấy danh sách đã lọc sẵn từ hôm qua thì tưởng mất phiên. */
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
      await page.waitForTimeout(2500);
      ok('lọc "đã xoá" được nhớ qua F5',
        (await page.locator('[data-testid=loc-dang-bat]').count()) === 1,
        'chấm sau F5=' + (await page.locator('[data-testid=loc-dang-bat]').count()));

      // tắt đi, trả trạng thái về như cũ cho các bài sau
      await page.click('[data-testid=mo-loc]');
      await page.waitForTimeout(400);
      await page.click('[data-testid=loc-da-xoa]');
      await page.waitForTimeout(400);
      await page.click('[data-testid=sheet-nen]').catch(() => {});
      await page.waitForTimeout(600);
      ok('tắt lọc thì chấm biến mất',
        (await page.locator('[data-testid=loc-dang-bat]').count()) === 0,
        'chấm=' + (await page.locator('[data-testid=loc-dang-bat]').count()));
    }

    /* Bỏ dấu tiếng Việt: tiêu đề Claude đặt gần như luôn có dấu, mà gõ trên điện thoại
       thì hay gõ không dấu — trước đây gõ "kiem tra" ra 0 kết quả dù phiên "Kiểm tra…"
       đang nằm ngay trên màn hình. */
    {
      const coDau = await page.evaluate(() => {
        const e = [...document.querySelectorAll('[data-testid=session-title]')]
          .map((x) => (x.textContent || '').trim())
          .find((t) => /[àáâãèéêìíòóôõùúýăđĩũơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(t));
        return e || '';
      });
      const boDauJs = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D');
      /* Từ khoá phải THỰC SỰ có dấu ở bản gốc, nếu không bài này không kiểm gì cả —
         lần đầu viết, "Đếm từ 1 đến 12" không có từ nào ≥4 ký tự nên từ khoá ra chuỗi
         RỖNG, tìm rỗng thì trả về hết và bài vẫn xanh. Chọn từ dài ≥3 và bắt buộc
         khác chính nó sau khi bỏ dấu. */
      const tu = !coDau ? '' : coDau.split(/\s+/)
        .find((w) => w.length >= 3 && boDauJs(w) !== w);
      if (!tu) {
        ok('tìm không dấu ra phiên có dấu', true, '(không có phiên nào tên có dấu để thử)');
      } else {
        const goKhongDau = boDauJs(tu);
        await page.fill('[data-testid=search-box]', goKhongDau);
        await page.waitForTimeout(700);
        const n = await page.locator('[data-testid=session-row]').count();
        ok('tìm không dấu ra phiên có dấu', n > 0,
          `gõ "${goKhongDau}" (gốc "${tu}") -> ${n} thẻ`);
        await page.fill('[data-testid=search-box]', '');
        await page.waitForTimeout(500);
      }
    }

    /* Tab Thống kê gom donut theo cùng trường project nên sai theo đúng một kiểu:
       lát "6debb715b13d/scratchpad", "cmdtest" (thư mục nháp do test sinh),
       và "Van thong plastic" bị tách thành hai lát. */
    await page.click('text=Thống kê');
    await page.waitForTimeout(1800);
    const nhan = await page.$$eval('.recharts-legend-item-text, .recharts-cartesian-axis-tick-value',
      (es) => es.map((e) => e.textContent || ''));
    ok('donut/bar: không nhãn nào chứa "/" hay chuỗi UUID',
      nhan.every((t) => !t.includes('/') && !/[0-9a-f]{8,}/i.test(t)),
      nhan.filter((t) => t.includes('/') || /[0-9a-f]{8,}/i.test(t)).join(', '));
    ok('donut/bar: không còn lát nào là phiên nháp',
      !nhan.some((t) => /cmdtest|permtest|scratchpad/i.test(t)),
      nhan.filter((t) => /cmdtest|permtest|scratchpad/i.test(t)).join(', '));

    await ctx.close();
  }

  /* ---------- H. iPhone: hàng "Chọn cả trang" đã bỏ, chạm giữ để chọn ---------- */
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=session-row]', { timeout: 20000 });
    await page.waitForTimeout(2500);

    /* Hàng "Chọn cả trang" ăn 45px trên iPhone nhưng chữ bị ẩn, nên chỉ còn MỘT Ô
       VUÔNG TRƠ TRỌI không ai hiểu để làm gì. Giờ ẩn hẳn; ô chọn trên thẻ cũng ẩn. */
    const hien = await page.evaluate(() => {
      const e = document.querySelector('[data-testid=sel-all]');
      return { selAll: e ? !!e.offsetParent : false,
        oChon: [...document.querySelectorAll('[data-testid=sel-row]')].filter((x) => !!x.offsetParent).length };
    });
    ok('iPhone: bỏ hàng "Chọn cả trang" (ô vuông trơ trọi không ai hiểu)', !hien.selAll);
    ok('iPhone: ô chọn trên thẻ ẩn cho tới khi cần', hien.oChon === 0, hien.oChon + ' ô đang hiện');

    /* Chạm giữ một thẻ -> vào chế độ chọn (như ứng dụng Ảnh).
       KHÔNG dùng touchscreen.tap ở đây: chạm rồi nhả ngay là MỞ PHIÊN, thẻ biến mất
       khỏi DOM và bài kiểm sập. Phải giữ touchstart 800ms mà không nhả. */
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid=session-row]');
      const t = new TouchEvent('touchstart', { bubbles: true, cancelable: true });
      el.dispatchEvent(t);
    });
    await page.waitForTimeout(800);
    const sauGiu = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid=sel-row]')].filter((x) => !!x.offsetParent).length);
    ok('iPhone: chạm giữ một thẻ thì hiện ô chọn', sauGiu > 0, sauGiu + ' ô hiện ra');

    await ctx.close();
  }

  /* ---------- I. Khung chat: đầu trang đủ dữ kiện, không bị rác hook nuốt ----------
     Danh sách phiên hiện đủ dự án/repo/model, nhưng MỞ phiên ra thì mất sạch — chỉ
     còn mỗi cái tên. Trên iPhone còn tệ hơn: model và trạng thái bị `hidden sm:`
     nên không thấy gì cả. */
  for (const [ten, w, h, touch] of [['desktop', 1440, 900, false], ['iPhone', 390, 844, true]]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch,
    });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid=session-row]:visible', { timeout: 20000 });
    await page.waitForTimeout(2500);
    await page.locator('[data-testid=session-row]:visible').first().click();
    await page.waitForSelector('[data-testid=chat-view]', { timeout: 20000 });
    await page.waitForTimeout(2500);

    const meta = await page.evaluate(() => {
      const t = (id) => {
        const e = document.querySelector(`[data-testid=${id}]`);
        return e && e.offsetParent ? (e.textContent || '').trim() : '';
      };
      return {
        duAn: t('chat-du-an'), repo: t('chat-repo'), model: t('chat-model'),
        luot: t('chat-luot'), tok: t('chat-tok'),
      };
    });
    // Tên dự án phải hiện Ở CẢ HAI cỡ màn — đây là thứ trước đây iPhone không có
    ok(`chat ${ten}: đầu trang có tên dự án`, !!meta.duAn, JSON.stringify(meta.duAn));
    ok(`chat ${ten}: đầu trang cho biết phiên chạy ở đâu (repo hoặc đường dẫn)`,
      !!meta.repo, meta.repo.slice(0, 40));
    // Token hiện ở CẢ HAI cỡ; số lượt chỉ desktop (màn hẹp nhường chỗ cho repo+model,
    // và danh sách phiên đã hiện số lượt sẵn).
    ok(`chat ${ten}: đầu trang có token`, !!meta.tok, meta.tok);
    if (!touch) ok('chat desktop: đầu trang có số lượt', !!meta.luot, meta.luot);

    /* Dòng phụ đề phải nằm gọn MỘT dòng. Lúc mới thêm nó để flex-wrap, trên iPhone
       390px nó tách làm 2 dòng, ăn 39px và đẩy khung đọc từ 688px xuống 593px —
       tức là đổi gần 100px vùng đọc lấy một dòng phụ đề. Bài này chặn tái phát. */
    const caoMeta = await page.evaluate(() => {
      const e = document.querySelector('[data-testid=chat-meta]');
      return e ? Math.round(e.getBoundingClientRect().height) : 0;
    });
    ok(`chat ${ten}: dòng phụ đề gọn một dòng (không đẩy khung đọc)`,
      caoMeta > 0 && caoMeta <= 24, caoMeta + 'px');

    /* Rác hook: một hook cấu hình sai lỗi ở MỌI lần gọi tool — đếm thật 4.220 dòng
       trong một phiên. Server gộp thành một dòng kèm số lần; nếu gộp hỏng thì màn
       chat lại đầy chữ đỏ. Kiểm: mỗi lỗi hook chỉ được xuất hiện ĐÚNG MỘT LẦN. */
    const hook = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[data-testid=note-line][data-kind=hook-error]')];
      const tieuDe = ds.map((e) => (e.querySelector('[data-testid=note-toggle]')?.textContent || '').trim());
      return { so: ds.length, trung: tieuDe.length - new Set(tieuDe).size };
    });
    ok(`chat ${ten}: lỗi hook không lặp lại (gộp thành một dòng)`, hook.trung === 0,
      hook.so + ' dòng, ' + hook.trung + ' trùng');

    // Đường dẫn tuyệt đối trong KẾT QUẢ tool phải rút gọn thành ~/…
    const duongDan = await page.evaluate(() => {
      const box = document.querySelector('[data-testid=chat-bubbles]');
      const chu = box ? box.innerText : '';
      return { dai: (chu.match(/\/Users\/[a-z0-9_-]+\//gi) || []).length, gon: (chu.match(/~\//g) || []).length };
    });
    ok(`chat ${ten}: đường dẫn rút gọn thành ~/ (không phải /Users/…)`,
      duongDan.gon > 0 || duongDan.dai === 0, `${duongDan.gon} gọn / ${duongDan.dai} dài`);

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
