/* ================= export: tải session ra file .md / .json ================= */
// Claude: server trả full history kèm Content-Disposition -> chỉ cần điều hướng qua <a>
function downloadURL(u) {
  const a = document.createElement('a');
  a.href = u;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
// Hermes: data nằm ở client (server msgs + local extras) -> build Blob rồi tải
function downloadBlob(name, type, text) {
  const a = document.createElement('a');
  const blobUrl = URL.createObjectURL(new Blob([text], { type }));
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
}

function exportCurrent() {
  if (!currentSid) return toast('Mở 1 session trước rồi mới export');
  const sid = currentSid;
  const box = document.createElement('div');
  box.textContent = 'Tải TOÀN BỘ history của "' + (chatTitle || sid.slice(0, 8))
    + '" (không giới hạn 30 message cuối), hoặc copy 30 message cuối ra clipboard.';
  showOverlay('Export session', box, [
    overlayButton('Copy clipboard', () => { closeOverlay(); exportChat(); }),
    overlayButton('Tải .json', () => { downloadURL('/api/export/' + sid + '?fmt=json'); closeOverlay(); toast('Đang tải .json'); }),
    overlayButton('Tải .md', () => { downloadURL('/api/export/' + sid + '?fmt=md'); closeOverlay(); toast('Đang tải .md'); }, true),
  ]);
}

function hermesExport() {
  if (!hermesOpenId) return toast('Mở 1 conversation trước rồi mới export');
  const c = hermesOpenId === '__direct__'
    ? { title: 'Chat trực tiếp với Hermes', messages: [] }
    : hermesConvos.find(x => x.id === hermesOpenId);
  const msgs = (c ? c.messages : []).concat(hermesExtra[hermesOpenId] || [])
    .map(x => ({ role: x.role, content: x.content, ts: x.ts || 0 }));
  if (!msgs.length) return toast('Chưa có message nào để export');
  const id = (hermesOpenId === '__direct__' ? 'direct' : String(hermesOpenId).slice(0, 12)).replace(/[^\w.-]/g, '_');
  const title = c ? String(c.title) : String(hermesOpenId);
  const box = document.createElement('div');
  box.textContent = 'Export ' + msgs.length + ' messages của "' + title.slice(0, 60) + '".';
  showOverlay('Export Hermes chat', box, [
    overlayButton('Tải .json', () => {
      downloadBlob('hermes-' + id + '.json', 'application/json',
        JSON.stringify({ id: hermesOpenId, title, count: msgs.length, messages: msgs }, null, 2));
      closeOverlay();
      toast('Đang tải .json');
    }),
    overlayButton('Tải .md', () => {
      const NL = String.fromCharCode(10);
      let md = '# Hermes chat: ' + title + NL + NL;
      for (const x of msgs) {
        md += '**' + (x.role === 'user' ? 'User' : x.role === 'tool' ? 'Tool' : 'Assistant') + '**:'
          + NL + NL + x.content + NL + NL + '---' + NL + NL;
      }
      downloadBlob('hermes-' + id + '.md', 'text/markdown', md);
      closeOverlay();
      toast('Đang tải .md');
    }, true),
  ]);
}

let chatBusy = false; // chống 2 refresh chồng nhau (timer + gọi tay sau send) -> duplicate bubbles
async function refreshChat() {
  if (!currentSid || chatBusy) return;
  chatBusy = true;
  const sidAtFetch = currentSid;
  const r = await fetch('/api/history/' + sidAtFetch).then(r => r.json()).catch(() => null);
  chatBusy = false;
  if (!r || currentSid !== sidAtFetch) return;
  // tiêu đề có thể đổi (Claude CLI sinh ai-title mới giữa chừng) -> cập nhật tại chỗ
  if (r.title !== undefined && r.title !== chatTitle) {
    chatTitle = r.title || '';
    setText(document.getElementById('chatsid'), chatTitle || sidAtFetch.slice(0, 8));
  }
  const st = document.getElementById('chatstatus');
  const stClass = 'chip st-' + r.status;
  if (st.className !== stClass) st.className = stClass;
  const lbl = st.querySelector('.chip-label');
  if (lbl) setText(lbl, r.status); else setText(st, r.status);

  const box = document.getElementById('bubbles');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  // clearOffsets lưu TỔNG tuyệt đối lúc /clear; server trả window 30 cuối + total
  // -> quy đổi về vị trí trong window (fix: session >30 msg /clear xong vẫn nhận message mới)
  const total = r.total != null ? r.total : r.messages.length;
  const dropped = total - r.messages.length; // số msg cũ đã trôi khỏi window 30
  const skip = Math.max(0, (clearOffsets[currentSid] || 0) - dropped);
  const msgs = r.messages.slice(skip);
  chatTotal = total;
  // start: vị trí TUYỆT ĐỐI của msgs[0]. Chỉ so length là không đủ — khi window 30 trượt
  // (msg mới đẩy msg cũ ra) length không đổi -> vòng append bên dưới không chạy lần nào
  // -> client đứng hình, im lặng bỏ lỡ mọi message mới.
  // Window trượt (msg mới đẩy msg cũ ra): messages.length KHÔNG đổi, nên chỉ so length là
  // client đứng hình, im lặng bỏ lỡ mọi msg mới. So start tuyệt đối mới phát hiện được.
  // Vì bubble được GỘP theo lượt, số bubble != số message -> vẽ lại rồi mở lại đúng card cũ,
  // đơn giản và chắc hơn là cố cắt từng node ở đầu.
  const start = (r.start != null ? r.start : dropped) + skip;
  if (chatStart === -1) chatStart = start;
  if (start !== chatStart || msgs.length < chatRendered) {
    reopenTids = [...box.querySelectorAll('.tcard.open')].map(c => c.dataset.tid).filter(Boolean);
    box.innerHTML = '';
    chatRendered = 0;
    chatLastN = 0;
    chatCards.clear();
    chatStart = start;
  }
  // Gộp lượt assistant liên tiếp -> số BUBBLE khác số message, nên append theo nhóm.
  const groups = groupMessages(msgs);
  if (chatRendered === 0) lastDayKey = '';
  // Nhóm cuối có thể "lớn thêm" khi Claude gọi tiếp tool trong cùng lượt -> vẽ lại RIÊNG nhóm đó.
  // Không đụng nhóm trước, nên card đang mở ở các lượt cũ vẫn nguyên.
  if (chatRendered > 0 && chatRendered <= groups.length) {
    const lastIdx = chatRendered - 1;
    const g = groups[lastIdx];
    if (g && (g.n || 1) !== chatLastN) {
      const node = box.querySelector('[data-gi="' + lastIdx + '"]');
      if (node) {
        const wasOpen = [...node.querySelectorAll('.tcard.open')].map(c => c.dataset.tid);
        const fresh = bubbleFor(g);
        fresh.dataset.gi = lastIdx;
        node.replaceWith(fresh);
        // giữ lại card user đang mở trong chính lượt này
        wasOpen.forEach(tid => {
          const c = fresh.querySelector('.tcard[data-tid="' + tid + '"]');
          if (c && !c.classList.contains('open')) c.querySelector('.tcard-head').click();
        });
      }
    }
  }
  for (let i = chatRendered; i < groups.length; i++) {
    const before = box.lastElementChild;
    appendMessage(box, groups[i]);
    const added = box.lastElementChild;
    if (added && added !== before) added.dataset.gi = i;
  }
  chatRendered = groups.length;
  chatLastN = groups.length ? (groups[groups.length - 1].n || 1) : 0;
  // sau khi vẽ lại vì window trượt: mở lại đúng những card user đang xem dở
  if (reopenTids.length) {
    reopenTids.forEach(tid => {
      const c = box.querySelector('.tcard[data-tid="' + tid + '"]');
      if (c && !c.classList.contains('open')) c.querySelector('.tcard-head').click();
    });
    reopenTids = [];
  }
  reconcileToolStatus(msgs); // tool xong -> đổi chip tại chỗ (không rebuild)
  // lỗi từ lần chạy claude gần nhất -> hiện banner; trước đây lỗi bị nuốt hoàn toàn
  const errBox = document.getElementById('chaterr');
  if (r.error) {
    setText(document.getElementById('chaterrmsg'), r.error);
    errBox.classList.remove('hidden');
  } else errBox.classList.add('hidden');
  document.getElementById('typingind').classList.toggle('hidden', !r.typing);
  setChatRunning(r.status === 'RUNNING'); // đang chạy -> nút gửi thành nút Dừng
  // lỗi chạy Claude (resume trượt...) -> hiện rõ, đừng để user tưởng đã gửi được
  const ce = document.getElementById('chaterr');
  if (r.error) { setText(ce, r.error); ce.classList.remove('hidden'); }
  else ce.classList.add('hidden');
  if (r.model !== undefined && r.model !== chatModel) { chatModel = r.model; renderChatModel(); }
  // chờ duyệt kế hoạch -> hiện thanh Duyệt/Sửa (rung nhẹ 1 lần khi vừa xuất hiện)
  const ap = document.getElementById('chatapprove');
  const wasHidden = ap.classList.contains('hidden');
  ap.classList.toggle('hidden', !r.awaiting);
  if (r.awaiting && wasHidden && navigator.vibrate) navigator.vibrate(30);
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function killCurrent() {
  if (currentSid) fetch('/api/kill/' + currentSid, { method: 'POST' });
}

/* ---- quyền của Claude ----
   Dashboard chạy claude ở chế độ -p với stdio ignore nên KHÔNG có hộp thoại hỏi quyền như CLI:
   ở chế độ mặc định, Claude im lặng bỏ qua việc cần quyền rồi trả lời "bạn chưa cấp quyền"
   — nhìn như đã làm mà thật ra không làm gì. */
const PERM_UI = {
  default: { label: 'Hỏi quyền', cls: '', toast: 'Chế độ mặc định — Claude KHÔNG tự sửa được file (sẽ báo chưa có quyền)' },
  acceptEdits: { label: 'Tự sửa file', cls: 'p-accept', toast: 'Claude tự sửa/tạo file được; lệnh nguy hiểm vẫn bị chặn' },
  plan: { label: 'Duyệt trước', cls: 'p-plan', toast: 'Claude trình bày kế hoạch rồi chờ bạn bấm Duyệt mới làm' },
  bypassPermissions: { label: 'Bỏ mọi kiểm tra', cls: 'p-bypass', toast: 'CẨN THẬN: bỏ qua MỌI kiểm tra quyền, kể cả lệnh nguy hiểm' },
};
const PERM_CYCLE = ['acceptEdits', 'plan', 'default', 'bypassPermissions'];
let permMode = 'acceptEdits';

function renderPerm() {
  const b = document.getElementById('permbtn');
  if (!b) return;
  const ui = PERM_UI[permMode] || PERM_UI.default;
  const cls = 'permbtn ' + ui.cls;
  if (b.className.trim() !== cls.trim()) b.className = cls;
  setText(document.getElementById('permlabel'), ui.label);
  b.title = 'Quyền của Claude: ' + ui.label + ' — bấm để đổi';
}

let permBusy = 0;      // >0 = đang chờ server xác nhận -> SSE tick cũ không được ghi đè
let permChain = Promise.resolve(); // xếp hàng: bấm nhanh 2 lần vẫn nhảy đúng 2 nấc
function cyclePerm() {
  const next = PERM_CYCLE[(PERM_CYCLE.indexOf(permMode) + 1) % PERM_CYCLE.length];
  permMode = next;
  permBusy++;
  renderPerm();
  permChain = permChain.then(() =>
    fetch('/api/perm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: next }),
    }).then(r => r.json()).then(r => {
      // chỉ nhận kết quả của lượt CUỐI, tránh phản hồi cũ kéo ngược trạng thái
      if (r.mode && permBusy === 1) { permMode = r.mode; renderPerm(); }
      toast(PERM_UI[permMode].toast);
    }).catch(() => toast('Không đổi được chế độ quyền'))
      .finally(() => { permBusy--; }));
  return permChain;
}

/* ---- model riêng từng phiên: /model đổi TOÀN CỤC nên phiên khác dính theo ---- */
let chatModel = null; // model riêng của phiên đang mở (null = theo model toàn cục)
function renderChatModel() {
  const el = document.getElementById('chatmodel');
  if (!el) return;
  setText(el, chatModel || 'model: mặc định');
  const cls = 'modelchip' + (chatModel ? ' set' : '');
  if (el.className !== cls) el.className = cls;
}
function pickSessionModel() {
  if (!currentSid) return;
  const sid = currentSid;
  const box = document.createElement('div');
  box.className = 'flex flex-col gap-2';
  const hint = document.createElement('div');
  hint.className = 'text-[12px] text-[#7f8598] leading-relaxed';
  hint.textContent = 'Chỉ áp dụng cho phiên này. Chọn "Mặc định" để dùng lại model chung.';
  box.appendChild(hint);
  const apply = mv => {
    fetch('/api/model/' + sid, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: mv }),
    }).then(r => r.json()).then(r => {
      if (currentSid === sid) { chatModel = r.model || null; renderChatModel(); }
      const s = allSessions.find(x => x.sid === sid);
      if (s) s.model = r.model || null;
      closeOverlay();
      toast(r.model ? 'Phiên này dùng ' + r.model : 'Phiên này dùng model mặc định');
    }).catch(() => toast('Không đổi được model'));
  };
  const btns = MODELS.concat(['default']).map(mv => {
    const b = document.createElement('button');
    b.className = 'agybtn' + (chatModel === mv ? ' agybtn-on' : '');
    b.textContent = mv === 'default' ? 'Mặc định' : mv;
    b.onclick = () => apply(mv === 'default' ? '' : mv);
    return b;
  });
  const row = document.createElement('div');
  row.className = 'flex flex-wrap gap-2';
  btns.forEach(b => row.appendChild(b));
  box.appendChild(row);
  showOverlay('Model cho phiên này', box, [overlayButton('Đóng', closeOverlay)]);
}

