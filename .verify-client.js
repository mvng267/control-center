// Kiểm tra cú pháp JS CLIENT (nằm trong template literal của server).
// node --check chỉ soi được phía server -> phải lấy đúng HTML đã phục vụ rồi check.
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 7893;
const srv = spawn('node', ['claude-dashboard.js'], {
  cwd: __dirname,
  env: Object.assign({}, process.env, { PORT: String(PORT) }),
  stdio: ['ignore', 'ignore', 'pipe'],
});
let srvErr = '';
srv.stderr.on('data', d => { srvErr += d.toString(); });

const done = code => { try { srv.kill(); } catch {} process.exit(code); };

setTimeout(() => {
  http.get({ host: '127.0.0.1', port: PORT, path: '/' }, res => {
    let html = '';
    res.on('data', d => { html += d; });
    res.on('end', () => {
      const s = html.lastIndexOf('<script>');
      const e = html.lastIndexOf('</script>');
      if (s < 0 || e < 0) { console.log('KHÔNG tìm thấy <script>'); return done(1); }
      const js = html.slice(s + 8, e);
      const out = path.join(os.tmpdir(), 'client-check.js');
      fs.writeFileSync(out, js);
      try {
        execFileSync('node', ['--check', out], { stdio: 'pipe' });
        console.log('CLIENT JS OK (' + js.length + ' ký tự)');
        done(0);
      } catch (err) {
        console.log('CLIENT JS LỖI:');
        console.log((err.stderr || Buffer.from('')).toString().split('\n').slice(0, 8).join('\n'));
        done(1);
      }
    });
  }).on('error', err => {
    console.log('không gọi được server:', err.message, srvErr.slice(0, 200));
    done(1);
  });
}, 2500);
