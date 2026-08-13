// Kiểm tra cú pháp toàn dự án: server + client + test + script.
//
// Trước đây client JS nằm trong template literal của server nên `node -c` KHÔNG thấy
// lỗi cú pháp phía trình duyệt — viết \n hay dấu backtick là âm thầm làm vỡ cả trang.
// Từ khi tách web/legacy/app.js ra file thật thì chỉ cần node -c là đủ, không phải
// dựng server rồi bóc HTML như bản cũ.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const targets = [];

function collect(dir, filter) {
  let names;
  try { names = fs.readdirSync(path.join(ROOT, dir)); } catch { return; }
  for (const n of names) {
    if (!n.endsWith('.js')) continue;
    if (filter && !filter(n)) continue;
    targets.push(path.join(dir, n));
  }
}

collect('src/server');
collect('web/legacy');
collect('web/legacy/js');
collect('tests');
collect('scripts');

let bad = 0;
for (const rel of targets) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
    console.log('  ok   ' + rel);
  } catch (e) {
    bad++;
    console.log('  LỖI  ' + rel);
    const msg = (e.stderr || Buffer.from('')).toString().split('\n').slice(0, 4).join('\n');
    console.log(msg.replace(/^/gm, '       '));
  }
}

// Client JS chia theo tính năng nhưng DÙNG CHUNG scope (nạp bằng nhiều thẻ <script>,
// không phải module) -> kiểm riêng từng file là chưa đủ, phải nối lại đúng thứ tự
// trong index.html rồi check, mới bắt được lỗi kiểu ngoặc thiếu ở cuối file.
const idx = path.join(ROOT, 'web/legacy/index.html');
if (fs.existsSync(idx)) {
  const order = [...fs.readFileSync(idx, 'utf8').matchAll(/src="\/js\/([a-z-]+\.js)"/g)].map(x => x[1]);
  if (order.length) {
    const joined = order.map(n => fs.readFileSync(path.join(ROOT, 'web/legacy/js', n), 'utf8')).join('\n');
    const tmp = path.join(require('os').tmpdir(), 'ccc-verify-joined.js');
    fs.writeFileSync(tmp, joined);
    try {
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
      console.log('  ok   web/legacy/js/* nối lại theo index.html (' + order.length + ' file)');
    } catch (e) {
      bad++;
      console.log('  LỖI  khi nối ' + order.length + ' file client JS:');
      console.log((e.stderr || Buffer.from('')).toString().split('\n').slice(0, 4).join('\n').replace(/^/gm, '       '));
    }
    fs.unlinkSync(tmp);
  }
}

// Thứ tự nạp: file nạp TRƯỚC không được dùng biến let/const khai báo ở file nạp SAU.
// node --check không bắt được (cú pháp vẫn hợp lệ) nhưng lúc chạy sẽ ném
// "x is not defined" — đã từng làm vỡ trang vì stream.js đọc permBusy quá sớm.
if (fs.existsSync(idx)) {
  const order = [...fs.readFileSync(idx, 'utf8').matchAll(/src="\/js\/([a-z-]+\.js)"/g)].map(x => x[1]);
  const files = order.map(n => ({ n, s: fs.readFileSync(path.join(ROOT, 'web/legacy/js', n), 'utf8') }));
  // Hai loại lỗi khác nhau, phải phân biệt:
  //
  // (a) BIẾN let/const dùng ở file nạp trước -> LUÔN vỡ (temporal dead zone).
  // (b) HÀM gọi bên trong hàm khác -> vô hại, vì lúc gọi thì mọi file đã nạp xong.
  //     Chỉ vỡ khi gọi ở CẤP FILE hoặc trong callback chạy sớm (SSE onmessage, timer).
  //     Đây chính là ca renderPerm: stream.js nhận SSE trước khi export.js nạp xong.
  const varAt = {}, fnAt = {};
  files.forEach(({ s }, i) => {
    for (const m of s.matchAll(/^(?:let|const)\s+([A-Za-z_$][\w$]*)/gm)) if (!(m[1] in varAt)) varAt[m[1]] = i;
    for (const m of s.matchAll(/^function\s+([A-Za-z_$][\w$]*)/gm)) if (!(m[1] in fnAt)) fnAt[m[1]] = i;
  });

  // Dòng chạy NGAY khi nạp: không thụt lề (cấp file), hoặc nằm trong handler sự kiện
  // gắn ở cấp file (es.onmessage = ..., addEventListener, setInterval).
  const earlyLines = (s) => {
    const out = [];
    const lines = s.split('\n');
    let inEarly = false, depth = 0;
    for (const l of lines) {
      if (/^(es\.on\w+|window\.on\w+|document\.on\w+)\s*=|^\s*(es|window|document)\.addEventListener|^set(Interval|Timeout)\(/.test(l)) inEarly = true;
      if (inEarly) {
        out.push(l);
        depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
        if (depth <= 0 && /[});]\s*$/.test(l)) inEarly = false;
      } else if (/^[A-Za-z_$]/.test(l) && !/^(function|const|let|var|class)\b/.test(l)) out.push(l);
    }
    return out.join('\n');
  };

  let tdz = 0;
  files.forEach(({ n, s }, i) => {
    const early = earlyLines(s);
    for (const [v, di] of Object.entries(varAt)) {
      if (di <= i) continue;
      if (new RegExp('\\b' + v.replace(/\$/g, '\\$') + '\\b').test(s)) {
        tdz++;
        console.log('  LỖI  ' + n + ' dùng biến "' + v + '" khai báo ở ' + order[di] + ' (nạp sau)');
      }
    }
    for (const [f, di] of Object.entries(fnAt)) {
      if (di <= i) continue;
      if (new RegExp('\\b' + f.replace(/\$/g, '\\$') + '\\s*\\(').test(early)) {
        tdz++;
        console.log('  LỖI  ' + n + ' gọi sớm "' + f + '()" nhưng nó ở ' + order[di] + ' (nạp sau)');
      }
    }
  });
  if (tdz) { bad++; console.log('       -> chuyển các biến này lên core.js'); }
  else console.log('  ok   thứ tự nạp: không dùng biến khai báo ở file nạp sau');
}