/* ---- đính kèm ảnh: chọn -> thu nhỏ nếu quá lớn -> upload -> chèn đường dẫn vào prompt.
   Claude CLI đọc ảnh bằng tool Read nên chỉ cần đưa nó đường dẫn trên đĩa. ---- */
let attachments = []; // [{path, name, thumb}]

// Ảnh iPhone 12MP ~4-6MB, gửi thẳng thì nặng và chậm qua Tailscale -> thu nhỏ cạnh dài
// về 1600px, xuất JPEG chất lượng 0.85. Đủ nét để Claude đọc chữ trong ảnh chụp màn hình.
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('không đọc được file'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(fr.result); // định dạng lạ (HEIC…) -> gửi nguyên bản
      img.onload = () => {
        const MAX = 1600;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        if (scale === 1 && fr.result.length < 3e6) return resolve(fr.result);
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        try { resolve(cv.toDataURL('image/jpeg', 0.85)); } catch { resolve(fr.result); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

async function pickImage(input) {
  const file = input.files && input.files[0];
  input.value = ''; // reset để chọn lại đúng ảnh đó vẫn kích hoạt onchange
  if (!file) return;
  // dùng indexOf thay regex: dấu gạch chéo ngược trong template literal của server bị nuốt
  if (String(file.type || '').indexOf('image/') !== 0) return toast('Chỉ gửi được ảnh');
  toast('Đang xử lý ảnh…');
  let data;
  try { data = await shrinkImage(file); } catch { return toast('Không đọc được ảnh'); }
  const r = await fetch('/api/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  }).then(x => x.json()).catch(() => null);
  if (!r || !r.ok) return toast('Gửi ảnh lỗi: ' + ((r && r.error) || '?'));
  attachments.push({ path: r.path, name: file.name || r.name, thumb: data });
  renderAttachments();
  if (navigator.vibrate) navigator.vibrate(10);
}

function renderAttachments() {
  const bar = document.getElementById('attachbar');
  bar.innerHTML = '';
  bar.classList.toggle('hidden', !attachments.length);
  attachments.forEach((a, i) => {
    const chip = document.createElement('div');
    chip.className = 'attachchip';
    const im = document.createElement('img');
    im.src = a.thumb; im.alt = '';
    const nm = document.createElement('span');
    nm.className = 'axname';
    nm.textContent = a.name;
    const x = document.createElement('button');
    x.className = 'attachx';
    x.textContent = '✕';
    x.title = 'Bỏ ảnh này';
    x.onclick = () => { attachments.splice(i, 1); renderAttachments(); };
    chip.appendChild(im); chip.appendChild(nm); chip.appendChild(x);
    bar.appendChild(chip);
  });
}

// Ghép đường dẫn ảnh vào cuối prompt rồi xoá khay đính kèm
function consumeAttachments(text) {
  if (!attachments.length) return text;
  const NL = String.fromCharCode(10);
  const list = attachments.map(a => a.path).join(NL);
  attachments = [];
  renderAttachments();
  return (text ? text + NL + NL : '') + 'Ảnh đính kèm:' + NL + list;
}

/* ---- /cost: token đã dùng của phiên (đọc từ JSONL, không gọi CLI) ---- */
function showCost() {
  if (!currentSid) return toast('Mở 1 session trước rồi mới /cost');
  fetch('/api/history/' + currentSid).then(r => r.json()).then(r => {
    const u = r.usage;
    if (!u || !u.turns) return toast('Phiên này chưa có dữ liệu token');
    const box = document.createElement('div');
    box.className = 'flex flex-col gap-2 text-[13px]';
    const row = (k, v, dim) => {
      const d = document.createElement('div');
      d.className = 'flex justify-between gap-4' + (dim ? ' text-[#7f8598]' : '');
      const a = document.createElement('span'); a.textContent = k;
      const b = document.createElement('span'); b.className = 'tabular-nums'; b.textContent = v;
      d.appendChild(a); d.appendChild(b);
      return d;
    };
    // cache_read rẻ hơn nhiều so với input thường -> tách riêng cho khỏi hiểu nhầm
    box.appendChild(row('Số lượt', String(u.turns)));
    box.appendChild(row('Token gửi đi', shortNum(u.inTok)));
    box.appendChild(row('Token nhận về', shortNum(u.outTok)));
    box.appendChild(row('Đọc từ cache', shortNum(u.cacheRead), true));
    box.appendChild(row('Ghi vào cache', shortNum(u.cacheWrite), true));
    const note = document.createElement('div');
    note.className = 'text-[11.5px] text-[#7f8598] leading-relaxed mt-1 pt-2 border-t border-[#262a36]';
    note.textContent = 'Token đọc từ cache rẻ hơn nhiều so với token gửi mới, nên con số lớn ở dòng đó là bình thường.';
    box.appendChild(note);
    showOverlay('Token đã dùng — ' + (chatTitle || currentSid.slice(0, 8)), box,
      [overlayButton('Đóng', closeOverlay, true)]);
  }).catch(() => toast('Không đọc được dữ liệu token'));
}

/* ---- /compact: nhờ Claude tóm tắt ngữ cảnh khi hội thoại quá dài ---- */
function compactSession() {
  if (!currentSid) return toast('Mở 1 session trước rồi mới /compact');
  fetch('/api/chat/' + currentSid, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '/compact' }),
  }).then(r => r.json()).then(r => {
    if (r.ok) { toast('Đang dọn ngữ cảnh…'); refreshChat(); }
    else toast('Lỗi: ' + (r.error || '?'));
  }).catch(() => toast('Không chạy được /compact'));
}

/* ---- dừng Claude giữa chừng (nút ⏹, /stop, hoặc Esc khi đang chạy).
   Uỷ quyền cho stopChat() — bản đó cập nhật cả trạng thái nút gửi. ---- */
function stopCurrent() {
  if (!currentSid) return;
  if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
  stopChat();
}

/* ---- duyệt kế hoạch: chạy tiếp lượt đang chờ, lần này cho phép sửa file ---- */
function approvePlan() {
  if (!currentSid) return;
  const sid = currentSid;
  const ap = document.getElementById('chatapprove');
  ap.classList.add('hidden'); // ẩn ngay cho khỏi bấm 2 lần
  fetch('/api/approve/' + sid, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }).then(r => r.json()).then(r => {
    if (r.ok) { toast('Đã duyệt — Claude đang thực hiện'); refreshChat(); }
    else { toast('Không duyệt được: ' + (r.error || '?')); ap.classList.remove('hidden'); }
  }).catch(() => { toast('Không duyệt được'); ap.classList.remove('hidden'); });
}

