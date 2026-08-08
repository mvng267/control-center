/* ================= HERMES tab: stable render ================= */
let hermesConvos = [];
let hermesMaxTs = 0;
let hermesSeenTs = 0;
let hermesOpenId = null;
let hermesRendered = 0; // số bubble đã render của conversation đang mở

let hermesFetchBusy = false; // chống fetch chồng nhau khi mạng chậm hơn interval
async function refreshHermes() {
  if (hermesFetchBusy) return;
  hermesFetchBusy = true;
  const r = await fetch('/api/hermes').then(r => r.json()).catch(() => null);
  hermesFetchBusy = false;
  if (!r) return;
  hermesConvos = r.conversations || [];
  hermesWaitServer = !!r.sending; // hermes CLI đang xử lý (kể cả gửi từ client/tab khác)
  let max = 0;
  hermesConvos.forEach(c => c.messages.forEach(m => { if (m.ts > max) max = m.ts; }));
  if (hermesSeenTs === 0) hermesSeenTs = max; // lần đầu: không báo unread cũ
  hermesMaxTs = max;
  if (activeTab === 'hermes') {
    hermesSeenTs = max;
    if (hermesOpenId) renderHermesChat(); // append-only: chỉ bubble MỚI được thêm, không rebuild
    else renderHermesList();
    updateHermesTyping();
  }
  updateBadges();
}
setInterval(refreshHermes, 2500); // poll realtime (server cache 1.5s); nền: badge nhảy cả khi ở tab CLI
refreshHermes();

// List conversations: diff theo data-hid
function renderHermesList() {
  const cont = document.getElementById('hermesrows');
  document.getElementById('hermesempty').classList.toggle('hidden', hermesConvos.length > 0);
  const seen = new Set();
  hermesConvos.forEach((c, idx) => {
    let row = cont.querySelector('[data-hid="' + CSS.escape(c.id) + '"]');
    if (!row) {
      row = document.createElement('div');
      row.className = 'srow fadein';
      row.dataset.hid = c.id;
      row.innerHTML =
        '<span class="chip h-src" style="background:rgba(139,92,246,.14);color:#a78bfa"></span>' +
        '<span class="h-title text-[13px] font-medium truncate"></span>' +
        '<span class="h-meta text-xs text-[#666b7d] ml-auto whitespace-nowrap"></span>';
      row.onclick = () => { hermesOpenId = c.id; hermesRendered = 0; hermesExtraRendered = 0; document.getElementById('hermes-bubbles').innerHTML = ''; renderHermesChat(); updateHermesTyping(); };
      cont.appendChild(row);
    }
    setText(row.querySelector('.h-src'), c.source);
    setText(row.querySelector('.h-title'), String(c.title).slice(0, 70));
    setText(row.querySelector('.h-meta'), c.count + ' msgs · ' + ago(c.lastTs));
    seen.add(c.id);
    const cur = cont.children[idx];
    if (cur !== row) cont.insertBefore(row, cur || null);
  });
  [...cont.children].forEach(ch => { if (!seen.has(ch.dataset.hid)) ch.remove(); });
}

// Message local (user gửi + reply từ Hermes CLI) theo conversation id.
// '__direct__' = chat trực tiếp không thuộc state.db.
// Persist vào localStorage để reply KHÔNG mất khi F5 (state.db không lưu chat CLI trực tiếp).
const hermesExtra = (function () {
  try {
    const j = JSON.parse(localStorage.getItem('hermesExtra') || '{}');
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {};
  } catch { return {}; }
})();
function saveHermesExtra() {
  try {
    // cap: mỗi conversation giữ 60 message cuối, tránh phình localStorage
    for (const k of Object.keys(hermesExtra)) {
      if (hermesExtra[k].length > 60) hermesExtra[k] = hermesExtra[k].slice(-60);
    }
    localStorage.setItem('hermesExtra', JSON.stringify(hermesExtra));
  } catch {} // quota đầy / private mode -> bỏ qua, chat vẫn chạy
}
let hermesExtraRendered = 0;

function openHermesDirect() {
  hermesOpenId = '__direct__';
  hermesRendered = 0;
  hermesExtraRendered = 0;
  document.getElementById('hermes-bubbles').innerHTML = '';
  renderHermesChat();
  updateHermesTyping();
}

