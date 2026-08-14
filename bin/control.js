#!/usr/bin/env node
/* Điểm vào khi cài bằng npm: `npm i -g claude-control-center` rồi gõ `control`.

   Chỉ làm hai việc: đọc cờ dòng lệnh rồi nhường cho server thật. Không gói thêm logic
   nào ở đây — bản chạy bằng `node src/server/index.js` (clone git) và bản chạy bằng
   `control` (npm) phải đi qua CÙNG một đường, nếu không thì lỗi chỉ hiện ở một kiểu
   cài và không ai đoán được vì sao. */
const path = require('path');

const args = process.argv.slice(2);

if (args.includes('-h') || args.includes('--help')) {
  const { version } = require('../package.json');
  console.log(`claude-control-center v${version}

  control                 chạy dashboard ở cổng 7799
  control --port 8080     đổi cổng
  control --version       xem bản
  control --help          bảng này

Mở http://localhost:7799 — lần chạy đầu server in ra mã truy cập, dán vào
để mở từ máy khác. Mã lưu ở ~/.claude/dashboard-token.json.

Dashboard đọc phiên Claude CLI từ ~/.claude/projects, nên phải chạy trên
đúng máy đang dùng Claude CLI.`);
  process.exit(0);
}

if (args.includes('-v') || args.includes('--version')) {
  console.log(require('../package.json').version);
  process.exit(0);
}

// --port 8080 (và -p) -> PORT, vì server đọc cổng qua biến môi trường
const iCong = args.findIndex((a) => a === '--port' || a === '-p');
if (iCong >= 0 && args[iCong + 1]) {
  const c = Number(args[iCong + 1]);
  if (!Number.isInteger(c) || c < 1 || c > 65535) {
    console.error('Cổng không hợp lệ:', args[iCong + 1]);
    process.exit(1);
  }
  process.env.PORT = String(c);
}

require(path.join(__dirname, '..', 'src', 'server', 'index.js'));
