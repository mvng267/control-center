// Dựng server test rồi chạy e2e-test.js, in kết quả, dọn sạch.
// Gói vào 1 script node vì shell/bash chưa được cấp quyền.
const { spawn } = require('child_process');

const PORT = process.env.VPORT || 7893;
const RUNS = +(process.env.RUNS || 1);

const srv = spawn('node', ['claude-dashboard.js'], {
  cwd: __dirname,
  env: Object.assign({}, process.env, { PORT: String(PORT) }),
  stdio: ['ignore', 'ignore', 'pipe'],
});
srv.stderr.on('data', () => {});

const stop = code => { try { srv.kill(); } catch {} process.exit(code); };

function runOnce(n) {
  return new Promise(resolve => {
    const t = spawn('node', ['e2e-test.js'], {
      cwd: __dirname,
      env: Object.assign({}, process.env, { DASH_URL: 'http://localhost:' + PORT + '/' }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    t.stdout.on('data', d => { out += d.toString(); });
    t.stderr.on('data', d => { out += d.toString(); });
    t.on('exit', () => {
      const lines = out.split('\n');
      const fails = lines.filter(l => l.indexOf('FAIL') === 0 || l.indexOf('SCRIPT ERROR') >= 0);
      const total = lines.filter(l => l.indexOf('PASS ====') >= 0 || l.indexOf('==== ') === 0);
      console.log('--- lượt ' + n + ' ---');
      fails.slice(0, 12).forEach(l => console.log(l.slice(0, 220)));
      total.forEach(l => console.log(l));
      resolve();
    });
  });
}

// Đợi server TRẢ LỜI THẬT rồi mới chạy test — đợi cứng 2.8s có lúc không đủ
// (máy bận / port còn kẹt) và e2e chết ngay ở page.goto.
const http2 = require('http');
function waitUp(tries, cb) {
  if (tries <= 0) { console.log('server không lên sau 20s'); return stop(1); }
  const req = http2.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, res => {
    res.resume();
    cb();
  });
  req.on('error', () => setTimeout(() => waitUp(tries - 1, cb), 700));
  req.on('timeout', () => { req.destroy(); setTimeout(() => waitUp(tries - 1, cb), 700); });
}

waitUp(28, async () => {
  for (let i = 1; i <= RUNS; i++) await runOnce(i);
  stop(0);
});