/* ---- đổi tên phiên: lưu riêng ở dashboard, KHÔNG sửa .jsonl của Claude CLI ---- */
let chatTitle = '';
function renameSession() {
  if (!currentSid) return;
  const box = document.createElement('div');
  box.className = 'flex flex-col gap-2';
  const inp = document.createElement('input');
  inp.className = 'w-full bg-[#1a1d27] border border-[#262a36] rounded-xl px-3 py-2.5 text-[16px] outline-none';
  inp.value = chatTitle || '';
  inp.placeholder = 'Tên phiên…';
  const hint = document.createElement('div');
  hint.className = 'text-[11.5px] text-[#666b7d]';
  hint.textContent = 'Để trống rồi Lưu = quay về tên Claude CLI tự đặt.';
  box.appendChild(inp);
  box.appendChild(hint);
  const save = () => {
    const sid = currentSid;
    fetch('/api/title/' + sid, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: inp.value }),
    }).then(r => r.json()).then(r => {
      if (currentSid === sid) {
        chatTitle = r.title || '';
        setText(document.getElementById('chatsid'), chatTitle || sid.slice(0, 8));
      }
      const row = document.querySelector('#sessrows .srow[data-sid="' + sid + '"] .s-sid');
      if (row) setText(row, r.title || sid.slice(0, 8));
      const s = allSessions.find(x => x.sid === sid);
      if (s) s.title = r.title || ''; // giữ đồng bộ để SSE tick sau không ghi đè ngược
      closeOverlay();
      toast(r.title ? 'Đã đổi tên phiên' : 'Đã bỏ tên tự đặt');
    }).catch(() => toast('Đổi tên thất bại'));
  };
  inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  showOverlay('Đổi tên phiên', box, [overlayButton('Hủy', closeOverlay), overlayButton('Lưu', save, true)]);
  setTimeout(() => { inp.focus(); inp.select(); }, 50);
}

