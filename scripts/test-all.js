#!/usr/bin/env node
/* Chạy TẤT CẢ bộ test, mỗi bộ trong đúng môi trường của nó.

   Vì sao cần script này thay vì nối `npm run a && npm run b`:
   tests/e2e.js viết cho giao diện CŨ (tìm #sidenav, #bubbles…), còn tests/ui-new.js
   viết cho giao diện MỚI. Chạy nhầm chỗ thì e2e treo 3 giây mỗi selector rồi ném
   TimeoutError — nhìn như code hỏng trong khi chỉ là chạy sai môi trường.

   Nên: tự bật hai server ở hai cổng riêng (bản cũ NEW_UI=0, bản mới mặc định),
   chạy đúng bộ vào đúng cổng, xong thì tắt cả hai. Không đụng server 7799 mà người dùng
   đang dùng.
*/
const { spawn, execFile } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const CONG_CU = 7896;   // bản cũ (NEW_UI=0)
const CONG_MOI = 7897;  // bản mới

const cho = (ms) => new Promise((r) => setTimeout(r, ms));

function batServer(cong, moi) {
  const env = { ...process.env, PORT: String(cong) };
  if (!moi) env.NEW_UI = '0';
  const p = spawn('node', [path.join(ROOT, 'src/server/index.js')],
    { cwd: ROOT, env, stdio: 'ignore' });
  p.unref();
  return p;
}

function doiSan(cong, hetHan = 15000) {
  const den = Date.now() + hetHan;
  return new Promise((ok, hong) => {
    const thu = () => {
      const req = http.get({ host: '127.0.0.1', port: cong, path: '/', timeout: 1500 }, (res) => {
        res.resume(); ok();
      });
      req.on('error', () => (Date.now() > den ? hong(new Error('server ' + cong + ' không lên')) : setTimeout(thu, 400)));
      req.on('timeout', () => { req.destroy(); });
    };
    thu();
  });
}

function chay(nhan, file, env) {
  return new Promise((done) => {
    execFile('node', [path.join(ROOT, file)],
      { cwd: ROOT, env: { ...process.env, ...env }, maxBuffer: 8e6, timeout: 600000 },
      (err, out, errOut) => {
        const txt = String(out) + String(errOut);
        // Hai kiểu báo kết quả: bộ test in "N/N PASS", còn verify/dead-buttons chỉ
        // in một câu rồi dựa vào MÃ THOÁT. Nhận cả hai, đừng bắt mỗi một kiểu.
        const m = txt.match(/(\d+)\/(\d+)\s*PASS/i);
        const cauCuoi = txt.trim().split('\n').filter(Boolean).pop() || '';
        const ket = m ? `${m[1]}/${m[2]}` : (err ? 'HỎNG' : cauCuoi.slice(0, 34));
        const dat = m ? (!err && m[1] === m[2]) : !err;
        console.log(`  ${dat ? 'OK  ' : 'HỎNG'}  ${nhan.padEnd(22)} ${ket}`);
        if (!dat) {
          /* Bắt cả dòng "waiting for locator(...)" của Playwright: khi bộ test ném
             TimeoutError, dòng DUY NHẤT nói nó chờ CÁI GÌ lại nằm ở đây. Thiếu nó thì
             log chỉ có `name: 'TimeoutError'` — phải chạy lại riêng bộ đó mới biết,
             mà chạy lại thì cổng có thể đã khác nên lỗi không tái hiện. */
          const cuoi = txt.trim().split('\n')
            .filter((l) => /FAIL|Error|error|waiting for/.test(l)).slice(0, 5);
          cuoi.forEach((l) => console.log('        ' + l.trim().slice(0, 110)));
          // Vài bài đòi DỮ LIỆU THẬT phải có sẵn, không phải lỗi code. Nói rõ ra để
          // lần sau không mất công đi tìm bug không tồn tại.
          if (/agy lưu lượng/.test(txt) && /"reqs":"0"/.test(txt)) {
            console.log('        ^ agy-proxy chưa có request nào trong 24h -> không có gì để vẽ.');
            console.log('          Đây là do MÔI TRƯỜNG, không phải lỗi code.');
          }
        }
        done(dat);
      });
  });
}

