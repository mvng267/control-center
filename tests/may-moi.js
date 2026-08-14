/* Test CÀI TRÊN MÁY MỚI — máy chưa từng chạy Claude CLI, chưa có ~/.claude.

   Vì sao có file này: server ghi 5 file cấu hình vào ~/.claude/ nhưng KHÔNG chỗ nào
   tạo thư mục đó. Trên máy sạch, mọi writeFileSync ném ENOENT — mà chỗ nào cũng bọc
   catch{} nên hỏng IM LẶNG. Hậu quả đo được trước khi sửa:
     - mã truy cập ĐỔI mỗi lần khởi động lại (ehrHJ0Aq… -> v0bpDwEy…), nên link ?t=
       đã lưu trên điện thoại chết theo, phải mở terminal đọc log mới vào được
     - đặt mã khoá xong restart là mất, người dùng tưởng máy đang khoá mà thật ra không

   Bộ này tự dựng một HOME giả trống rỗng rồi chạy server thật trong đó, nên nó bọc
   đúng tình huống "cài lên máy khác" mà không đụng gì tới ~/.claude thật của người dùng.

   Cách chạy:  node tests/may-moi.js
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = +(process.env.PORT_TEST || 7893);
const URL = 'http://127.0.0.1:' + PORT;

const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
};

const cho = (ms) => new Promise((r) => setTimeout(r, ms));

// HOME giả: thư mục tạm HOÀN TOÀN TRỐNG, đúng như máy vừa cài xong hệ điều hành
const HOME_GIA = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-may-moi-'));

/* Mã khoá dùng cho test, KHÔNG phải mã thật của ai. Trước đây viết thẳng một dãy số
   rải rác 6 chỗ — đọc mã nguồn công khai dễ tưởng đó là mã mặc định của sản phẩm.
   Giữ kiểu CHUỖI: bài "không lưu mã thô" gọi .includes() trên nó, số thì ném lỗi. */
const MA_TEST = '48291';
const MA_TEST_MOI = '73650';

let proc = null;
function batServer() {
  return new Promise((done, hong) => {
    proc = spawn('node', [path.join(ROOT, 'src/server/index.js')], {
      cwd: ROOT,
      env: { ...process.env, HOME: HOME_GIA, PORT: String(PORT), DASH_TOKEN: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const het = setTimeout(() => hong(new Error('server không lên sau 15s')), 15000);
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/mã truy cập: (\S+)/);
      if (m) { clearTimeout(het); done(m[1]); }
    });
    proc.stderr.on('data', (d) => { buf += d.toString(); });
    proc.on('exit', () => { clearTimeout(het); hong(new Error('server thoát sớm: ' + buf.slice(0, 300))); });
  });
}
function tatServer() {
  if (proc) { try { proc.kill(); } catch {} proc = null; }
}

const api = (duong, opt) => fetch(URL + duong, opt).then((r) => r.json().then((j) => ({ status: r.status, body: j })));

process.on('exit', () => { tatServer(); try { fs.rmSync(HOME_GIA, { recursive: true, force: true }); } catch {} });
process.on('SIGINT', () => process.exit(130));

