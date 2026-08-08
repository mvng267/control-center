// Đo chi phí 1 nhịp SSE: /stream gọi listSessions() -> parse mọi file .jsonl chưa cache.
// File của phiên ĐANG CHẠY đổi mtime liên tục -> cache trượt -> parse lại toàn bộ mỗi nhịp.
const http = require('http');
const { spawn } = require('child_process');

const PORT = 7894;
const srv = spawn('node', [require('path').join(__dirname, '..', 'src', 'server', 'index.js')], {
  cwd: __dirname,
  env: Object.assign({}, process.env, { PORT: String(PORT) }),
  stdio: ['ignore', 'ignore', 'ignore'],
});
const stop = c => { try { srv.kill(); } catch {} process.exit(c); };

function hit(path) {
  return new Promise(res => {
    const t0 = Date.now();
    http.get({ host: '127.0.0.1', port: PORT, path, timeout: 60000 }, r => {
      let n = 0;
      r.on('data', d => { n += d.length; });
      r.on('end', () => res({ ms: Date.now() - t0, bytes: n }));
    }).on('error', () => res({ ms: -1, bytes: 0 }));
  });
}

setTimeout(async () => {
  // trang chủ: đây là cái page.goto của Playwright chờ
  const a = await hit('/');
  const b = await hit('/');
  console.log('GET /        lần 1: ' + a.ms + 'ms (' + a.bytes + ' bytes)');
  console.log('GET /        lần 2: ' + b.ms + 'ms');
  // /api/sessions dùng chung listSessions với SSE
  const c = await hit('/api/sessions');
  const d = await hit('/api/sessions');
  console.log('listSessions lần 1: ' + c.ms + 'ms (' + c.bytes + ' bytes)');
  console.log('listSessions lần 2: ' + d.ms + 'ms  <- lần 2 mà vẫn chậm = cache trượt');
  stop(0);
}, 3000);