// Chat hermes: append-only theo số message đã render (server msgs + local extras)
function renderHermesChat() {
  const c = hermesOpenId === '__direct__'
    ? { source: 'cli', title: 'Chat trực tiếp với Hermes', messages: [] }
    : hermesConvos.find(x => x.id === hermesOpenId);
  if (!c) return hermesBack();
  document.getElementById('hermes-list').classList.add('hidden');
  const hc = document.getElementById('hermes-chat');
  hc.classList.remove('hidden');
  hc.classList.add('flex');
  setText(document.getElementById('hermes-title'), '[' + c.source + '] ' + String(c.title).slice(0, 60));
  const box = document.getElementById('hermes-bubbles');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const extra = hermesExtra[hermesOpenId] || [];
  // server msgs tăng SAU khi đã render extras -> render lại từ đầu để giữ đúng thứ tự
  if (c.messages.length < hermesRendered || (c.messages.length > hermesRendered && hermesExtraRendered > 0)) {
    box.innerHTML = '';
    hermesRendered = 0;
    hermesExtraRendered = 0;
  }
  for (let i = hermesRendered; i < c.messages.length; i++) {
    const m = c.messages[i];
    box.appendChild(bubbleFor({ role: m.role, content: m.role === 'tool' ? m.content.slice(0, 300) : m.content }));
  }
  hermesRendered = c.messages.length;
  for (let i = hermesExtraRendered; i < extra.length; i++) box.appendChild(bubbleFor(extra[i]));
  hermesExtraRendered = extra.length;
  if (atBottom || hermesRendered + hermesExtraRendered <= 30) box.scrollTop = box.scrollHeight;
}

function hermesBack() {
  hermesOpenId = null;
  hermesRendered = 0;
  hermesExtraRendered = 0;
  document.getElementById('hermes-chat').classList.add('hidden');
  document.getElementById('hermes-chat').classList.remove('flex');
  document.getElementById('hermes-list').classList.remove('hidden');
  renderHermesList();
}

// Typing indicator Hermes: hiện khi CHỜ THẬT — request của client này đang chờ reply,
// hoặc server báo hermes CLI đang chạy (r.sending — gửi từ client/tab khác).
let hermesWaitLocal = false;
let hermesWaitServer = false;
function updateHermesTyping() {
  const on = !!hermesOpenId && (hermesWaitLocal || hermesWaitServer);
  document.getElementById('hermes-typing').classList.toggle('hidden', !on);
}

// Gửi tin cho Hermes: server gọi Hermes CLI thật, reply hiển thị như assistant message
function hermesSend(text) {
  switchTab('hermes');
  if (!hermesOpenId) openHermesDirect(); // gửi từ nơi khác -> mở chat trực tiếp
  const convId = hermesOpenId;
  (hermesExtra[convId] = hermesExtra[convId] || []).push({ role: 'user', content: text });
  saveHermesExtra();
  renderHermesChat();
  hermesWaitLocal = true;
  updateHermesTyping();
  busy(true);
  return fetch('/api/hermes/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(r => r.json())
    .then(r => {
      (hermesExtra[convId] = hermesExtra[convId] || []).push({
        role: 'assistant',
        content: r.ok ? r.reply : 'Lỗi Hermes: ' + (r.error || '?'),
      });
      saveHermesExtra();
      if (hermesOpenId === convId) renderHermesChat();
      if (!r.ok) toast('Hermes lỗi: ' + (r.error || '?'));
      else if (activeTab !== 'hermes') notifyDone('Hermes đã trả lời'); // user đã chuyển tab trong lúc chờ
    })
    .catch(e => {
      (hermesExtra[convId] = hermesExtra[convId] || []).push({ role: 'assistant', content: 'Lỗi mạng: ' + e.message });
      saveHermesExtra();
      if (hermesOpenId === convId) renderHermesChat();
    })
    .finally(() => {
      busy(false);
      hermesWaitLocal = false;
      updateHermesTyping();
      refreshHermes(); // reply có thể đã vào state.db -> kéo data mới ngay, không đợi tick 2.5s
    });
}
function submitHermes() {
  const inp = document.getElementById('hermes-input');
  const v = inp.value.trim();
  if (!v) return;
  histPush('hist:hermes', v);
  inp.value = '';
  hermesSend(v);
  scrollChatsToEnd(); // bubble user vừa render phải visible ngay
}
document.getElementById('hermes-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submitHermes(); });
document.getElementById('hermessendbtn').addEventListener('click', submitHermes);

// history riêng cho từng input (task / chat resume / hermes)
attachHistory(taskinput, 'hist:task');
attachHistory(document.getElementById('chatinput'), 'hist:chat');
attachHistory(document.getElementById('hermes-input'), 'hist:hermes');
