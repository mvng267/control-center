/* ================= SSE ================= */
// EventSource KHÔNG gửi được custom header -> token phải đi qua query string
const es = new EventSource('/stream' + (dashToken ? '?t=' + encodeURIComponent(dashToken) : ''));
es.onerror = () => {
  if (!dashToken) askToken();       // chưa có token thì hiện màn nhập mã
  setOffline(true);                 // SSE đứt = mất kết nối tới server
};
es.onopen = () => setOffline(false);

/* ---- báo mất mạng: vỏ app vẫn mở nhờ service worker nhưng dữ liệu thì đứng im ---- */
function setOffline(off) {
  const bar = document.getElementById('offbar');
  if (!bar) return;
  const show = off || !navigator.onLine;
  if (bar.classList.contains('hidden') === !show) return; // không đổi -> khỏi đụng DOM
  bar.classList.toggle('hidden', !show);
}
window.addEventListener('offline', () => setOffline(true));
window.addEventListener('online', () => setOffline(false));
let prevRunning = null; // Set sid RUNNING tick trước — null = tick đầu (không notify session cũ)
es.onmessage = e => {
  const data = JSON.parse(e.data);
  allSessions = data.sessions || [];
  allJobs = data.jobs || [];
  // server là nguồn thật, NHƯNG đang đổi dở thì đừng để tick cũ kéo ngược lại
  if (data.perm && !permBusy) { permMode = data.perm; renderPerm(); }
  // RUNNING -> hết RUNNING = Claude trả lời xong; chỉ notify khi KHÔNG đang mở chat đó
  const nowRunning = new Set();
  allSessions.forEach(s => { if (s.status === 'RUNNING') nowRunning.add(s.sid); });
  if (prevRunning) {
    for (const sid of prevRunning) {
      if (!nowRunning.has(sid) && !(activeTab === 'cli' && currentSid === sid)) {
        const s = allSessions.find(x => x.sid === sid);
        const label = (s && s.title) ? s.title : 'Claude ' + sid.slice(0, 8);
        notifyDone(label + ' đã trả lời xong');
      }
    }
  }
  prevRunning = nowRunning;
  // pill RUNNING trên header: chỉ toggle/setText — animation pulse 1 lần do CSS lo khi hiện lại
  const runpill = document.getElementById('runpill');
  runpill.classList.toggle('hidden', nowRunning.size === 0);
  if (nowRunning.size > 0) setText(document.getElementById('runpill-n'), String(nowRunning.size));
  setText(document.getElementById('modeltag'), data.model || 'default');
  updateProjectOptions();
  renderList();
  renderJobs();
  updateBadges();
  if (activeTab === 'stats') updateCharts(); // data đổi -> chart.update(), không rebuild
};

// Dropdown project: chỉ rebuild khi danh sách đổi (giữ lựa chọn)
function updateProjectOptions() {
  const sel = document.getElementById('projfilter');
  const projects = [...new Set(allSessions.map(s => s.project))].sort();
  const current = sel.value;
  const existing = [...sel.options].slice(1).map(o => o.value);
  if (existing.join('\u0000') === projects.join('\u0000')) return;
  sel.innerHTML = '<option value="">Tất cả project</option>';
  for (const pr of projects) {
    const opt = document.createElement('option');
    opt.value = pr;
    opt.textContent = pr;
    sel.appendChild(opt);
  }
  if (projects.includes(current)) sel.value = current;
}
