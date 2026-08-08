// Liệt kê tiến trình node đang chạy + cổng đang nghe, để phát hiện server sót từ lượt test trước
const { execFileSync } = require('child_process');
function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8' }); } catch (e) { return (e.stdout || '') + ''; }
}
const ps = sh('ps', ['-eo', 'pid,etime,command']);
const rows = ps.split('\n').filter(l => l.indexOf('claude-dashboard.js') >= 0 && l.indexOf('grep') < 0);
console.log('tiến trình claude-dashboard đang chạy: ' + rows.length);
rows.forEach(r => console.log('  ' + r.trim().slice(0, 110)));
const lsof = sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
const ports = lsof.split('\n').filter(l => /78\d\d|779\d/.test(l));
console.log('cổng test đang nghe:');
ports.forEach(p => console.log('  ' + p.trim().slice(0, 100)));
