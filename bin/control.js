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

  control                     chạy dashboard ở cổng 7799
  control --port 8080         đổi cổng
  control --autostart enable  bật chạy nền lúc boot
  control --autostart disable tắt chạy nền
  control --autostart status  xem trạng thái
  control --version           xem bản
  control --help              bảng này

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

// --autostart (macOS/Linux)
const iAuto = args.findIndex((a) => a === '--autostart');
if (iAuto >= 0) {
  const action = args[iAuto + 1];
  const os = require('os');
  const fs = require('fs');
  const homeDir = os.homedir();

  if (os.platform() === 'darwin') {
    // macOS — launchd
    const plistPath = path.join(homeDir, 'Library/LaunchAgents/com.mvng.control.plist');
    if (action === 'enable') {
      require('child_process').execSync('launchctl load ' + plistPath, { stdio: 'inherit' });
      console.log('✓ Autostart bật — dashboard sẽ chạy lúc đăng nhập');
    } else if (action === 'disable') {
      require('child_process').execSync('launchctl unload ' + plistPath, { stdio: 'inherit' });
      console.log('✓ Autostart tắt');
    } else if (action === 'status') {
      try {
        const out = require('child_process').execSync('launchctl list | grep control', { encoding: 'utf8' });
        console.log('✓ Autostart ON\n' + out.trim());
      } catch {
        console.log('✗ Autostart OFF');
      }
    }
  } else {
    // Linux — systemd
    if (action === 'enable') {
      require('child_process').execSync('sudo systemctl enable control && sudo systemctl start control', { stdio: 'inherit' });
      console.log('✓ Autostart bật — dashboard sẽ chạy lúc boot');
    } else if (action === 'disable') {
      require('child_process').execSync('sudo systemctl disable control && sudo systemctl stop control', { stdio: 'inherit' });
      console.log('✓ Autostart tắt');
    } else if (action === 'status') {
      try {
        require('child_process').execSync('sudo systemctl status control --no-pager', { stdio: 'inherit' });
      } catch {
        console.log('✗ Autostart OFF');
      }
    }
  }
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
