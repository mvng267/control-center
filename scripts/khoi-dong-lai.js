#!/usr/bin/env node
/* Khởi động lại dashboard trên máy này (Mac hoặc Debian), rồi CHỜ nó lên thật.
   Cách chạy:  node scripts/khoi-dong-lai.js

   Vì sao cần script thay vì gõ tay: đã mất gần một giờ vì tiến trình cũ vẫn nghe
   cổng 7799 trong khi mã đã có endpoint mới — panel xem file dựng ra cây rỗng, test
   đỏ, mà log restart nhìn thì tưởng xong. Script này chờ đến khi server trả lời
   RỒI mới báo xong, và kiểm luôn endpoint mới có mặt chưa. */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONG = process.env.PORT || '7799';
const LOG = path.join(ROOT, 'dashboard.log');

function dungTienTrinhCu() {
  let ra = '';
  try { ra = execSync(`lsof -ti:${CONG} -sTCP:LISTEN`, { encoding: 'utf8' }).trim(); }
  catch { console.log(`cổng ${CONG} đang trống`); return; }
  for (const pid of ra.split('\n').filter(Boolean)) {
    try { process.kill(+pid, 'SIGTERM'); console.log('đã dừng tiến trình cũ, pid', pid); } catch {}
  }
}

function batLen() {
  const out = fs.openSync(LOG, 'a');
  const con = spawn(process.execPath, ['src/server/index.js'], {
    cwd: ROOT, detached: true, stdio: ['ignore', out, out],
    env: { ...process.env, PORT: CONG },
  });
  con.unref();
  return con.pid;
}

function docToken() {
  try {
    return JSON.parse(fs.readFileSync(
      path.join(os.homedir(), '.claude', 'dashboard-token.json'), 'utf8')).token;
  } catch { return ''; }
}

async function choLen() {
  for (let i = 1; i <= 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const r = await fetch(`http://127.0.0.1:${CONG}/api/passcode/status`);
      if (r.ok) return i;
    } catch {}
  }
  return 0;
}

(async () => {
  console.log('==> thư mục:', ROOT);
  console.log('==> bản:', execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(),
    '(' + execSync('git log -1 --format=%s', { cwd: ROOT, encoding: 'utf8' }).trim().slice(0, 60) + ')');

  dungTienTrinhCu();
  await new Promise((r) => setTimeout(r, 1500));
  console.log('==> khởi động lại, pid', batLen(), '| log:', LOG);

  const giay = await choLen();
  if (!giay) {
    console.error(`!! server KHÔNG lên sau 20s. Xem ${LOG}`);
    process.exit(1);
  }
  console.log(`==> server trả lời trên cổng ${CONG} (sau ${giay}s)`);

  /* Kiểm bản mới ĐÃ THẬT SỰ nạp: /api/tree chỉ có ở bản mới. 404 nghĩa là tiến trình
     cũ còn sống — thà báo lỗi ở đây còn hơn để phát hiện lúc bấm vào nút. */
  const token = docToken();
  if (token) {
    try {
      const r = await fetch(`http://127.0.0.1:${CONG}/api/tree?sid=kiem-tra`,
        { headers: { 'X-Dash-Token': token } });
      if (r.status === 404) {
        console.error('!! /api/tree trả 404 — tiến trình CŨ vẫn chạy, bản mới chưa nạp.');
        process.exit(1);
      }
      console.log(`==> endpoint mới có mặt (/api/tree -> HTTP ${r.status})`);
    } catch (e) { console.log('   (không kiểm được endpoint:', e.message, ')'); }
  }

  let ip = '';
  try { ip = execSync('tailscale ip -4', { encoding: 'utf8' }).trim().split('\n')[0]; } catch {}
  if (ip) console.log(`==> vào từ iPhone: http://${ip}:${CONG}/?t=${token}`);
  console.log('==> xong.');
})();
