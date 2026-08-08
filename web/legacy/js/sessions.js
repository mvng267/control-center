/* ================= session list: STABLE RENDER (diff theo data-sid) ================= */

function createSessionRow(s) {
  const row = document.createElement('div');
  row.className = 'srow fadein';
  row.dataset.sid = s.sid;
  row.onclick = () => rowClick(s.sid); // compare mode ON -> chọn để so sánh, OFF -> mở chat
  // Layout: [dot] [avatar] [body: title + meta] [right: time + badge]
  row.innerHTML =
    // dot trạng thái
    '<span class="sdot s-dot shrink-0"></span>' +
    // avatar icon
    '<span class="s-avatar w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0 text-[#60a5fa]" style="background:rgba(59,130,246,.1)">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>' +
    '</span>' +
    // body
    '<span class="flex-1 min-w-0 flex flex-col gap-0.5">' +
      '<span class="flex items-center gap-2">' +
        '<span class="s-sid text-[13px] font-semibold text-[#e4e4e7] truncate leading-tight"></span>' +
        '<span class="s-badge ubadge hidden ml-1 shrink-0"></span>' +
      '</span>' +
      '<span class="s-proj text-[11.5px] text-[#666b7d] truncate leading-tight"></span>' +
    '</span>' +
    // right col: time + kill
    '<span class="flex flex-col items-end gap-1.5 shrink-0">' +
      '<span class="s-time text-[10.5px] text-[#4b5163] whitespace-nowrap tabular-nums"></span>' +
      '<span class="s-msgs text-[10px] text-[#4b5163] whitespace-nowrap"></span>' +
    '</span>';
  const kill = document.createElement('button');
  kill.className = 's-kill hidden w-7 h-7 rounded-lg hover:bg-[#2a1518] flex items-center justify-center text-[#ef4444] transition-colors shrink-0';
  kill.title = 'Kill';
  kill.innerHTML = ICON_TRASH;
  kill.onclick = ev => { ev.stopPropagation(); fetch('/api/kill/' + s.sid, { method: 'POST' }); };
  row.appendChild(kill);
  return row;
}

// Chỉ update phần thay đổi của row — không rebuild
function updateSessionRow(row, s) {
  // dot trạng thái
  const dot = row.querySelector('.s-dot');
  const dotClass = 'sdot s-dot shrink-0 sdot-' + s.status;
  if (dot.className !== dotClass) dot.className = dotClass;

  // avatar màu theo trạng thái
  const av = row.querySelector('.s-avatar');
  if (av) {
    if (s.status === 'RUNNING') {
      av.style.background = 'rgba(16,185,129,.12)';
      av.style.color = '#34d399';
    } else if (s.status === 'ACTIVE') {
      av.style.background = 'rgba(59,130,246,.1)';
      av.style.color = '#60a5fa';
    } else {
      av.style.background = 'rgba(59,130,246,.06)';
      av.style.color = '#4b5163';
    }
  }

  // tiêu đề thật (ai-title / tên tự đặt); chưa có thì mới rơi về ID
  setText(row.querySelector('.s-sid'), s.title || s.sid.slice(0, 8));
  const sidEl = row.querySelector('.s-sid');
  if (sidEl.title !== s.sid) sidEl.title = s.sid; // hover/long-press vẫn xem được ID gốc
  setText(row.querySelector('.s-proj'), s.project);
  setText(row.querySelector('.s-time'), ago(s.mtimeMs));
  setText(row.querySelector('.s-msgs'), s.msgs + ' msgs');
  const badge = row.querySelector('.s-badge');
  badge.classList.toggle('hidden', !(s.unread > 0));
  if (s.unread > 0) setText(badge, String(s.unread));
  row.querySelector('.s-kill').classList.toggle('hidden', s.status !== 'RUNNING');
  row.classList.toggle('cmp-sel', compareMode && compareSel.includes(s.sid));
}

function filteredSessions() {
  const proj = document.getElementById('projfilter').value;
  const q = document.getElementById('searchbox').value.trim().toLowerCase();
  return allSessions.filter(s => {
    if (proj && s.project !== proj) return false;
    if (q && !(s.sid + ' ' + s.project + ' ' + (s.title || '')).toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderList() {
  const cont = document.getElementById('sessrows');
  const sessions = filteredSessions();
  document.getElementById('emptystate').classList.toggle('hidden', sessions.length > 0);
  const skel = document.getElementById('skelrows');
  if (skel) skel.remove(); // data thật đã về -> bỏ skeleton (shimmer chỉ chạy lúc chờ)
  const seen = new Set();
  sessions.forEach((s, idx) => {
    let row = cont.querySelector('[data-sid="' + s.sid + '"]');
    if (!row) row = createSessionRow(s);
    updateSessionRow(row, s);
    seen.add(s.sid);
    // đặt đúng vị trí — insertBefore với node có sẵn chỉ MOVE khi lệch thứ tự
    const cur = cont.children[idx];
    if (cur !== row) cont.insertBefore(row, cur || null);
  });
  [...cont.children].forEach(ch => { if (!seen.has(ch.dataset.sid)) ch.remove(); });
  applySelection();
}

/* ================= jobs bar (diff theo data-jid) ================= */
function renderJobs() {
  const bar = document.getElementById('jobsbar');
  bar.classList.toggle('hidden', !allJobs.length);
  const seen = new Set();
  for (const j of allJobs) {
    let row = bar.querySelector('[data-jid="' + j.id + '"]');
    if (!row) {
      row = document.createElement('div');
      row.className = 'jobrow fadein';
      row.dataset.jid = j.id;
      row.innerHTML =
        '<span class="font-semibold j-kind"></span>' +
        '<span class="truncate j-prompt"></span>' +
        '<span class="j-runs ml-auto whitespace-nowrap"></span>';
      const stop = document.createElement('button');
      stop.className = 'text-[11px] font-semibold border border-[#d9a441]/40 rounded-md px-2 py-0.5 hover:bg-[#d9a441]/15 transition-colors';
      stop.textContent = 'STOP';
      stop.onclick = ev => { ev.stopPropagation(); fetch('/api/jobs/stop/' + j.id, { method: 'POST' }); };
      row.appendChild(stop);
      row.onclick = () => { if (j.lastSid) openChat(j.lastSid); };
      bar.appendChild(row);
    }
    setText(row.querySelector('.j-kind'), '[' + j.kind.toUpperCase() + ' ' + j.spec + ']');
    setText(row.querySelector('.j-prompt'), j.prompt);
    setText(row.querySelector('.j-runs'), 'runs: ' + j.runs);
    seen.add(j.id);
  }
  [...bar.children].forEach(ch => { if (!seen.has(ch.dataset.jid)) ch.remove(); });
}

document.getElementById('searchbox').addEventListener('input', renderList);
document.getElementById('projfilter').addEventListener('change', renderList);

/* ================= keyboard selection (j/k/Enter) ================= */
let selIdx = -1;
function visibleRows() { return [...document.querySelectorAll('#sessrows .srow')]; }
function applySelection() {
  const rows = visibleRows();
  if (selIdx >= rows.length) selIdx = rows.length - 1;
  rows.forEach((r, i) => r.classList.toggle('selected', i === selIdx));
}
function moveSel(d) {
  const rows = visibleRows();
  if (!rows.length) return;
  selIdx = Math.min(rows.length - 1, Math.max(0, selIdx + d));
  applySelection();
  rows[selIdx].scrollIntoView({ block: 'nearest' });
}
function openSelected() {
  const rows = visibleRows();
  if (selIdx >= 0 && rows[selIdx]) openChat(rows[selIdx].dataset.sid);
}
