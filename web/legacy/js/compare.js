/* ================= session compare: chọn 2 sessions -> split view ================= */
compareMode = false;   // đang ở chế độ chọn session để so sánh
compareSel = [];       // sids đã chọn (tối đa 2)
compareSids = null;    // [sidA, sidB] đang mở trong compare view
let compareTimer = null;
const cmpRendered = [0, 0]; // số bubble đã render mỗi cột (append-only, không rebuild)

function toggleCompareMode() {
  compareMode = !compareMode;
  compareSel = [];
  document.getElementById('comparebtn').classList.toggle('cmp-on', compareMode);
  markCompareRows();
  toast(compareMode ? 'Chọn 2 session để so sánh side-by-side' : 'Đã tắt chế độ so sánh');
}
function markCompareRows() {
  document.querySelectorAll('#sessrows .srow').forEach(r =>
    r.classList.toggle('cmp-sel', compareMode && compareSel.includes(r.dataset.sid)));
}
// Click row: compare mode ON -> toggle chọn, đủ 2 -> mở compare view; OFF -> mở chat thường
function rowClick(sid) {
  if (!compareMode) return openChat(sid);
  compareSel = compareSel.includes(sid) ? compareSel.filter(x => x !== sid) : compareSel.concat(sid);
  if (compareSel.length === 2) {
    const pair = compareSel;
    compareMode = false;
    compareSel = [];
    document.getElementById('comparebtn').classList.remove('cmp-on');
    openCompare(pair[0], pair[1]);
  }
  markCompareRows();
}

function openCompare(a, b) {
  compareSids = [a, b];
  cmpRendered[0] = cmpRendered[1] = 0;
  document.getElementById('list').classList.add('hidden');
  const cv = document.getElementById('compare');
  cv.classList.remove('hidden');
  cv.classList.add('flex');
  for (const i of [0, 1]) {
    setText(document.getElementById('cmp-sid-' + i), compareSids[i].slice(0, 8));
    document.getElementById('cmp-bub-' + i).innerHTML = '';
  }
  refreshCompare();
  clearInterval(compareTimer);
  compareTimer = setInterval(refreshCompare, 3000);
}
let compareBusy = false; // chống 2 refresh chồng nhau -> duplicate bubbles
async function refreshCompare() {
  if (!compareSids || compareBusy) return;
  compareBusy = true;
  for (const i of [0, 1]) {
    if (!compareSids) break; // user đóng view giữa chừng
    const sid = compareSids[i];
    const r = await fetch('/api/history/' + sid).then(x => x.json()).catch(() => null);
    if (!r || !compareSids || compareSids[i] !== sid) continue;
    const st = document.getElementById('cmp-st-' + i);
    setText(st, r.status);
    const cls = 'chip ml-auto st-' + r.status;
    if (st.className !== cls) st.className = cls;
    const box = document.getElementById('cmp-bub-' + i);
    const cg = groupMessages(r.messages); // gộp lượt như chat view cho nhất quán
    if (cg.length < cmpRendered[i]) { box.innerHTML = ''; cmpRendered[i] = 0; }
    for (let k = cmpRendered[i]; k < cg.length; k++) box.appendChild(bubbleFor(cg[k]));
    if (cmpRendered[i] !== cg.length) {
      cmpRendered[i] = cg.length;
      box.scrollTop = box.scrollHeight;
    }
  }
  compareBusy = false;
}
function closeCompare() {
  compareSids = null;
  clearInterval(compareTimer);
  const cv = document.getElementById('compare');
  cv.classList.add('hidden');
  cv.classList.remove('flex');
  document.getElementById('list').classList.remove('hidden');
}