/* Dọn TRẠNG THÁI do lần chạy trước để lại, trước khi bật server.

   Vì sao cần: vài bài test đặt mã khoá hoặc gán model riêng cho phiên rồi mới xoá ở
   cuối. Bộ nào hỏng giữa chừng là phần xoá không chạy — lần sau bật lên đã thấy mã
   khoá bật sẵn (mọi API trả 423, e2e đỏ hàng loạt) hoặc phiên vẫn còn model thừa
   (bài "phiên khác KHÔNG dính theo" đỏ). Rác đó lại làm lần chạy sau hỏng tiếp, thành
   vòng luẩn quẩn: đã mất mấy vòng chạy chỉ để phát hiện lỗi nằm ở nền, không ở mã.

   Chỉ đụng file của DASHBOARD, tuyệt đối không đụng .jsonl của Claude CLI. */
function donNen() {
  const HOME = require('os').homedir();
  const nen = [
    // mã khoá: test tự tạo rồi tự xoá — sót lại là chặn hết API
    ['dashboard-passcode.json', null],
    // model riêng từng phiên: chỉ có test mới gán, người dùng thật đặt qua giao diện
    ['dashboard-models.json', {}],
  ];
  for (const [ten, giaTri] of nen) {
    const f = path.join(HOME, '.claude', ten);
    try {
      if (giaTri === null) fs.rmSync(f, { force: true });
      else if (fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify(giaTri, null, 2));
    } catch {}
  }

  /* Phiên GIẢ do test dựng trong ~/.claude/projects. Bộ nào chết giữa chừng là phần
     dọn ở cuối không chạy, file nằm lại rồi lần sau NỐI THÊM vào — đo thật: fixture
     e2e còn 4 dòng trong khi bài đòi `total === 3`, nên lần chạy sau đỏ ở
     "history trả parts có cấu trúc" mà đọc mã thì không thấy sai gì.
     Chỉ xoá thư mục có tên rõ ràng là của test, KHÔNG quét bừa .claude/projects. */
  const DU_AN = path.join(HOME, '.claude', 'projects');
  const RAC = ['-tmp-e2e-tools', '-private-tmp-inc-check', '-private-tmp-agent-check',
    '-private-tmp-cho-check', '-private-tmp-tim-check', '-private-tmp-lenh-check'];
  for (const t of RAC) {
    try { fs.rmSync(path.join(DU_AN, t), { recursive: true, force: true }); } catch {}
  }
  /* Thư mục e2e sinh trong scratchpad của phiên Claude: tên có UUID phiên nên không
     liệt kê cứng được. Khớp theo ĐUÔI "-e2e" và bắt buộc nằm trong scratchpad —
     đủ hẹp để không đụng dự án thật của người dùng. */
  try {
    for (const d of fs.readdirSync(DU_AN)) {
      if (/scratchpad-e2e$/.test(d) && d.includes('claude-')) {
        fs.rmSync(path.join(DU_AN, d), { recursive: true, force: true });
      }
    }
  } catch {}

  donCong();
}

/* Dọn TIẾN TRÌNH còn nghe cổng test.

   Đây là thứ `donNen` cũ bỏ sót, và nó tốn nhiều thời gian nhất để tìm ra: kết quả
   test nhảy lung tung giữa các lần chạy dù mã không đổi một dòng. Cùng một commit ra
   68/69 rồi 53/68 rồi 190/190 rồi TimeoutError.

   Gốc: server của lần chạy TRƯỚC vẫn sống. Bắt được thật — một tiến trình giữ cổng
   7797 suốt 12 phút, và một `test-all` cũ vẫn chạy nền đụng với lần chạy mới. Bộ test
   mới bind cổng thất bại rồi lặng lẽ nói chuyện với server CŨ (mã cũ, khoá VAPID cũ,
   dữ liệu cũ) — nên bài đỏ mà đọc mã thì không thấy sai ở đâu.

   Đúng bẫy CLAUDE.md đã ghi cho cổng 7799, chỉ khác là ở cổng test. */