// CSS: bắt lỗi ngoặc lệch — không phải parser đầy đủ, chỉ chốt chặn rẻ tiền
const cssFile = path.join(ROOT, 'web/legacy/app.css');
if (fs.existsSync(cssFile)) {
  const css = fs.readFileSync(cssFile, 'utf8');
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  if (open !== close) {
    bad++;
    console.log('  LỖI  web/legacy/app.css — ngoặc lệch: ' + open + ' mở, ' + close + ' đóng');
  } else console.log('  ok   web/legacy/app.css (' + open + ' khối)');
}

/* Mọi fetch() gọi THẲNG tới /api/* trong giao diện phải gắn token.
   Lỗi thật đã gặp: PasscodeGate gọi fetch('/api/passcode/verify') trực tiếp (cố ý, vì
   api() ném lỗi ở 401 nên không xử lý được "mã sai") nhưng quên gắn token. Cổng token
   nằm TRƯỚC cổng mã khoá -> verify trả 401, bấm "Mở khoá" không bao giờ ăn, màn hình
   trống trơn kèm banner "mất kết nối".
   KHÔNG bài test chạy nào bắt được: tất cả đều qua localhost, mà loopback được server
   miễn token. Nên phải kiểm ở MÃ NGUỒN, không phải lúc chạy. */
{
  const gd = [];
  const quet = (d) => {
    let ds; try { ds = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ds) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) quet(p);
      else if (/\.tsx?$/.test(e.name)) gd.push(p);
    }
  };
  quet(path.join(ROOT, 'web-next/components'));
  quet(path.join(ROOT, 'web-next/app'));

  const thieu = [];
  for (const f of gd) {
    const L = fs.readFileSync(f, 'utf8').split('\n');
    L.forEach((l, i) => {
      if (!/\bfetch\(\s*['"`]\/api\//.test(l)) return;
      // token có thể nằm ngay dòng đó hoặc 3 dòng kế (khối headers xuống dòng)
      const quanh = L.slice(i, i + 4).join(' ');
      if (!/dauToken|X-Dash-Token/.test(quanh)) {
        thieu.push(path.relative(ROOT, f) + ':' + (i + 1));
      }
    });
  }
  if (thieu.length) {
    bad++;
    console.log('  LỖI  fetch() thẳng tới /api/* mà KHÔNG gắn token (sẽ 401 khi vào từ máy khác):');
    thieu.forEach((t) => console.log('       ' + t));
  } else {
    console.log('  ok   mọi fetch() thẳng tới /api/* đều gắn token');
  }

  /* <img src> cũng KHÔNG gửi được header token — cùng hạn chế với EventSource.
     Lỗi thật đã gặp: ảnh Claude gửi về không xem được từ iPhone vì
     /api/toolimg trả 401. Đo từ ngoài: không token -> 401, thêm ?t= -> 200.
     Mọi src trỏ /api/ phải đi qua imgUrl() (lib/api.ts). */
  const anhThieu = [];
  for (const f of gd) {
    const L = fs.readFileSync(f, 'utf8').split('\n');
    L.forEach((l, i) => {
      if (!/\bsrc=\{?[`'"]?[^}]*\/api\//.test(l)) return;
      if (!/imgUrl|[?&]t=/.test(l)) anhThieu.push(path.relative(ROOT, f) + ':' + (i + 1));
    });
  }
  if (anhThieu.length) {
    bad++;
    console.log('  LỖI  src= trỏ /api/* mà KHÔNG gắn token (ảnh vỡ khi vào từ máy khác):');
    anhThieu.forEach((t) => console.log('       ' + t));
  } else {
    console.log('  ok   mọi src= trỏ /api/* đều gắn token');
  }
}

console.log(bad ? '\n' + bad + ' file có lỗi' : '\nTất cả hợp lệ (' + targets.length + ' file JS)');
process.exit(bad ? 1 : 0);