(async () => {
  console.log('HOME giả:', HOME_GIA, '(trống hoàn toàn)\n');

  // ---- lần chạy 1 ----
  const token1 = await batServer();
  ok('server khởi động được trên máy chưa có ~/.claude', !!token1, 'token: ' + token1.slice(0, 8) + '…');

  const H = { 'X-Dash-Token': token1, 'Content-Type': 'application/json' };

  /* Mã truy cập phải được GHI RA FILE. Đây là gốc của lỗi: thư mục ~/.claude chưa
     tồn tại nên writeFileSync ném ENOENT và bị nuốt. */
  const fToken = path.join(HOME_GIA, '.claude', 'dashboard-token.json');
  ok('mã truy cập được ghi ra file (tự tạo ~/.claude)', fs.existsSync(fToken), fToken.replace(HOME_GIA, '~'));

  /* Đổi chế độ quyền TRƯỚC khi đặt mã khoá: đặt mã xong thì mọi API đòi mở khoá
     (423), nên kiểm sau sẽ đo nhầm. */
  await api('/api/perm', { method: 'POST', headers: H, body: JSON.stringify({ mode: 'plan' }) });
  ok('chế độ quyền được ghi ra file',
    fs.existsSync(path.join(HOME_GIA, '.claude', 'dashboard-perm.json')));

  /* Máy mới chưa có phiên Claude nào -> danh sách rỗng, nhưng KHÔNG được vỡ.
     Mỗi tab thiếu phụ thuộc (docker/hermes/agy) cũng phải trả 200 chứ không 500. */
  for (const [ten, ep] of [['việc nền', '/api/jobs'], ['Hermes', '/api/hermes'], ['Agy', '/api/agy/status']]) {
    const r = await api(ep, { headers: { 'X-Dash-Token': token1 } });
    ok('tab ' + ten + ' không vỡ khi thiếu phụ thuộc', r.status === 200, 'HTTP ' + r.status);
  }

  // Đặt mã khoá — trường tên là `code`, không phải `pass`
  const r1 = await api('/api/passcode/set', { method: 'POST', headers: H, body: JSON.stringify({ code: MA_TEST }) });
  ok('đặt mã khoá trả về daDat: true', r1.body.ok === true && r1.body.daDat === true, JSON.stringify(r1.body));

  /* Quan trọng hơn cả câu trả lời: file có TỒN TẠI THẬT không. Trước khi sửa, server
     vẫn trả ok:true trong khi không tạo file nào — người dùng tưởng đã khoá. */
  const fPass = path.join(HOME_GIA, '.claude', 'dashboard-passcode.json');
  ok('mã khoá được ghi ra file thật (không phải ok:true giả)', fs.existsSync(fPass));

  if (fs.existsSync(fPass)) {
    const st = fs.statSync(fPass);
    // 0600: chỉ chủ máy đọc được. File này chứa salt+hash của mã khoá.
    ok('file mã khoá đúng quyền 0600', (st.mode & 0o777) === 0o600, '0' + (st.mode & 0o777).toString(8));
    const noiDung = JSON.parse(fs.readFileSync(fPass, 'utf8'));
    // KHÔNG được lưu mã thô — chỉ salt + hash
    ok('không lưu mã thô, chỉ salt + hash',
      !JSON.stringify(noiDung).includes(MA_TEST) && !!noiDung.salt && !!noiDung.hash);
  }

  // ---- KHỞI ĐỘNG LẠI: bài quan trọng nhất ----
  tatServer();
  await cho(600);
  const token2 = await batServer();

  ok('mã truy cập GIỮ NGUYÊN sau khi khởi động lại', token1 === token2,
    token1 === token2 ? token1.slice(0, 8) + '…' : token1.slice(0, 8) + '… -> ' + token2.slice(0, 8) + '…');

  // Mã khoá phải còn, và phải khớp
  const dung = await api('/api/passcode/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: MA_TEST }),
  });
  ok('mã khoá còn sống sau khi khởi động lại', dung.body.ok === true, JSON.stringify(dung.body));

  const sai = await api('/api/passcode/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '999999' }),
  });
  ok('mã sai bị từ chối', !sai.body.ok, JSON.stringify(sai.body));

  /* Đã đặt mã khoá thì API phải trả 423 kể cả khi có token đúng — token và mã khoá
     là hai lớp riêng. Đây mới là bằng chứng mã khoá THẬT SỰ có tác dụng sau restart,
     chứ không phải chỉ nằm trong file. */
  const khoa = await api('/api/jobs', { headers: { 'X-Dash-Token': token2 } });
  ok('mã khoá vẫn chặn API sau khi khởi động lại', khoa.status === 423, 'HTTP ' + khoa.status);

  /* ---- SSE phải đi qua được cổng mã khoá bằng COOKIE ----
     Lỗi thật đã gặp khi vào từ iPhone: EventSource mặc định KHÔNG gửi cookie, mà
     cookie `dashUnlock` chính là thứ chứng minh đã mở khoá -> /stream trả 423, SSE
     đứt rồi thử lại vô hạn, nhìn ra "mất kết nối" liên tục dù server vẫn chạy.
     Sửa bằng `new EventSource(url, { withCredentials: true })`.
     Không bài nào bắt được vì mọi test đều chạy qua localhost, mà loopback được
     miễn cả token lẫn mã khoá — bộ này dùng 127.0.0.1 nên cũng vậy. Nên ở đây kiểm
     đúng phần server: /stream CÓ cookie thì phải 200, KHÔNG cookie thì phải 423. */
  const mo = await fetch(URL + '/api/passcode/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dash-Token': token2 },
    body: JSON.stringify({ code: MA_TEST }),
  });
  const cookie = (mo.headers.get('set-cookie') || '').split(';')[0];
  ok('mở khoá trả về cookie dashUnlock', /^dashUnlock=\S+/.test(cookie), cookie.slice(0, 24) + '…');

  const sseCo = await fetch(URL + '/stream?t=' + token2, { headers: { Cookie: cookie } });
  ok('/stream đi qua được khi CÓ cookie mở khoá', sseCo.status === 200, 'HTTP ' + sseCo.status);
  sseCo.body.cancel().catch(() => {});

  const sseKhong = await fetch(URL + '/stream?t=' + token2);
  ok('/stream bị chặn khi THIẾU cookie (lỗi mất kết nối trên iPhone)',
    sseKhong.status === 423, 'HTTP ' + sseKhong.status);
  sseKhong.body.cancel().catch(() => {});

  /* ---- cookie mở khoá phải SỐNG QUA restart ----
     Lỗi thật đã gặp: danh sách token mở khoá giữ trong một Map ở RAM, nên mỗi lần
     restart server là mọi thiết bị bị đá ra — cookie cũ không còn trong Map, /stream
     trả 423, iPhone hiện "mất kết nối" và danh sách phiên TRỐNG TRƠN. Gặp đúng lúc
     triển khai bản mới, và sẽ gặp lại sau mỗi lần cập nhật hay máy khởi động lại.
     Sửa bằng cookie tự chứng minh (hạn dùng + chữ ký HMAC), bí mật ký lưu trong
     file mã khoá. */
  tatServer();
  await cho(600);
  const token3 = await batServer();
  const sseSauRestart = await fetch(URL + '/stream?t=' + token3, { headers: { Cookie: cookie } });
  ok('cookie mở khoá CŨ vẫn dùng được sau khi restart server',
    sseSauRestart.status === 200, 'HTTP ' + sseSauRestart.status);
  sseSauRestart.body.cancel().catch(() => {});

  /* Đổi mã khoá thì phải đá hết thiết bị cũ — sinh bí mật ký mới. */
  await api('/api/passcode/set', {
    method: 'POST',
    headers: { 'X-Dash-Token': token3, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ code: MA_TEST_MOI, old: MA_TEST }),
  });
  const sseSauDoiMa = await fetch(URL + '/stream?t=' + token3, { headers: { Cookie: cookie } });
  ok('đổi mã khoá thì cookie cũ MẤT hiệu lực', sseSauDoiMa.status === 423,
    'HTTP ' + sseSauDoiMa.status);
  sseSauDoiMa.body.cancel().catch(() => {});

  /* ---- GÓI NPM phải tự đủ ----
     Cài bằng `npm i -g` thì CHỈ có những thư mục liệt kê trong `files` của
     package.json. Đã thủng thật một lần: icon PWA đọc từ `web-next/public`, mà gói
     không có thư mục đó -> mọi icon trả 404, iPhone "Thêm vào Màn hình chính" ra ô
     trắng. Chạy trên máy dev thì không bao giờ lộ vì ở đó có đủ cả hai thư mục.
     Bài này soi `files` thay vì soi đĩa: đó mới là thứ quyết định gói có gì. */
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const goi = pkg.files || [];
    const coOut = goi.some((f) => f.replace(/\/$/, '') === 'web-next/out');
    ok('package.json gói web-next/out (giao diện)', coOut, JSON.stringify(goi));

    // Icon PHẢI nằm trong thư mục được gói, không chỉ trong web-next/public
    const ICON = ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'icon.svg'];
    const thieu = ICON.filter((f) => !fs.existsSync(path.join(__dirname, '..', 'web-next', 'out', f)));
    ok('icon PWA có trong web-next/out (thứ npm gói)', thieu.length === 0,
      thieu.length ? 'thiếu: ' + thieu.join(', ') : ICON.length + ' icon đủ');

    // Và server phải phục vụ được chúng — kiểm qua HTTP, không chỉ kiểm file tồn tại
    for (const f of ['/icon-192.png', '/apple-touch-icon.png']) {
      const r = await fetch(URL + f, { headers: { 'X-Dash-Token': token3 } });
      ok('server trả được ' + f, r.status === 200, 'HTTP ' + r.status);
      r.body?.cancel().catch(() => {});
    }
  }

  tatServer();
  const fails = results.filter((r) => !r.pass);
  console.log('\n==== MÁY MỚI: ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  tatServer();
  console.error('SCRIPT ERROR', e);
  process.exit(2);
});