function donCong() {
  const { execSync } = require('child_process');
  const im = (c) => { try { return execSync(c, { encoding: 'utf8' }).trim(); } catch { return ''; } };
  // Bộ test có thể còn chạy nền từ lần trước (Ctrl-C không giết tiến trình con)
  for (const m of ['tests/e2e.js', 'tests/ui-new.js', 'tests/du-an.js', 'tests/push.js']) {
    if (im(`pgrep -f "${m}"`)) im(`pkill -f "${m}"`);
  }
  // 7797 = cổng của tests/push.js, hai cổng kia là của chính test-all
  for (const c of [CONG_CU, CONG_MOI, 7797, 7869]) {
    const pid = im(`lsof -ti:${c}`);
    if (pid) {
      console.log(`  (dọn cổng ${c}: tiến trình cũ ${pid.split('\n').join(' ')} còn sống)`);
      im(`kill -9 ${pid.split('\n').join(' ')}`);
    }
  }
}

(async () => {
  console.log('Chạy toàn bộ test — mỗi bộ ở đúng môi trường của nó\n');
  const ket = [];
  donNen();

  ket.push(await chay('cú pháp', 'scripts/verify.js', {}));

  const sCu = batServer(CONG_CU, false);
  const sMoi = batServer(CONG_MOI, true);
  const donDep = () => { try { sCu.kill(); } catch {} try { sMoi.kill(); } catch {} };
  process.on('exit', donDep);
  process.on('SIGINT', () => { donDep(); process.exit(130); });

  try {
    await Promise.all([doiSan(CONG_CU), doiSan(CONG_MOI)]);
    await cho(800);

    ket.push(await chay('rà nút chết', 'scripts/dead-buttons.js', { DASH_URL: `http://localhost:${CONG_MOI}/` }));
    ket.push(await chay('giao diện cũ (e2e)', 'tests/e2e.js', { DASH_URL: `http://localhost:${CONG_CU}/` }));
    ket.push(await chay('Web Push', 'tests/push.js', { DASH_URL: `http://localhost:${CONG_CU}/` }));
    /* Bỏ qua phần NHẮN THẬT ở đây. Phần đó gọi Claude thật vào một phiên có sẵn,
       nhưng server tạm này vừa dựng nên chưa chắc có phiên nào để mở — nó sẽ chờ
       hết giờ rồi báo hỏng, nhìn như code lỗi trong khi chỉ là sai môi trường.
       Muốn kiểm cả phần nhắn thì chạy thẳng: `node tests/ui-new.js` với server 7799.
       (Dòng cũ ở đây viết `...(SKIP_CHAT ? {} : {})` — hai nhánh như nhau nên không
       bao giờ bỏ qua được gì.) */
    ket.push(await chay('giao diện mới', 'tests/ui-new.js',
      { DASH_URL: `http://localhost:${CONG_MOI}/`, SKIP_CHAT: '1' }));
    /* Tên dự án + hiệu năng danh sách — kiểm ở mức server, không cần trình duyệt.
       Chạy SAU cùng vì một bài đo "API nhẹ không bị /stream chặn" cần server đã ấm
       để phản ánh đúng đời thật; chạy trên server vừa dựng thì lúc nào cũng xanh. */
    ket.push(await chay('tên dự án + hiệu năng', 'tests/du-an.js',
      { DASH_URL: `http://localhost:${CONG_MOI}/` }));
    /* Cài trên máy mới: bộ này TỰ dựng server riêng với HOME giả trống rỗng, nên
       không dùng hai server ở trên và cũng không đụng ~/.claude thật. */
    ket.push(await chay('cài trên máy mới', 'tests/may-moi.js', { PORT_TEST: '7869' }));
  } finally {
    donDep();
  }

  const hong = ket.filter((x) => !x).length;
  console.log(hong ? `\n${hong} bộ HỎNG` : '\nTất cả đều đạt');
  process.exit(hong ? 1 : 0);
})();
