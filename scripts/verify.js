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

console.log(bad ? '\n' + bad + ' file có lỗi' : '\nTất cả hợp lệ (' + targets.length + ' file JS)');
process.exit(bad ? 1 : 0);