/* Nút gửi hoá thành nút DỪNG khi Claude đang chạy — tương đương Esc trong Claude CLI.
   Trước đây đang chạy mà bấm gửi thì server trả 409 "session is busy", không có cách nào
   ngắt ngoài nút thùng rác (nhìn như xoá phiên, chẳng ai dám bấm). */
let chatRunning = false;
function setChatRunning(on) {
  if (chatRunning === on) return;
  chatRunning = on;
  const b = document.getElementById('chatsendbtn');
  if (!b) return;
  b.classList.toggle('stopbtn', on);
  b.classList.toggle('sendgrad', !on);
  b.innerHTML = on ? ICON_STOP : ICON_SEND;
  b.title = on ? 'Dừng Claude (đang chạy)' : 'Gửi';
  b.setAttribute('aria-label', b.title);
}

function submitChat() {
  if (chatRunning) return stopChat();
  const inp = document.getElementById('chatinput');
  const v = inp.value.trim();
  // có ảnh đính kèm thì gửi được dù chưa gõ chữ nào
  if ((!v && !attachments.length) || !currentSid) return;
  if (v) histPush('hist:chat', v);
  inp.value = '';
  scrollChatsToEnd(); // tin mới gửi phải visible ngay, kể cả khi bàn phím đang bật
  if (v && v[0] === '/') return routeSlash(v);
  const msg = consumeAttachments(v); // ghép đường dẫn ảnh vào cuối prompt
  fetch('/api/chat/' + currentSid, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg }),
  }).then(r => r.json())
    .then(r => {
      // 409 session busy / lỗi khác: trả lại tin nhắn vào input, không mất im lặng
      if (r && r.error) { inp.value = v; toast('Không gửi được: ' + r.error); }
      refreshChat();
    })
    .catch(e => { inp.value = v; toast('Lỗi mạng: ' + e.message); });
}
function stopChat() {
  if (!currentSid) return;
  const sid = currentSid;
  fetch('/api/kill/' + sid, { method: 'POST' })
    .then(r => r.json())
    .then(r => {
      if (r && r.error) return toast('Không dừng được: ' + r.error);
      toast('Đã dừng Claude');
      setChatRunning(false);
      refreshChat();
    })
    .catch(e => toast('Lỗi mạng: ' + e.message));
}
document.getElementById('chatinput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) submitChat(); });
document.getElementById('chatsendbtn').addEventListener('click', submitChat);
document.getElementById('chatsendbtn').innerHTML = ICON_SEND; // trạng thái ban đầu: gửi
