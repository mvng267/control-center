/* Test cho TÊN DỰ ÁN + hiệu năng danh sách phiên — kiểm ở mức server, không cần trình duyệt.

   Vì sao có file này: trước đợt sửa, tên dự án được SUY từ tên thư mục
   ~/.claude/projects (cắt 2 đoạn cuối nối bằng "/"), cho ra "agy/proxy",
   "perfume/com" (mất đoạn đầu), "plastic/", "6debb715b13d/scratchpad".
   Sai trên 14/20 thư mục mà KHÔNG một bài test nào phủ trường project — nên lỗi
   sống suốt. Mỗi bài dưới đây bọc đúng một cách sai đã đo được thật.

   Cách chạy:  node tests/du-an.js
               DASH_URL=http://localhost:7871/ node tests/du-an.js
*/
const fs = require('fs');
const path = require('path');
const os = require('os');

const URL = (process.env.DASH_URL || 'http://localhost:7799/').replace(/\/$/, '');
const TOKEN_FILE = path.join(os.homedir(), '.claude', 'dashboard-token.json');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const token = (() => {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token || ''; } catch { return ''; }
})();

const results = [];
const ok = (name, pass, extra) => {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
};

// /stream là SSE: đọc tới khối "data: …\n\n" đầu tiên rồi ngắt, không chờ hết đời.
async function snapshot() {
  const t0 = Date.now();
  const r = await fetch(URL + '/stream', { headers: { 'X-Dash-Token': token } });
  const rd = r.body.getReader();
  let buf = '';
  while (!buf.includes('\n\n')) {
    const { value, done } = await rd.read();
    if (done) break;
    buf += new TextDecoder().decode(value);
  }
  rd.cancel().catch(() => {});
  return { ms: Date.now() - t0, data: JSON.parse(buf.slice(6, buf.indexOf('\n\n'))) };
}

(async () => {
  if (!token) { console.error('Không đọc được dashboard-token.json'); process.exit(2); }

  /* ---------- Bài quan trọng nhất: KHÔNG chặn event loop ----------
     Phải chạy TRƯỚC mọi bài khác, lúc cache của server còn lạnh — chạy sau thì
     listSessions() đã ấm và bài này luôn xanh dù lỗi có quay lại.

     listSessions() đọc + parse toàn bộ .jsonl (453MB trên máy này). Trước khi sửa,
     nó chạy đồng bộ trong tay xử lý request nên chặn CẢ event loop: đo được
     /api/passcode/status (API rỗng) mất 3.173ms mới trả lời — tức là ~3 giây đầu
     sau khi khởi động, MỌI request khác đều đứng.

     Bài này cũng bọc luôn phần ĐỌC THÊM: nhả nhịp chèn được GIỮA các phiên nhưng
     không cắt được BÊN TRONG một file, nên nếu quay lại lối parse-lại-toàn-bộ thì
     hai phiên đang chạy (89MB + 80MB) làm mỗi nhịp SSE tốn ~700ms và bài này đỏ.
     Đo sau khi sửa: 3ms dù server đã chạy lâu với 169MB file đang ghi. */
  {
    const p = snapshot();                       // không await: để nó chạy nền
    await new Promise((r) => setTimeout(r, 50));
    const t = Date.now();
    await fetch(URL + '/api/passcode/status', { headers: { 'X-Dash-Token': token } }).then((r) => r.text());
    const nhe = Date.now() - t;
    ok('API nhẹ không bị /stream chặn (trước: 3173ms)', nhe < 300, nhe + 'ms');
    await p;
  }

  const s1 = await snapshot();
  const ss = s1.data.sessions;

  ok('mọi phiên đều có trường duAn', ss.length > 0 && ss.every((s) => s.duAn),
    ss.filter((s) => !s.duAn).length + ' phiên thiếu');

  /* Tên dự án là BASENAME của cwd, nên không bao giờ chứa "/".
     Chặn tái phát "agy/proxy", "thong/plastic", "plastic/". */
  {
    const xau = ss.filter((s) => (s.duAn?.ten || '').includes('/'));
    ok('không tên dự án nào chứa "/" (chặn "agy/proxy")', xau.length === 0,
      xau.slice(0, 3).map((s) => s.duAn.ten).join(', '));
  }

  // Chặn rò UUID ra giao diện: "6debb715b13d/scratchpad" từng là một mục lọc.
  {
    const xau = ss.filter((s) => /^[0-9a-f]{8,}$/i.test(s.duAn?.ten || ''));
    ok('không tên dự án nào là chuỗi hex dài (chặn rò UUID)', xau.length === 0,
      xau.slice(0, 3).map((s) => s.duAn.ten).join(', '));
  }

  /* Với phiên thư mục còn tồn tại, tên phải BẰNG ĐÚNG basename của đường dẫn.
     Chặn kiểu sai "mất chữ": tên có dấu chấm a.b.com -> "b/com",
     tên có dấu cách "Van thong plastic" -> "thong/plastic". */
  {
    // duongDan đã rút gọn $HOME thành "~" để hiện lên màn hình -> bung lại trước khi so,
    // nếu không phiên chạy ngay tại home có duongDan="~" và basename ra "~".
    // So với khoa (cwd đã chuẩn hoá), KHÔNG với duongDan: duongDan giữ nguyên đường
    // dẫn thật để hiện ra, kể cả bản gõ nhầm ".../Van thong plastic " có dấu cách cuối.
    const con = ss.filter((s) => s.duAn?.conTonTai && s.duAn.khoa?.startsWith('/'));
    const sai = con.filter((s) => path.basename(s.duAn.khoa) !== s.duAn.ten);
    ok('tên dự án = basename của cwd (chặn kiểu sai "mất chữ đầu")', sai.length === 0,
      sai.slice(0, 3).map((s) => s.duAn.ten + ' != ' + s.duAn.khoa).join(' ; '));
  }

  /* project (chuỗi, cho giao diện cũ web/legacy) phải bằng duAn.ten.
     Giữ hai trường đồng bộ: legacy đọc project làm khoá gom donut, lệch là donut sai. */
  {
    const lech = ss.filter((s) => s.duAn && s.project !== s.duAn.ten);
    ok('project (legacy) đồng bộ với duAn.ten', lech.length === 0, lech.length + ' phiên lệch');
  }

  /* Số dự án riêng biệt PHẢI ÍT HƠN số thư mục trong ~/.claude/projects.
     Chứng minh đã hợp nhất: ".../Van thong plastic" và ".../Van thong plastic "
     (thư mục rỗng do gõ nhầm, macOS cho phép tên kết thúc bằng dấu cách) là hai
     thư mục thật trên đĩa nhưng CÙNG một dự án. */
  {
    let soThuMuc = 0;
    try {
      soThuMuc = fs.readdirSync(PROJECTS_DIR)
        .filter((d) => { try { return fs.statSync(path.join(PROJECTS_DIR, d)).isDirectory(); } catch { return false; } })
        .length;
    } catch {}
    const soKhoa = new Set(ss.map((s) => s.duAn?.khoa)).size;
    ok('số dự án ít hơn số thư mục (đã hợp nhất bản gõ nhầm)', soKhoa < soThuMuc,
      soKhoa + ' dự án / ' + soThuMuc + ' thư mục');
  }

  // Trần 100 cắt âm thầm 33 phiên, không báo gì. Bỏ qua nếu máy có ít phiên.
  {
    let soFile = 0;
    try {
      for (const d of fs.readdirSync(PROJECTS_DIR)) {
        const dir = path.join(PROJECTS_DIR, d);
        try {
          if (!fs.statSync(dir).isDirectory()) continue;
          soFile += fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).length;
        } catch {}
      }
    } catch {}
    if (soFile <= 100) console.log('SKIP | trần 100 (máy chỉ có ' + soFile + ' phiên)');
    else ok('không cắt trần 100 phiên', ss.length > 100, ss.length + '/' + soFile + ' phiên');
  }

  /* laNhap nhận diện bằng TIỀN TỐ đường dẫn, không phải includes('scratchpad')
     (một dự án thật tên ~/project/scratchpad sẽ bị xếp nhầm). */
  {
    const sai = ss.filter((s) => {
      const p = s.duAn?.duongDan || '';
      const nhap = p.startsWith('/private/tmp/claude-') || p.startsWith('/tmp/claude-');
      return !!s.duAn && s.duAn.laNhap !== nhap;
    });
    ok('laNhap đúng cho cả hai phía (tmp và không tmp)', sai.length === 0,
      sai.slice(0, 3).map((s) => s.duAn.duongDan).join(' ; '));
  }

  // conTonTai phải khớp thực tế trên đĩa — đây là thứ quyết định có cảnh báo
  // "thư mục đã xoá" hay không, mà nhắn vào phiên đó thì tin rơi vào hư không.
  {
    const sai = ss.filter((s) => s.duAn?.duongDan
      && s.duAn.duongDan.startsWith('/')
      && s.duAn.conTonTai !== fs.existsSync(s.duAn.duongDan));
    ok('conTonTai khớp thực tế trên đĩa', sai.length === 0, sai.length + ' phiên sai');
  }

  /* Repo git đọc ở NỀN: snapshot đầu có thể chưa có, vài trăm ms sau phải có.
     Đồng thời kiểm bẫy thư mục con: `git -C agy-proxy/web remote get-url origin`
     trả về repo của THƯ MỤC CHA, nên phải so rev-parse --show-toplevel với cwd. */
  {
    await new Promise((r) => setTimeout(r, 1500));
    const s2 = await snapshot();
    const coRepo = s2.data.sessions.filter((s) => s.duAn?.repo).length;
    ok('cache git nạp được ở nền', coRepo > 0, coRepo + ' phiên có repo');

    const xau = s2.data.sessions.filter((s) => s.duAn?.repo && !/^[^/]+\/[^/]+$/.test(s.duAn.repo));
    ok('repo đúng dạng chủ/tên', xau.length === 0,
      xau.slice(0, 3).map((s) => s.duAn.repo).join(', '));

    /* Thư mục con của một repo KHÔNG được gán repo của cha.
       Đo thật: `git -C agy-proxy/web remote get-url origin` trả về repo của agy-proxy.
       Kiểm bằng chính phép so mà server dùng: gốc repo phải TRÙNG cwd.
       So theo khoa (cwd đã chuẩn hoá bỏ dấu cách cuối), không theo duongDan: bản gõ
       nhầm ".../Van thong plastic " dùng chung repo với bản đúng là CỐ Ý. */
    const { execFileSync } = require('child_process');
    const gocRepo = (p) => {
      try { return execFileSync('git', ['-C', p, 'rev-parse', '--show-toplevel'], { timeout: 3000 }).toString().trim(); }
      catch { return ''; }
    };
    const daXet = new Set();
    const con = s2.data.sessions.filter((s) => {
      if (!s.duAn?.repo || !s.duAn.conTonTai || daXet.has(s.duAn.khoa)) return false;
      daXet.add(s.duAn.khoa);
      const goc = gocRepo(s.duAn.khoa);
      return !goc || path.resolve(goc) !== path.resolve(s.duAn.khoa);
    });
    ok('thư mục con không bị gán nhầm repo của cha', con.length === 0,
      con.slice(0, 3).map((s) => s.duAn.khoa + ' -> ' + s.duAn.repo).join(' ; '));

    ok('cache ăn: lần gọi sau nhanh hơn nhiều', s2.ms < 200, s1.ms + 'ms -> ' + s2.ms + 'ms');
  }

  /* Model + mức nghĩ đọc từ chính .jsonl (dòng assistant mới nhất), không phải từ
     dashboard-models.json — file đó chỉ có một mục rác test, không ứng với phiên nào. */
  {
    /* Chỉ tính phiên ĐÃ CÓ LƯỢT TRẢ LỜI. Model nằm ở dòng assistant, nên phiên mở ra
       rồi đóng ngay (chưa hỏi gì) không thể có model — đếm cả chúng là đo sai.
       Đo thật: 121/236 phiên không có model, TẤT CẢ đều là file 2-3KB tức chưa có lượt
       nào. Bài này từng đỏ oan vì tỷ lệ phiên rỗng tăng dần theo thời gian: mỗi lần mở
       nhầm một thư mục là thêm một file rỗng, kéo mẫu số lên mà không thêm mẫu số thật. */
    const coLuot = ss.filter((s) => (s.luot || 0) > 0);
    const coModel = coLuot.filter((s) => s.model).length;
    ok('lấy được model từ .jsonl', coModel > coLuot.length * 0.9,
      coModel + '/' + coLuot.length + ' phiên đã có lượt (bỏ qua ' + (ss.length - coLuot.length) + ' phiên rỗng)');
  }

  /* ---------- ĐỌC THÊM: hai nhánh, kiểm bằng phiên giả tự dựng ----------
     Không thể chờ người dùng gõ để phiên thật dài ra, nên tự tạo một phiên trong
     ~/.claude/projects rồi nối/ghi đè để ép đúng hai nhánh. Dọn sạch ở cuối. */
  {
    const dir = path.join(PROJECTS_DIR, '-private-tmp-inc-check');
    const sid = '11111111-2222-4333-8444-666666666666';
    const f = path.join(dir, sid + '.jsonl');
    const dong = (i, chu) => JSON.stringify({
      type: 'assistant', timestamp: new Date(1786500000000 + i * 1000).toISOString(),
      cwd: '/private/tmp/inc-check',
      message: { model: 'claude-opus-5', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: chu + i }] },
      effort: 'high',
    }) + '\n';
    const lay = async () => (await snapshot()).data.sessions.find((s) => s.sid === sid);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(f, Array.from({ length: 20 }, (_, i) => dong(i, 'dòng ')).join(''));
      await new Promise((r) => setTimeout(r, 200));
      const a = await lay();
      ok('phiên giả đọc được', !!a && a.msgs === 20, a ? a.msgs + ' tin' : 'không thấy');

      // nhánh 1: NỐI ĐUÔI -> chỉ đọc phần mới, số phải cộng thêm đúng
      fs.appendFileSync(f, dong(999, 'dòng '));
      await new Promise((r) => setTimeout(r, 200));
      const b = await lay();
      ok('đọc thêm khi nối đuôi: +1 tin, +15 token, +1 lượt',
        !!b && b.msgs === 21 && b.tok === (a?.tok || 0) + 15 && b.luot === (a?.luot || 0) + 1,
        b ? `${b.msgs} tin / ${b.tok} tok / ${b.luot} lượt` : 'không thấy');

      /* nhánh 2: GHI ĐÈ bằng nội dung khác nhưng DÀI HƠN — cái bẫy thật sự.
         Chỉ so kích thước thì tưởng là nối đuôi và sẽ ghép nhầm phần mới vào
         trạng thái cũ, cho ra số liệu SAI mà không ném lỗi nào. */
      fs.writeFileSync(f, Array.from({ length: 40 }, (_, i) => dong(i, 'GHI DE ')).join(''));
      await new Promise((r) => setTimeout(r, 200));
      const c = await lay();
      ok('phát hiện ghi đè, parse lại toàn bộ (không nối nhầm)',
        !!c && c.msgs === 40 && c.tok === 600 && c.luot === 40,
        c ? `${c.msgs} tin / ${c.tok} tok (đúng phải là 40 / 600)` : 'không thấy');

      /* nhánh 3: CẮT GIỮA MỘT KÝ TỰ TIẾNG VIỆT — lỗi hỏng IM LẶNG.
         Đọc thêm cắt theo BYTE, mà chữ có dấu chiếm 2-3 byte. Nếu đoạn đuôi được
         decode bằng `buf.toString('utf8')` thì ký tự bị chẻ đôi thành "�":
           "xin chào"  ->  "xin ch<?><?>o"
         Tệ ở chỗ JSON.parse VẪN CHẠY (chuỗi vẫn hợp lệ), nên tin nhắn hiện ra với
         chữ sai mà không có lỗi nào — không cách nào biết trừ khi đọc kỹ.
         Ép đúng tình huống: ghi nửa dòng, đợi server đọc, rồi ghi nốt nửa sau.
         Điểm cắt nằm GIỮA hai byte của chữ "à". */
      const cauViet = JSON.stringify({
        type: 'assistant', timestamp: new Date(1786600000000).toISOString(),
        cwd: '/private/tmp/inc-check',
        message: { model: 'claude-opus-5', usage: { input_tokens: 0, output_tokens: 0 },
          content: [{ type: 'text', text: 'xin chào thế giới' }] },
      }) + '\n';
      const bufViet = Buffer.from(cauViet, 'utf8');
      const cat = bufViet.indexOf(0xC3) + 1;   // ngay SAU byte đầu của một ký tự 2 byte

      fs.writeFileSync(f, Array.from({ length: 40 }, (_, i) => dong(i, 'GHI DE ')).join(''));
      await new Promise((r) => setTimeout(r, 250));
      await lay();                              // để server cache mốc hiện tại
      fs.appendFileSync(f, bufViet.subarray(0, cat));   // nửa đầu, đứt giữa ký tự
      await new Promise((r) => setTimeout(r, 250));
      await lay();                              // server đọc phần dở -> chỗ dễ hỏng
      fs.appendFileSync(f, bufViet.subarray(cat));      // nửa sau
      await new Promise((r) => setTimeout(r, 250));
      const d = await lay();
      const chuCuoi = (d && d.tinCuoi) || '';
      ok('chữ tiếng Việt bị cắt giữa ký tự vẫn ghép đúng (không ra "�")',
        chuCuoi.includes('xin chào thế giới') && !chuCuoi.includes('�'),
        JSON.stringify(chuCuoi.slice(0, 40)));
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }

  /* ---------- Agent con: trạng thái đọc từ .jsonl ----------
     Claude phóng subagent rồi NGỒI CHỜ. Suốt lúc đó phiên nhìn như đã dừng: lượt
     chính không có tool nào chạy nên dải "đang chạy" trống. Đo trên 155 file thật:
     128 lần gọi Task, agent chạy trung vị 3,9 phút, dài nhất 13,5.

     Cái bẫy chính: tool_result của Task về NGAY lúc phóng với nội dung "Async agent
     launched successfully" — nên "đã có tool_result" KHÔNG có nghĩa là agent xong.
     Đo được 83/83 lần gọi đều có tool_result trong khi phần lớn mới vừa khởi động.
     Trạng thái thật nằm ở dòng queue-operation kèm <task-notification>. */
  {
    const dir = path.join(PROJECTS_DIR, '-private-tmp-agent-check');
    const sid = '77777777-8888-4999-8aaa-bbbbbbbbbbbb';
    const f = path.join(dir, sid + '.jsonl');
    const lay = async () => (await snapshot()).data.sessions.find((s) => s.sid === sid);
    const lich = () => fetch(URL + '/api/history/' + sid,
      { headers: { 'X-Dash-Token': token } }).then((r) => r.json());

    // dòng phóng một agent; ts truyền vào để ép nhánh "đang chạy" vs "đứt"
    const dongPhong = (id, ten, ts) => JSON.stringify({
      type: 'assistant', timestamp: new Date(ts).toISOString(),
      cwd: '/private/tmp/agent-check',
      message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'tool_use', id, name: 'Task',
          input: { description: ten, subagent_type: 'Explore', run_in_background: true } }] },
    }) + '\n';
    // tool_result "đã phóng" — về ngay, KHÔNG phải kết quả
    const dongPhongXong = (id, ts) => JSON.stringify({
      type: 'user', timestamp: new Date(ts + 500).toISOString(),
      cwd: '/private/tmp/agent-check',
      message: { content: [{ type: 'tool_result', tool_use_id: id,
        content: [{ type: 'text', text: 'Async agent launched successfully.' }] }] },
    }) + '\n';
    // notification báo xong thật
    const dongNoti = (id, tt, tom, ts) => JSON.stringify({
      type: 'queue-operation', operation: 'enqueue',
      timestamp: new Date(ts).toISOString(), sessionId: sid,
      content: `<task-notification>\n<task-id>x1</task-id>\n<tool-use-id>${id}</tool-use-id>\n`
        + `<status>${tt}</status>\n<summary>${tom}</summary>\n</task-notification>`,
    }) + '\n';

    try {
      fs.mkdirSync(dir, { recursive: true });
      const gio = Date.now();

      // nhánh 1: vừa phóng, CHƯA có notification -> đang chạy
      fs.writeFileSync(f, dongPhong('toolu_a1', 'Rà soát mã', gio - 60000)
        + dongPhongXong('toolu_a1', gio - 60000));
      await new Promise((r) => setTimeout(r, 250));
      const a = await lay();
      ok('agent vừa phóng -> đếm là ĐANG CHẠY (dù tool_result đã về)',
        !!a && a.agentChay === 1, a ? a.agentChay + ' agent' : 'không thấy phiên');
      ok('SSE gửi kèm tên agent đang chạy',
        !!a && Array.isArray(a.agentTen) && a.agentTen[0] === 'Rà soát mã',
        a ? JSON.stringify(a.agentTen) : '—');

      // nhánh 2: notification về -> hết đang chạy, giữ trạng thái thật
      fs.appendFileSync(f, dongNoti('toolu_a1', 'completed', 'Xong việc rà soát', gio - 30000));
      await new Promise((r) => setTimeout(r, 250));
      const b = await lay();
      ok('có task-notification -> KHÔNG còn tính là đang chạy',
        !!b && b.agentChay === 0, b ? b.agentChay + ' agent' : 'không thấy');
      const h = await lich();
      const ag = (h.agents || [])[0];
      ok('/api/history trả trạng thái + tóm tắt thật của agent',
        !!ag && ag.trangThai === 'completed' && /Xong việc/.test(ag.tomTat || ''),
        ag ? ag.trangThai + ' | ' + (ag.tomTat || '').slice(0, 30) : 'không có agent');

      /* nhánh 3: trạng thái LỖI phải giữ nguyên, không quy về "xong".
         Đo trên dữ liệu thật: ngoài completed(237) còn failed(23), stopped(15),
         killed(6) — gộp hết thành "xong" là giấu mất agent chết. */
      fs.appendFileSync(f, dongPhong('toolu_a2', 'Việc hỏng', gio - 50000)
        + dongNoti('toolu_a2', 'failed', 'Agent chết giữa chừng', gio - 20000));
      await new Promise((r) => setTimeout(r, 250));
      const h2 = await lich();
      const loi = (h2.agents || []).find((x) => x.ten === 'Việc hỏng');
      ok('agent lỗi giữ nguyên trạng thái "failed", không quy về xong',
        !!loi && loi.trangThai === 'failed', loi ? loi.trangThai : 'không thấy');

      /* nhánh 4: agent MỒ CÔI — phóng rồi phiên chết, notification không bao giờ về.
         Đo thật: 29 agent kiểu này trên máy, TẤT CẢ già hơn 24 giờ, 0 cái trẻ hơn 1
         giờ. Không có ngưỡng thì dashboard hiện "đang chạy" suốt nhiều ngày.
         Ngưỡng 30 phút = gấp hơn 2 lần agent lâu nhất từng đo (13,5 phút). */
      fs.appendFileSync(f, dongPhong('toolu_a3', 'Agent bỏ quên', gio - 3 * 3600 * 1000));
      await new Promise((r) => setTimeout(r, 250));
      const c = await lay();
      ok('agent quá 30 phút chưa báo -> coi là ĐỨT, không đếm là đang chạy',
        !!c && c.agentChay === 0, c ? c.agentChay + ' agent đang chạy' : 'không thấy');
      const h3 = await lich();
      const mc = (h3.agents || []).find((x) => x.ten === 'Agent bỏ quên');
      ok('agent mồ côi được đánh dấu "dut" để phân biệt với đang chạy',
        !!mc && mc.trangThai === 'dut', mc ? mc.trangThai : 'không thấy');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }

  /* ---------- Phiên do LỆNH SLASH sinh ra phải bị ẩn ----------
     Claude CLI tạo một file .jsonl MỚI cho mỗi lần chạy `claude -p /lenh`. Dashboard
     lại gọi chính CLI để lấy hạn mức và chạy lệnh trong bảng lệnh — nên nó tự đẻ rác
     cho chính mình. Đếm thật: 265/410 phiên là loại này, riêng `/usage` 183 cái.
     Không lọc thì danh sách 70% là rác và phiên thật trôi mất. */
  {
    const dir = path.join(PROJECTS_DIR, '-private-tmp-lenh-check');
    const sidLenh = 'bbbbbbbb-1111-4222-8333-cccccccccccc';
    const sidThat = 'bbbbbbbb-1111-4222-8333-dddddddddddd';
    const gio = Date.now();
    const dongUser = (t, chu) => JSON.stringify({
      type: 'user', timestamp: new Date(gio - t).toISOString(),
      cwd: '/private/tmp/lenh-check',
      message: { content: [{ type: 'text', text: chu }] },
    }) + '\n';
    const dongTraLoi = (t, chu) => JSON.stringify({
      type: 'assistant', timestamp: new Date(gio - t).toISOString(),
      cwd: '/private/tmp/lenh-check',
      message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: chu }] },
    }) + '\n';

    try {
      fs.mkdirSync(dir, { recursive: true });
      // phiên RÁC: đúng một lệnh slash rồi thôi — hệt thứ CLI đẻ ra khi dashboard gọi
      fs.writeFileSync(path.join(dir, sidLenh + '.jsonl'),
        dongUser(3000, '<command-name>/usage</command-name>')
        + dongTraLoi(2000, 'Current week (all models): 44% used'));
      /* phiên THẬT mở bằng lệnh slash rồi nhắn tiếp bình thường — PHẢI hiện.
         Đây là chỗ dễ lọc nhầm nhất: chỉ dò `<command-name>` mà không đếm độ dài thì
         giấu luôn phiên người dùng đang làm việc. */
      fs.writeFileSync(path.join(dir, sidThat + '.jsonl'),
        dongUser(9000, '<command-name>/init</command-name>')
        + dongTraLoi(8000, 'Đã tạo CLAUDE.md')
        + dongUser(7000, 'sửa thêm phần kiểm thử giúp tao')
        + dongTraLoi(6000, 'Xong rồi nhé')
        + dongUser(5000, 'chạy test luôn')
        + dongTraLoi(4000, 'Tất cả đều đạt'));
      await new Promise((r) => setTimeout(r, 300));

      const ds = (await snapshot()).data.sessions || [];
      ok('phiên chỉ có MỘT lệnh slash bị ẩn khỏi danh sách',
        !ds.find((s) => s.sid === sidLenh), 'sid rác ' + (ds.find((s) => s.sid === sidLenh) ? 'VẪN HIỆN' : 'đã ẩn'));
      ok('phiên mở bằng lệnh slash rồi nhắn tiếp vẫn HIỆN',
        !!ds.find((s) => s.sid === sidThat), 'sid thật ' + (ds.find((s) => s.sid === sidThat) ? 'hiện' : 'BỊ ẨN OAN'));
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }

  /* ---------- DUYỆT lệnh bị chặn quyền ----------
     Dashboard chạy `claude -p` với stdio ignore nên CLI không hỏi quyền được, và bản
     CLI này cũng không có `--permission-prompt-tool`. Cách đi vòng: đọc lỗi đã xảy ra,
     hỏi người dùng, rồi ghi luật vào `.claude/settings.local.json` của chính dự án —
     đúng file mà CLI đọc. Lượt đầu vẫn hỏng nhưng không phải rời dashboard. */
  {
    const cwd = '/private/tmp/duyet-check';
    const dir = path.join(PROJECTS_DIR, '-private-tmp-duyet-check');
    const sid = '66666666-7777-4888-8999-aaaaaaaaaaaa';
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    const ts = (n) => new Date(Date.now() - n * 1000).toISOString();
    fs.writeFileSync(path.join(dir, sid + '.jsonl'), [
      { type: 'user', timestamp: ts(60), cwd, message: { role: 'user', content: 'liệt kê site' } },
      { type: 'assistant', timestamp: ts(50), cwd, message: {
        model: 'claude-opus-5', usage: { input_tokens: 5, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'q1', name: 'Bash',
          input: { command: 'ls -d /www/wwwroot/*/', description: 'List sites' } }] } },
      { type: 'user', timestamp: ts(45), cwd, message: { role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'q1', is_error: true,
          content: 'This command requires approval' }] } },
    ].map((d) => JSON.stringify(d)).join('\n') + '\n');

    const H = { 'X-Dash-Token': token, 'Content-Type': 'application/json' };
    const h = await fetch(URL + '/api/history/' + sid, { headers: H }).then((r) => r.json());

    ok('phát hiện lệnh bị chặn quyền ở lượt cuối',
      !!h.chanQuyen && /requires approval/i.test(h.chanQuyen.loi || ''),
      JSON.stringify(h.chanQuyen));

    /* Luật phải suy từ CÂU LỆNH THẬT, không phải `description`. Bản đầu dùng
       `p.summary` nên ra `Bash(List sites:*)` — vừa không khớp lệnh nào, vừa mở quyền
       cho một chuỗi vô nghĩa. */
    ok('trả về câu lệnh thật, không phải mô tả',
      h.chanQuyen?.lenh === 'ls -d /www/wwwroot/*/',
      'lenh=' + (h.chanQuyen?.lenh || '') + ' moTa=' + (h.chanQuyen?.moTa || ''));

    const d = await fetch(URL + '/api/duyet-quyen/' + sid, { method: 'POST', headers: H, body: '{}' })
      .then((r) => r.json());
    ok('duyệt xong ghi luật vào settings.local.json của DỰ ÁN',
      d.ok === true && d.luat === 'Bash(ls -d:*)' && d.duAn === cwd, JSON.stringify(d));

    const luat = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'settings.local.json'), 'utf8'));
    ok('file luật đúng cấu trúc CLI đọc được',
      Array.isArray(luat.permissions?.allow) && luat.permissions.allow.includes('Bash(ls -d:*)'),
      JSON.stringify(luat).slice(0, 90));

    // duyệt lại cùng lệnh không được sinh bản trùng
    const d2 = await fetch(URL + '/api/duyet-quyen/' + sid, { method: 'POST', headers: H, body: '{}' })
      .then((r) => r.json());
    ok('duyệt hai lần không sinh luật trùng', d2.trung === true && d2.tong === d.tong,
      JSON.stringify(d2));

    /* Luật do client gửi lên phải bị KIỂM: đây là thứ mở quyền chạy lệnh, nhận chuỗi
       tuỳ ý thì ai gọi được API cũng ghi được gì vào file quyền cũng được. */
    const xau = await fetch(URL + '/api/duyet-quyen/' + sid, { method: 'POST', headers: H,
      body: JSON.stringify({ luat: 'rm -rf /' }) });
    ok('từ chối luật sai định dạng', xau.status === 400, 'HTTP ' + xau.status);

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }

  /* ---------- Ẩn phiên khỏi danh sách ----------
     Đo trên máy này: 12/145 phiên (8%) có thư mục gốc không còn — nhắn vào rơi vào hư
     không mà vẫn chiếm chỗ. Cộng 17 phiên nháp trong /tmp.
     KHÔNG xoá .jsonl (dữ liệu gốc của CLI, CLAUDE.md cấm đụng): chỉ giấu, có đường
     bật lại. */
  {
    const sid = 'an-test-' + Date.now();
    const dat = (bat) => fetch(URL + '/api/an/' + sid, {
      method: 'POST', headers: { 'X-Dash-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bat }),
    }).then((r) => r.json());

    const a = await dat(true);
    ok('ẩn được phiên', a.ok === true && a.an === true, JSON.stringify(a));

    const b = await dat(true);
    ok('ẩn hai lần không sinh bản trùng', b.tong === a.tong, `${a.tong} -> ${b.tong}`);

    const c = await dat(false);
    ok('bỏ ẩn được', c.ok === true && c.an === false && c.tong === a.tong - 1, JSON.stringify(c));

    /* File .jsonl phải NGUYÊN VẸN sau khi ẩn — đây là điều quan trọng nhất của tính
       năng này. Ẩn mà lỡ tay xoá dữ liệu gốc thì không có đường lùi. */
    const dir = path.join(PROJECTS_DIR, '-private-tmp-an-check');
    const sid2 = '88888888-2222-4333-8444-555555555555';
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, sid2 + '.jsonl');
    fs.writeFileSync(f, JSON.stringify({
      type: 'user', timestamp: new Date().toISOString(),
      cwd: '/private/tmp/an-check', message: { role: 'user', content: 'giữ nguyên tôi' },
    }) + '\n');
    const truoc = fs.readFileSync(f, 'utf8');
    await fetch(URL + '/api/an/' + sid2, {
      method: 'POST', headers: { 'X-Dash-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bat: true }),
    });
    ok('ẩn KHÔNG đụng tới file .jsonl gốc',
      fs.existsSync(f) && fs.readFileSync(f, 'utf8') === truoc,
      fs.existsSync(f) ? 'nội dung nguyên vẹn' : 'FILE ĐÃ BIẾN MẤT');
    await fetch(URL + '/api/an/' + sid2, {
      method: 'POST', headers: { 'X-Dash-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bat: false }),
    });
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ---------- Phát hiện phiên TREO ----------
     Mọi đường chạy khác đều có hạn (oneshot 120s, hermes 30s, agy 10 phút), riêng
     đường chat chính thì không — Claude kẹt 40 phút vẫn hiện RUNNING xanh y hệt phiên
     khoẻ, không có cách nào biết trừ khi mở ra xem.

     Kiểm bằng cách NẠP THẲNG hàm chứ không qua HTTP: `treoBaoLau` chỉ trả khác 0 khi
     tiến trình còn trong `procs`, mà bộ test này không spawn Claude thật. Nạp mã rồi
     tự nhét một mục vào `procs` là cách duy nhất kiểm được mà không phải chờ 15 phút. */
  {
    const GOC = path.join(__dirname, '..', 'src', 'server');
    const src = fs.readFileSync(path.join(GOC, 'index.js'), 'utf8')
      .replace(/^#!.*\n/, '')
      .replace(/server\.listen\([\s\S]*?\n\}\);/, '');
    const M = { exports: {} };
    const req = (m) => require(m.startsWith('.') ? path.join(GOC, m) : m);
    new Function('module', 'exports', 'require', '__dirname', '__filename',
      src + '\nmodule.exports={treoBaoLau,statusOf,procs,NGUONG_TREO_MS};')
      (M, M.exports, req, GOC, path.join(GOC, 'index.js'));
    const { treoBaoLau, statusOf, procs, NGUONG_TREO_MS } = M.exports;

    const sid = 'treo-thu-nghiem-0001';
    const nay = Date.now();

    // chưa có trong procs -> không phải treo, dù im cả tiếng
    ok('phiên KHÔNG chạy thì không bao giờ bị gắn cờ treo',
      treoBaoLau(sid, nay - 60 * 60000) === 0, String(treoBaoLau(sid, nay - 60 * 60000)));

    procs.set(sid, { proc: null, startedAt: nay });

    // đang chạy và vừa ghi -> bình thường
    ok('phiên đang chạy còn ghi đều thì KHÔNG bị gắn cờ',
      treoBaoLau(sid, nay - 5000) === 0, String(treoBaoLau(sid, nay - 5000)));

    /* Ngay DƯỚI ngưỡng vẫn phải sạch. Đây là chỗ dễ sai nhất: lượt nặng có agent con
       chạy nền im lâu nhất 13,5 phút (đo trên máy này) — báo nhầm nhóm đó thì cảnh
       báo mất nghĩa, người dùng học cách phớt lờ nó. */
    const duoi = NGUONG_TREO_MS - 30000;
    ok('ngay DƯỚI ngưỡng vẫn coi là bình thường',
      treoBaoLau(sid, nay - duoi) === 0, `im ${Math.round(duoi / 60000)} phút -> ${treoBaoLau(sid, nay - duoi)}`);

    // quá ngưỡng -> trả về SỐ PHÚT, không phải boolean
    const qua = NGUONG_TREO_MS + 5 * 60000;
    const p = treoBaoLau(sid, nay - qua);
    ok('quá ngưỡng thì trả về SỐ PHÚT im lặng',
      p === Math.round(qua / 60000), `mong ${Math.round(qua / 60000)} nhận ${p}`);

    /* `status` PHẢI giữ nguyên 'RUNNING'. Giao diện cũ và bộ lọc "Đang chạy" đều so
       chuỗi `=== 'RUNNING'`; thêm giá trị mới vào đó là phiên treo biến mất khỏi mọi
       chỗ đang đếm nó — đúng lúc cần nhìn thấy nhất. */
    ok('phiên treo VẪN mang status RUNNING (không đổi kiểu cũ)',
      statusOf(sid, nay - qua) === 'RUNNING', statusOf(sid, nay - qua));

    procs.delete(sid);
  }

  /* ---------- Tin tự động lẫn trong lượt người dùng ----------
     Claude CLI nhét task-notification, system-reminder, /lệnh và kết quả lệnh vào cùng
     một chỗ với câu người thật gõ — cùng `type: 'user'`. Không tách thì khung chat hiện
     "mvng: <task-notification>…", đọc như chính mình gõ ra. Đo trên phiên control:
     4/25 lượt user (16%) là loại này. */
  {
    const dir = path.join(PROJECTS_DIR, '-private-tmp-tudong-check');
    const sid = '99999999-1111-4222-8333-444444444444';
    fs.mkdirSync(dir, { recursive: true });
    const dong = (text, i) => JSON.stringify({
      type: 'user', timestamp: new Date(Date.now() - (9 - i) * 60000).toISOString(),
      cwd: '/private/tmp/tudong-check',
      message: { role: 'user', content: text },
    });
    const mau = [
      ['<task-notification><task-id>x</task-id></task-notification>', 'tac-vu'],
      ['<system-reminder>nhắc gì đó</system-reminder>', 'nhac'],
      ['<command-name>/usage</command-name>', 'lenh'],
      ['<local-command-stdout>kết quả</local-command-stdout>', 'ket-qua'],
      ['<local-command-caveat>Caveat: …</local-command-caveat>', 'ket-qua'],
      ['câu này tôi gõ thật', ''],
      ['<không phải thẻ hệ thống nào cả', ''],
    ];
    fs.writeFileSync(path.join(dir, sid + '.jsonl'),
      mau.map(([t], i) => dong(t, i)).join('\n') + '\n');

    const h = await fetch(URL + '/api/history/' + sid, { headers: { 'X-Dash-Token': token } })
      .then((r) => r.json());
    const ms = (h.messages || []).filter((m) => m.role === 'user');

    ok('đọc đủ 7 lượt user của phiên thử', ms.length === 7, ms.length + ' lượt');

    const sai = mau.map(([, mong], i) => [i, mong, ms[i]?.tuDong || ''])
      .filter(([, mong, that]) => mong !== that);
    ok('phân loại đúng cả 5 kiểu tin tự động', sai.length === 0,
      sai.map(([i, mong, that]) => `#${i} mong "${mong}" nhận "${that}"`).join('; ') || 'khớp hết');

    /* Câu người gõ TUYỆT ĐỐI không được đánh dấu tự động — giấu nhầm câu thật thì
       tệ hơn hẳn để lọt vài tin máy. Kể cả câu mở đầu bằng '<' mà không khớp mẫu nào. */
    ok('câu người gõ không bị nhận nhầm là tin tự động',
      !ms[5]?.tuDong && !ms[6]?.tuDong,
      `#5="${ms[5]?.tuDong || ''}" #6="${ms[6]?.tuDong || ''}"`);

    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ---------- Ghim phiên (favorite) ----------
     Danh sách xoay theo thời gian: phiên đang làm dở tụt xuống ngay khi mở phiên khác,
     và 18% danh sách là phiên của dự án đã xoá. Ghim để phiên hay quay lại luôn ở đầu.

     Lưu MẢNG chứ không phải object vì cần giữ thứ tự ghim. Ghi riêng của dashboard
     (`dashboard-fav.json`), không đụng .jsonl của CLI. */
  {
    const sid = 'fav-test-' + Date.now();
    const dat = (bat) => fetch(URL + '/api/fav/' + sid, {
      method: 'POST', headers: { 'X-Dash-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bat }),
    }).then((r) => r.json());

    const a = await dat(true);
    ok('ghim được phiên', a.ok === true && a.fav === true, JSON.stringify(a));

    // Ghim LẠI cùng một phiên không được đẩy thêm bản trùng vào mảng
    const b = await dat(true);
    ok('ghim hai lần không sinh bản trùng', b.tong === a.tong, `${a.tong} -> ${b.tong}`);

    const c = await dat(false);
    ok('bỏ ghim được', c.ok === true && c.fav === false && c.tong === a.tong - 1,
      JSON.stringify(c));

    // Phải thấy trong danh sách phiên — client dùng trường này để vẽ sao và xếp đầu
    const snapFav = await snapshot();
    ok('danh sách phiên có trường fav', (snapFav.data.sessions || []).every((s) => 'fav' in s),
      'kiểm ' + (snapFav.data.sessions || []).length + ' phiên');
  }

  /* ---------- Nhắn khi Claude ĐANG chạy: xếp hàng, không chặn ----------
     Trước đây trả thẳng 409 "session is busy". Đúng lúc trực phiên từ điện thoại thì
     đó là chặn ngay chỗ cần nhất: thấy Claude đang làm, muốn dặn thêm một câu, bấm
     gửi là văng lỗi.

     Đo trên CLI thật: gửi lượt mới lúc lượt cũ chưa xong thì CLI tự xếp hàng và trả
     lời cả hai — nên chặn ở dashboard chỉ là hạn chế tự đặt ra. */
  {
    const post = (ep, body) => fetch(URL + ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dash-Token': token },
      body: JSON.stringify(body),
    }).then((r) => r.json().then((j) => ({ ...j, _code: r.status })))
      .catch((e) => ({ _code: 0, error: e.message }));

    // task chạy đủ lâu để kịp chen tin vào
    const t = await post('/api/task', { task: 'Đếm chậm từ 1 tới 8, mỗi số một dòng' });
    if (!t.ok || !t.sid) {
      ok('nhắn khi đang chạy: xếp hàng thay vì chặn', false, 'không tạo được phiên thử');
    } else {
      await new Promise((r) => setTimeout(r, 2000));
      const g1 = await post('/api/chat/' + t.sid, { message: 'Đáp một từ: xep1' });
      const g2 = await post('/api/chat/' + t.sid, { message: 'Đáp một từ: xep2' });

      ok('nhắn khi Claude đang chạy KHÔNG còn trả 409',
        g1._code === 200 && g2._code === 200, 'mã ' + g1._code + '/' + g2._code);
      ok('tin gửi lúc bận được xếp hàng, báo lại vị trí',
        g1.xepHang === 1 && g2.xepHang === 2,
        'xepHang ' + g1.xepHang + '/' + g2.xepHang);

      /* Bấm Dừng phải BỎ hàng đợi: vừa bảo dừng mà chạy tiếp mấy tin đã gửi là làm
         đúng thứ người dùng vừa từ chối. */
      const k = await post('/api/kill/' + t.sid, {});
      ok('bấm Dừng thì bỏ luôn tin đang xếp',
        k.ok === true && k.boQua === 2, 'bỏ ' + k.boQua + ' tin');

      const h = await fetch(URL + '/api/history/' + t.sid, { headers: { 'X-Dash-Token': token } })
        .then((r) => r.json()).catch(() => ({}));
      ok('hàng đợi rỗng sau khi Dừng', h.xepHang === 0, 'xepHang=' + h.xepHang);
    }
  }

  /* ---------- Duyệt / chọn NGAY Ở DANH SÁCH (remote) ----------
     Vì sao cần: dùng dashboard trên điện thoại chủ yếu là TRỰC phiên — liếc xem cái
     nào đứng chờ rồi bấm cho nó đi tiếp. Trước đây danh sách chỉ có cờ boolean
     "đang chờ", muốn bấm phải mở phiên, cuộn xuống cuối, rồi mới bấm được.

     Bài này chốt phần SERVER: danh sách phải mang theo NỘI DUNG (câu hỏi + các lựa
     chọn, tóm tắt kế hoạch), không chỉ loại. Thiếu nó thì giao diện có vẽ nút cũng
     không biết vẽ gì. */
  {
    const dir = path.join(PROJECTS_DIR, '-Users-mvng-Desktop-project-control');
    const sidKe = 'ttttttt1-0000-4000-8000-00000000ke01';
    const sidHoi = 'ttttttt1-0000-4000-8000-00000000ho01';
    const fKe = path.join(dir, sidKe + '.jsonl');
    const fHoi = path.join(dir, sidHoi + '.jsonl');
    const luot = (vai, noi, ts) => JSON.stringify({
      type: vai, timestamp: new Date(ts).toISOString(),
      message: { role: vai, content: noi },
    }) + '\n';

    try {
      fs.mkdirSync(dir, { recursive: true });
      // ExitPlanMode chưa có tool_result = đang đứng chờ người bấm Duyệt
      fs.writeFileSync(fKe,
        luot('user', [{ type: 'text', text: 'Lập kế hoạch' }], Date.now() - 20000)
        + luot('assistant', [{ type: 'tool_use', id: 'tu_ke_t', name: 'ExitPlanMode',
          input: { plan: '# Kế hoạch\n\n1. Bước một\n2. Bước hai', planFilePath: '/Users/x/.claude/plans/t.md' } }], Date.now() - 10000));
      // AskUserQuestion 2 câu -> thẻ chỉ hiện câu đầu, báo "còn 1 câu"
      fs.writeFileSync(fHoi,
        luot('user', [{ type: 'text', text: 'Chọn giúp' }], Date.now() - 20000)
        + luot('assistant', [{ type: 'tool_use', id: 'tu_hoi_t', name: 'AskUserQuestion',
          input: { questions: [
            { question: 'Dùng CSDL nào?', header: 'CSDL', multiSelect: false,
              options: [{ label: 'Postgres' }, { label: 'SQLite' }] },
            { question: 'Có migration không?', header: 'Migration', multiSelect: false,
              options: [{ label: 'Có' }, { label: 'Không' }] },
          ] } }], Date.now() - 10000));
      await new Promise((r) => setTimeout(r, 400));

      const ds = (await snapshot()).data.sessions || [];
      const ke = ds.find((x) => x.sid === sidKe);
      const hoi = ds.find((x) => x.sid === sidHoi);

      ok('danh sách mang tóm tắt kế hoạch (duyệt được ngay, khỏi mở phiên)',
        !!(ke && ke.choND && ke.choND.cho === 'ke-hoach' && /Bước một/.test(ke.choND.tomTat || '')),
        ke && ke.choND ? String(ke.choND.tomTat || '').slice(0, 45) : 'không có choND');

      const q = hoi && hoi.choND && hoi.choND.hoi;
      ok('danh sách mang câu hỏi + các lựa chọn (chọn được ngay)',
        !!(q && /CSDL/.test(q.hoi) && (q.chon || []).length === 2),
        q ? q.hoi.slice(0, 30) + ' -> ' + (q.chon || []).map((c) => c.nhan).join('/') : 'không có hoi');

      ok('nhiều câu hỏi thì báo còn mấy câu (thẻ chỉ đủ chỗ một câu)',
        !!(q && q.them === 1), q ? 'them=' + q.them : '-');

      /* Cắt ngắn là BẮT BUỘC: danh sách này đi qua SSE mỗi 2 giây, mà kế hoạch đo
         thật dài tới 15.371 ký tự. Gửi nguyên là mỗi nhịp tốn thêm 15KB cho thứ chỉ
         để liếc. */
      ok('tóm tắt kế hoạch bị cắt ngắn (SSE 2 giây, không nhồi cả kế hoạch)',
        !!(ke && ke.choND && (ke.choND.tomTat || '').length <= 300),
        ke && ke.choND ? (ke.choND.tomTat || '').length + ' ký tự' : '-');
    } finally {
      try { fs.unlinkSync(fKe); } catch {}
      try { fs.unlinkSync(fHoi); } catch {}
    }
  }

  /* ---------- Bảng lệnh: 12 nút Hermes + 5 lệnh con Claude ----------
     Vì sao cần: 4/12 nút Hermes từng HỎNG suốt nhiều bản mà 460 bài test không bắt
     được cái nào. Chúng có handler, gọi server đúng, chỉ hỏng ở tầng cuối — CLI trả
     "requires an interactive terminal" (tools, model) hoặc in bảng usage vì thiếu
     subcommand (sessions, skills). `dead-buttons.js` không thấy vì nó chỉ tìm nút
     THIẾU handler.

     Nên bài này gọi THẬT từng lệnh rồi soi nội dung trả về, không chỉ xem HTTP 200. */
  {
    const chay = (ep, body) => fetch(URL + ep, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dash-Token': token },
      body: JSON.stringify(body),
    }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message }));

    // Dấu hiệu lệnh KHÔNG chạy được, dù HTTP vẫn 200
    const HONG = [
      /requires an interactive terminal/i,   // CLI đòi TTY
      /isn't available in this environment/i, // lệnh slash bị chặn ở -p
      /^usage:/im,                            // thiếu subcommand -> in bảng usage
      /^Usage: hermes/im,
    ];
    const loi = (out) => HONG.find((r) => r.test(out || ''));

    /* Đúng các nút trong hermes-tools.tsx. Bốn cái có args ở giữa chính là bốn cái
       từng hỏng (tools/model/sessions/skills) — giữ nguyên để không tái phát. */
    const NUT_HERMES = [
      ['status', []], ['doctor', []], ['memory', []], ['cron', []],
      ['mcp', []], ['insights', []], ['version', []], ['config', []],
      ['sessions', ['list']], ['skills', ['list']],
      ['tools', ['list']], ['config', ['get', 'model']],
      // nhóm đọc thêm
      ['sessions', ['stats']], ['logs', ['errors', '-n', '3']], ['auth', ['list']],
      ['prompt-size', []], ['kanban', ['list']],
    ];
    let hOk = 0, hLoi = [];
    for (const [cmd, args] of NUT_HERMES) {
      const r = await chay('/api/hermes/run', { cmd, args });
      const nhan = cmd + (args.length ? ' ' + args.join(' ') : '');
      if (!r.ok) { hLoi.push(nhan + ': ' + String(r.error || 'không ok').slice(0, 40)); continue; }
      const x = loi(r.output);
      if (x) hLoi.push(nhan + ': ' + String(r.output).split('\n')[0].slice(0, 45));
      else hOk++;
    }
    ok('nút Hermes đều trả nội dung thật (không lỗi TTY, không bảng usage)',
      hLoi.length === 0, hLoi.length ? hLoi.slice(0, 3).join(' | ') : hOk + '/' + NUT_HERMES.length + ' chạy');

    /* Năm lệnh con Claude. `agents` và `auth` phải trả JSON PARSE ĐƯỢC — server tự
       parse rồi gắn vào `data`, client dựa vào đó chứ không đoán từ text. */
    const SUB = ['agents', 'auth', 'doctor', 'mcp', 'plugin'];
    let sOk = 0, sLoi = [];
    for (const cmd of SUB) {
      const r = await chay('/api/claude/sub', { cmd });
      if (!r.ok) { sLoi.push(cmd + ': ' + String(r.error || 'không ok').slice(0, 40)); continue; }
      const x = loi(r.output);
      if (x) sLoi.push(cmd + ': ' + String(r.output).split('\n')[0].slice(0, 45));
      else sOk++;
    }
    ok('5 lệnh con Claude đều chạy được ngoài TTY',
      sLoi.length === 0, sLoi.length ? sLoi.join(' | ') : sOk + '/5 chạy');

    const ag = await chay('/api/claude/sub', { cmd: 'agents' });
    ok('claude agents --json trả JSON có cấu trúc (biết phiên nào chạy ở terminal)',
      ag.ok && Array.isArray(ag.data), ag.data ? ag.data.length + ' phiên' : 'không parse được');

    const au = await chay('/api/claude/sub', { cmd: 'auth' });
    ok('claude auth status cho biết gói đang dùng',
      au.ok && au.data && typeof au.data.loggedIn === 'boolean',
      au.data ? (au.data.subscriptionType || '?') : 'không parse được');

    // Lệnh ngoài bảng tra phải bị CHẶN — bảng cứng mới có nghĩa
    const cam = await chay('/api/claude/sub', { cmd: 'update' });
    ok('lệnh con ngoài bảng tra bị chặn', cam.ok === false, String(cam.error || '').slice(0, 45));
    const camH = await chay('/api/hermes/run', { cmd: 'uninstall', args: [] });
    ok('lệnh Hermes ngoài whitelist bị chặn', camH.ok === false, String(camH.error || '').slice(0, 45));

    /* `logs -f` tail mãi không xong: execFile chỉ giết khi chạm timeout 30 giây, nên
       không chặn thì người dùng ngồi chờ trọn 30 giây rồi nhận về rỗng. */
    const camF = await chay('/api/hermes/run', { cmd: 'logs', args: ['-f'] });
    ok('cờ chạy-mãi (-f) bị chặn, không để treo 30 giây',
      camF.ok === false && /chạy-mãi/.test(String(camF.error || '')), String(camF.error || '').slice(0, 45));

    /* Cờ tuỳ chọn khi giao task đều do CLIENT khai — dashboard mở ra mạng nên ai vào
       được là truyền được. Bài này ném vào cả giá trị độc rồi soi tiến trình THẬT
       xem cái gì lọt: tên tool có khoảng trắng, cờ CLI trá hình, thư mục không tồn
       tại, và đường dẫn trỏ vào file chứ không phải thư mục. */
    const doc = await chay('/api/task', {
      task: 'Đáp một từ: loc',
      allowedTools: ['Read', '; rm -rf /', '--dangerously-skip-permissions'],
      addDir: ['/khong/ton/tai/dau', '/etc/hosts'],
      autocompact: 'xoá-hết',
    });
    if (!doc.ok) {
      ok('bộ lọc cờ task: loại giá trị độc', false, String(doc.error || '').slice(0, 40));
    } else {
      await new Promise((r) => setTimeout(r, 2500));
      const dong = await new Promise((r) => require('child_process')
        .exec("ps aux | grep '[c]laude -p' | grep -c -- '--dangerously-skip-permissions\\|rm -rf\\|/etc/hosts\\|xoá-hết'",
          (e, o) => r(+String(o).trim() || 0)));
      ok('bộ lọc cờ task: loại giá trị độc (tool có khoảng trắng, cờ trá hình, thư mục sai)',
        dong === 0, dong === 0 ? 'không giá trị độc nào vào lệnh' : dong + ' tiến trình dính');
      await fetch(URL + '/api/kill/' + doc.sid, { method: 'POST', headers: { 'X-Dash-Token': token } }).catch(() => {});
    }
  }

  /* ---------- Hạn mức Claude ----------
     Hết hạn mức là thứ CHẶN việc, mà trước đây chỉ biết khi Claude đột ngột trả lỗi
     giữa lượt — trên iPhone càng khó đoán vì không thấy terminal.

     Cache 60 giây là phần bắt buộc phải chốt: `/usage` spawn `claude -p`, đo thật 8,4
     giây. Gọi theo nhịp SSE 2 giây là treo cả dashboard. */
  {
    const goi = (them) => fetch(URL + '/api/quota' + (them || ''),
      { headers: { 'X-Dash-Token': token } }).then((r) => r.json());

    /* Ép hỏi lại CLI để có mốc "lần đầu" thật. Gọi trơn thì lần chạy test TRƯỚC đã
       nhét sẵn cache, đo ra 6ms -> 8ms và bài cache thành vô nghĩa (đã xảy ra). */
    const t0 = Date.now();
    const a = await goi('?moi=1');
    const lan1 = Date.now() - t0;

    if (!a.ok) {
      // máy không gọi được `claude` (CI, container) — báo rõ chứ không giả vờ xanh
      ok('hạn mức: CLI trả được số liệu', false, a.error || 'không đọc được');
    } else {
      ok('hạn mức: parse ra được các mức dùng',
        Array.isArray(a.muc) && a.muc.length > 0, (a.muc || []).length + ' mức');
      /* CLI in "Warning: no stdin data received in 3s…" ra stderr nếu không đóng stdin.
         Ta gộp stdout+stderr nên nó lọt thẳng vào khối "gì đang ăn hạn mức" trên giao
         diện — đã thấy thật trên màn desktop, nhìn như dashboard hỏng. */
      ok('không có dòng cảnh báo nào của CLI lọt vào số liệu',
        !/no stdin data received|^\s*Warning:/mi.test(a.tho || ''),
        (a.tho || '').split('\n').filter((d) => /Warning|stdin/i.test(d))[0] || 'sạch');

      ok('mỗi mức có phần trăm là SỐ và mốc đặt lại',
        (a.muc || []).every((m) => typeof m.phanTram === 'number' && m.phanTram >= 0 && m.phanTram <= 100),
        JSON.stringify((a.muc || []).map((m) => m.ten + '=' + m.phanTram + '%')));

      const t1 = Date.now();
      const b = await goi();
      const lan2 = Date.now() - t1;
      ok('cache 60 giây ăn — lần sau không spawn CLI lại',
        b.cache === true && lan2 < 200, lan1 + 'ms -> ' + lan2 + 'ms');
    }
    /* KHÔNG kiểm ?moi=1 ở đây: mỗi lần bỏ cache là spawn `claude -p /usage`, đo thật
       8,2 giây. Thêm một lần nữa đẩy cả bộ test quá giới hạn 600 giây và làm server
       test chết giữa chừng (ECONNRESET) — đã xảy ra thật. Nhánh đó chỉ khác nhau ở
       một câu `if`, không đáng đánh đổi độ tin cậy của cả bộ. */
  }

  /* ---------- Tìm trong NỘI DUNG phiên ----------
     Ô tìm ở danh sách chỉ quét siêu dữ liệu + tin CUỐI. Cộng với cửa sổ 30 tin, đo
     trên phiên control: 19.806 lượt tức dashboard xem được 0,2% — nội dung cũ vừa
     không xem được vừa không tìm được, phải tải cả file .md về đọc ngoài app.

     Bài quan trọng nhất ở đây là TÌM KHÔNG DẤU: trên iPhone gõ không dấu nhanh hơn
     hẳn, mà nội dung thì có dấu. Sai chỗ này là tính năng vô dụng trên chính thiết bị
     Vinh dùng nhiều nhất. */
  {
    const dir = path.join(PROJECTS_DIR, '-private-tmp-tim-check');
    const sid = 'aaaaaaaa-2222-4333-8444-555555555555';
    const f = path.join(dir, sid + '.jsonl');
    const gio = Date.now();
    const dong = (i, chu) => JSON.stringify({
      type: 'assistant', timestamp: new Date(gio - (60 - i) * 1000).toISOString(),
      cwd: '/private/tmp/tim-check',
      message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: chu }] },
    }) + '\n';
    const tim = (q) => fetch(URL + '/api/tim/' + sid + '?q=' + encodeURIComponent(q),
      { headers: { 'X-Dash-Token': token } }).then((r) => r.json());

    try {
      fs.mkdirSync(dir, { recursive: true });
      // 40 tin nhồi + 1 tin có dấu nằm SÂU (ngoài cửa sổ 30) -> đúng chỗ trước đây mù
      const ds = [dong(0, 'Đây là kế hoạch triển khai đặc biệt')];
      for (let i = 1; i <= 40; i++) ds.push(dong(i, 'dòng nhồi số ' + i));
      fs.writeFileSync(f, ds.join(''));
      await new Promise((r) => setTimeout(r, 250));

      const a = await tim('ke hoach');
      ok('tìm KHÔNG DẤU vẫn ra chữ có dấu ("ke hoach" -> "kế hoạch")',
        a.ok && a.so === 1 && /kế hoạch/.test(a.ket[0].trich), JSON.stringify(a.so ?? a.error));

      ok('kết quả cho biết nằm cách cuối bao nhiêu tin (để client tải thêm)',
        !!a.ket && a.ket[0].cuoi === 40, a.ket ? 'cuoi=' + a.ket[0].cuoi : '—');

      ok('tìm được tin NGOÀI cửa sổ 30 — thứ trước đây không xem nổi',
        !!a.ket && a.ket[0].cuoi > 30, a.ket ? 'cách cuối ' + a.ket[0].cuoi + ' tin' : '—');

      const b = await tim('KẾ HOẠCH');
      ok('không phân biệt hoa thường', b.so === 1, String(b.so));

      const c = await tim('khongcogichuoinay');
      ok('không khớp thì trả rỗng, không lỗi', c.ok && c.so === 0, String(c.so ?? c.error));

      const d = await tim('a');
      ok('chặn truy vấn quá ngắn (1 ký tự quét cả phiên là phí)', d.error && !d.ok,
        JSON.stringify(d.error || d));
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }

  /* ---------- Phiên chờ người bấm: phân biệt với "đã trả lời xong" ----------
     Vinh dùng iPhone là chính. Trước đây mọi lượt kết thúc đều bắn một thông báo y hệt
     "đã trả lời xong", nên phiên ĐANG ĐỨNG CHỜ TAY NGƯỜI (duyệt kế hoạch / chọn phương
     án) không phân biệt được với phiên đã xong hẳn — mà đó mới là cái cần mở ra bấm.

     Test kiểm server nhận DẠNG chờ đúng từ .jsonl. Bản thân push không kiểm được ở đây
     (cần push service thật — tests/push.js lo tầng đó), nhưng `cho` là thứ quyết định
     nhánh nào chạy, nên sai ở đây là sai luôn thông báo. */
  {
    const dir = path.join(PROJECTS_DIR, '-private-tmp-cho-check');
    const sid = '99999999-1111-4222-8333-444444444444';
    const f = path.join(dir, sid + '.jsonl');
    const lay = async () => (await snapshot()).data.sessions.find((s) => s.sid === sid);
    const gio = Date.now();
    // lượt assistant gọi tool nhưng CHƯA có tool_result -> đang chờ người bấm
    const dongCho = (ten, extra) => JSON.stringify({
      type: 'assistant', timestamp: new Date(gio - 5000).toISOString(),
      cwd: '/private/tmp/cho-check',
      message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'tool_use', id: 'toolu_' + ten, name: ten, input: extra }] },
    }) + '\n';

    try {
      fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(f, dongCho('ExitPlanMode', { plan: 'Kế hoạch thử' }));
      await new Promise((r) => setTimeout(r, 250));
      const a = await lay();
      ok('phiên chờ DUYỆT KẾ HOẠCH nhận đúng dạng "ke-hoach"',
        !!a && a.cho === 'ke-hoach', a ? JSON.stringify(a.cho) : 'không thấy phiên');

      fs.writeFileSync(f, dongCho('AskUserQuestion', { questions: [{ question: 'Chọn gì?' }] }));
      await new Promise((r) => setTimeout(r, 250));
      const b = await lay();
      ok('phiên chờ TRẢ LỜI CÂU HỎI nhận đúng dạng "cau-hoi"',
        !!b && b.cho === 'cau-hoi', b ? JSON.stringify(b.cho) : 'không thấy');

      /* Lượt xong hẳn: tool đã có kết quả -> KHÔNG chờ gì.
         Đây là nhánh dễ sai nhất — nhầm ở đây thì mọi phiên đều báo "chờ duyệt",
         thông báo mất hết ý nghĩa. */
      fs.appendFileSync(f, JSON.stringify({
        type: 'user', timestamp: new Date(gio - 3000).toISOString(),
        cwd: '/private/tmp/cho-check',
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_AskUserQuestion', content: 'đã chọn' }] },
      }) + '\n' + JSON.stringify({
        type: 'assistant', timestamp: new Date(gio - 2000).toISOString(),
        cwd: '/private/tmp/cho-check',
        message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: 'Xong rồi nhé.' }] },
      }) + '\n');
      await new Promise((r) => setTimeout(r, 250));
      const c = await lay();
      ok('lượt xong hẳn thì KHÔNG bị coi là đang chờ',
        !!c && !c.cho, c ? JSON.stringify(c.cho) : 'không thấy');
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }

  /* ---------- Khởi động lại sau khi cập nhật ----------
     Mắt xích thiếu khiến bấm Cập nhật xong mà version không đổi: `npm install -g`
     chỉ thay file trên ĐĨA, mã đang chạy đã nạp vào RAM từ lúc khởi động. Gặp thật
     trên máy vinhnm — đĩa lên 1.2.0 lúc 04:58 nhưng tiến trình chạy từ ba ngày
     trước, nên dashboard hiện bản cũ suốt, nhìn như cập nhật hỏng.

     Test chạy ở môi trường KHÔNG có systemd (test-all tự bật server bằng node), nên
     endpoint phải TỪ CHỐI — thoát lúc này là tắt hẳn dashboard, không ai bật lại.
     Đây mới là nhánh cần chốt: nhánh thoát thật thì test không kiểm được mà không
     tự giết server của chính mình. */
  {
    const r = await fetch(URL + '/api/capnhat/khoi-dong-lai', {
      method: 'POST', headers: { 'X-Dash-Token': token, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const j = await r.json().catch(() => ({}));
    const coSystemd = !!process.env.INVOCATION_ID;
    if (coSystemd) {
      ok('khởi động lại: chạy dưới systemd -> chấp nhận', r.status === 200, 'HTTP ' + r.status);
    } else {
      ok('khởi động lại: KHÔNG có systemd -> từ chối, không tự tắt',
        r.status === 409, 'HTTP ' + r.status);
      ok('lý do từ chối nói rõ lệnh phải gõ tay',
        /systemctl/.test(j.error || ''), (j.error || '').slice(0, 70));
    }
    // GET phải không làm gì — hành động đổi trạng thái máy chỉ đi qua POST
    const g = await fetch(URL + '/api/capnhat/khoi-dong-lai',
      { headers: { 'X-Dash-Token': token } });
    ok('khởi động lại: GET không kích hoạt được (chỉ POST)', g.status === 404, 'HTTP ' + g.status);
  }

  /* ---------- Chốt chặn đường dẫn của /api/file ----------
     Đây là endpoint DUY NHẤT trong app đọc file tuỳ ý theo đường dẫn gửi từ ngoài vào.
     Thủng nó là dashboard thành công cụ đọc trộm cả đĩa — mà máy này mở trên tailnet.
     Ba lớp: resolve + phải nằm trong cwd; danh sách cấm; trần 512KB.
     KHÔNG dựa vào việc quetFile() bỏ file ẩn: hàm đó phục vụ gợi ý "@", ai sửa nó là
     chốt chặn thủng lúc đó. Nên test bắn thẳng đường dẫn, không lấy từ cây. */
  {
    const snap = await snapshot();
    /* Phải loại phiên chạy ở THƯ MỤC NHÀ. Server chặn thẳng chúng bằng `gocQuaRong`
       ("phiên này chạy ở thư mục nhà, không mở file") — đúng chủ ý, vì cho đọc từ ~/
       là mở toang cả đĩa. Nhưng test bắn vào một phiên như vậy thì MỌI bài đều nhận
       cùng một lỗi chặn, kể cả bài "vẫn đọc được file thường" — đỏ oan 15 bài.
       Danh sách phiên xoay theo thời gian nên lúc trúng lúc không: đã thấy cùng một
       commit chạy ra 68/69 rồi 53/68. Lọc theo đường dẫn thật để hết ngẫu nhiên. */
    const ss = (snap.data.sessions || []).filter((s) => s.duAn && s.duAn.conTonTai && !s.duAn.laNhap
      && s.duAn.duongDan && (s.duAn.duongDan.match(/\//g) || []).length >= 4);
    const phien = ss[0];
    if (!phien) {
      ok('có phiên để kiểm chốt chặn /api/file', false, 'không tìm được phiên nào có cwd đủ sâu');
    } else {
      const doc = async (duong) => {
        const u = `${URL}/api/file?sid=${encodeURIComponent(phien.sid)}&path=${encodeURIComponent(duong)}`;
        const r = await fetch(u, { headers: { 'X-Dash-Token': token } });
        return { code: r.status, body: await r.json().catch(() => ({})) };
      };

      // Vượt ra ngoài cwd bằng ../ — phải bị chặn, KHÔNG được trả nội dung
      for (const xau of ['../../.ssh/id_rsa', '../../../etc/passwd', '../../../../etc/hosts']) {
        const r = await doc(xau);
        ok('chặn thoát khỏi thư mục dự án: ' + xau,
          r.code === 400 && !r.body.noiDung, r.code + ' ' + JSON.stringify(r.body).slice(0, 60));
      }

      /* MỌI file ẩn phải bị chặn, không chỉ vài cái tên liệt kê sẵn. Đo thật: danh sách
         liệt-kê-từng-tên để lọt `.zsh_history` — 6.130 ký tự lịch sử shell, nơi mật khẩu
         và token hay bị dán thẳng vào dòng lệnh. Chặn cả nhóm thì không phải đuổi bắt.
         Không mất chức năng: quetFile đã bỏ hết file ẩn khỏi cây từ trước. */
      for (const an of ['.zsh_history', '.bash_history', '.gnupg/secring.gpg',
        '.docker/config.json', '.kube/config', '.config/gh/hosts.yml']) {
        const r = await doc(an);
        ok('chặn file ẩn: ' + an, !r.body.noiDung && r.code === 403,
          r.code + ' ' + (r.body.error || (r.body.noiDung || '').length + ' ký tự LỌT'));
      }

      // File bí mật NẰM TRONG cwd — resolve không cứu được, phải có danh sách cấm.
      // .git/config tồn tại thật trong repo và chứa URL remote.
      for (const bim of ['.env', '.env.local', '.git/config', 'src/../.env', 'node_modules/../.git/config']) {
        const r = await doc(bim);
        ok('chặn file bí mật trong dự án: ' + bim,
          r.code === 403 && !r.body.noiDung, r.code + ' ' + JSON.stringify(r.body).slice(0, 60));
      }

      /* SYMLINK — lỗ hổng đã THỦNG THẬT một lần, không phải giả định.
         path.resolve chỉ xử lý CHUỖI: một symlink nằm trong dự án trỏ ra ngoài thì
         đường dẫn vẫn "nằm trong cwd" trong khi readFileSync đi theo link ra tận đâu.
         Đo được lúc đó: `ln -s /etc/passwd ./x.txt` -> đọc trọn /etc/passwd, và
         `ln -s ~/.ssh ./d` -> `d/id_ed25519_<tên>` trả về nguyên KHOÁ SSH RIÊNG.
         Bịt bằng realpath. Bài này giữ chỗ đó, tạo symlink thật rồi dọn. */
      // Phải đặt symlink trong cwd CỦA PHIÊN đang thử, không phải cwd của test —
      // hai thứ đó trùng nhau lúc chạy tay nhưng khác nhau khi test-all đổi phiên.
      const goc = phien.duAn.khoa;
      const links = [
        ['sym-etc-passwd.txt', '/etc/passwd'],
        ['sym-thu-muc-ssh', path.join(os.homedir(), '.ssh')],
      ];
      const daTao = [];
      for (const [ten, dich] of links) {
        const noi = path.join(goc, ten);
        try { fs.unlinkSync(noi); } catch {}
        try { fs.symlinkSync(dich, noi); daTao.push(noi); } catch {}
      }
      try {
        if (daTao.length === links.length) {
          const r1 = await doc('sym-etc-passwd.txt');
          ok('symlink trỏ ra /etc/passwd bị chặn (đã THỦNG thật một lần)',
            !!r1.body.error && !r1.body.noiDung,
            r1.code + ' ' + (r1.body.error || (r1.body.noiDung || '').length + ' ký tự LỌT'));

          // đọc qua symlink THƯ MỤC: từng lôi ra được khoá SSH riêng
          let ten1 = '';
          try { ten1 = fs.readdirSync(path.join(os.homedir(), '.ssh'))[0] || ''; } catch {}
          if (ten1) {
            const r2 = await doc('sym-thu-muc-ssh/' + ten1);
            ok('symlink thư mục trỏ ra ~/.ssh bị chặn (từng lôi ra khoá riêng)',
              !!r2.body.error && !r2.body.noiDung,
              r2.code + ' ' + (r2.body.error || (r2.body.noiDung || '').length + ' ký tự LỌT'));
          }
        } else {
          ok('tạo được symlink để kiểm', false, 'không tạo được symlink thử');
        }
      } finally {
        for (const noi of daTao) { try { fs.unlinkSync(noi); } catch {} }
      }

      /* HARD LINK — lỗ còn lại sau khi bịt symlink, cũng THỦNG THẬT khi thử:
         `ln ~/.ssh/id_ed25519_<tên> ./x.txt` rồi ?path=x.txt trả nguyên khoá riêng.
         realpath không cứu được vì hard link không phải link — nó là tên thứ hai trỏ
         thẳng vào cùng inode nên đường thật vẫn nằm trong dự án. Chặn bằng nlink.
         Dùng file MỒI tự tạo, không đụng khoá thật của người dùng. */
      const moi = path.join(os.homedir(), 'moi-kiem-hardlink.txt');
      const hl = path.join(goc, 'hl-kiem.txt');
      let taoHl = false;
      try {
        fs.writeFileSync(moi, 'BI-MAT-NGOAI-DU-AN-' + 'x'.repeat(50) + '\n');
        try { fs.unlinkSync(hl); } catch {}
        fs.linkSync(moi, hl);
        taoHl = true;
      } catch {}
      try {
        if (taoHl) {
          const rh = await doc('hl-kiem.txt');
          ok('hard link trỏ ra ngoài dự án bị chặn (đã THỦNG thật một lần)',
            !!rh.body.error && !rh.body.noiDung,
            rh.code + ' ' + (rh.body.error || (rh.body.noiDung || '').length + ' ký tự LỌT'));
        } else {
          ok('tạo được hard link để kiểm', false, 'không tạo được hard link thử');
        }
      } finally {
        try { fs.unlinkSync(hl); } catch {}
        try { fs.unlinkSync(moi); } catch {}
      }

      /* Còn phải ĐỌC ĐƯỢC file thường, không thì chặn quá tay thành vô dụng.
         KHÔNG gõ cứng 'package.json': phiên đứng đầu danh sách đổi theo thời gian, và
         không phải dự án nào cũng là dự án Node — đã đỏ một lần khi phiên đầu rơi vào
         một trang web tĩnh. Hỏi /api/tree lấy một file có thật rồi mới đọc. */
      const cay = await fetch(`${URL}/api/tree?sid=${encodeURIComponent(phien.sid)}`,
        { headers: { 'X-Dash-Token': token } }).then((r) => r.json()).catch(() => ({}));
      const fileThat = (cay.files || []).find((f) => /\.(js|ts|tsx|json|md|txt|css|html)$/i.test(f));
      if (!fileThat) {
        ok('vẫn đọc được file thường trong dự án', false, 'cây không có file văn bản nào');
      } else {
        const bt = await doc(fileThat);
        ok('vẫn đọc được file thường trong dự án',
          bt.code === 200 && typeof bt.body.noiDung === 'string' && bt.body.soDong > 0,
          `${fileThat} -> ${bt.code} ${bt.body.soDong || 0} dòng`);
      }

      // Phiên không có cwd -> không đọc gì hết, không rơi về thư mục nào khác
      const khong = await fetch(`${URL}/api/file?sid=khong-co-that&path=package.json`,
        { headers: { 'X-Dash-Token': token } });
      const kbody = await khong.json().catch(() => ({}));
      ok('phiên không tồn tại thì không đọc được file nào',
        khong.status === 400 && !kbody.noiDung, khong.status + ' ' + JSON.stringify(kbody).slice(0, 50));
    }
  }

  /* ---- cwd = thư mục NHÀ thì không mở file ----
     Đo thật: 33 phiên có cwd = os.homedir(), nhóm cwd đông nhất trên máy này. Với
     chúng "thư mục dự án" là cả nhà — cây ra 4000 file gồm Desktop/Documents/Library
     và đọc được Desktop/Chatgpt/accounts_*.txt. Chốt chặn đường dẫn không giúp gì vì
     mọi file đó ĐÚNG LÀ nằm trong cwd; cách duy nhất là từ chối mở gốc rộng quá. */
  {
    const snap2 = await snapshot();
    const nha = (snap2.data.sessions || []).filter((s) => s.duAn && s.duAn.khoa === os.homedir());
    if (!nha.length) {
      ok('có phiên cwd = nhà để kiểm', true, '(máy này không có phiên nào chạy ở ~)');
    } else {
      const sid = nha[0].sid;
      const t = await fetch(`${URL}/api/tree?sid=${sid}`, { headers: { 'X-Dash-Token': token } })
        .then((r) => r.json()).catch(() => ({}));
      ok('cwd = nhà: cây file trả rỗng kèm cờ quaRong',
        t.quaRong === true && (t.files || []).length === 0,
        `quaRong=${t.quaRong} files=${(t.files || []).length}`);

      const f = await fetch(`${URL}/api/file?sid=${sid}&path=${encodeURIComponent('Desktop')}`,
        { headers: { 'X-Dash-Token': token } });
      const fb = await f.json().catch(() => ({}));
      ok('cwd = nhà: không đọc được file nào',
        f.status === 403 && !fb.noiDung, f.status + ' ' + (fb.error || ''));

      // và phiên dự án BÌNH THƯỜNG vẫn phải mở được, không chặn quá tay
      const thuong = (snap2.data.sessions || []).find((s) => s.duAn && s.duAn.conTonTai
        && !s.duAn.laNhap && s.duAn.khoa !== os.homedir());
      if (thuong) {
        const t2 = await fetch(`${URL}/api/tree?sid=${thuong.sid}`, { headers: { 'X-Dash-Token': token } })
          .then((r) => r.json()).catch(() => ({}));
        ok('phiên dự án thường vẫn mở được cây file',
          !t2.quaRong && (t2.files || []).length > 0,
          `${(t2.files || []).length} file | ${thuong.duAn.ten}`);
      }
    }
  }

  /* ---- quyền + mức nghĩ RIÊNG TỪNG PHIÊN ----
     Trước đây cả hai là biến TOÀN CỤC (một `permMode`, một `effort` cho cả server),
     nên đổi ở phiên A là phiên B, C, cả task mới, cả loop/cron đổi theo ngay. Model
     đã sửa bài này từ lâu; đây là làm nốt cho hai cái còn lại.
     Và giá trị hiển thị phải hoà từ CẤU HÌNH CLI THẬT, không phải file riêng của
     dashboard — đo lúc viết: CLI dùng effortLevel "high" mà dashboard hiện "Tự động". */
  {
    const snap3 = await snapshot();
    const dsP = (snap3.data.sessions || []).filter((s) => s.duAn && s.duAn.conTonTai);
    if (dsP.length < 2) {
      ok('có đủ 2 phiên để kiểm tách cấu hình', false, 'chỉ có ' + dsP.length + ' phiên');
    } else {
      const A = dsP[0].sid, Bp = dsP[1].sid;
      const H2 = { 'X-Dash-Token': token, 'Content-Type': 'application/json' };
      const su = (u) => fetch(URL + u, { headers: { 'X-Dash-Token': token } }).then((r) => r.json());

      // đọc cấu hình CLI thật để so
      let cliEffort = '';
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
        cliEffort = cfg.effortLevel || '';
      } catch {}
      const h0 = await su('/api/history/' + A);
      if (cliEffort) {
        ok('mức nghĩ hiển thị khớp cấu hình THẬT của Claude CLI',
          h0.effortHieuLuc === cliEffort, `CLI=${cliEffort} dashboard=${h0.effortHieuLuc}`);
      }

      // đặt riêng cho A, B phải không đổi
      await fetch(`${URL}/api/perm/${A}`, { method: 'POST', headers: H2, body: JSON.stringify({ mode: 'plan' }) });
      await fetch(`${URL}/api/effort/${A}`, { method: 'POST', headers: H2, body: JSON.stringify({ effort: 'max' }) });
      const hA = await su('/api/history/' + A);
      const hB = await su('/api/history/' + Bp);
      ok('đặt quyền cho phiên A thì phiên B KHÔNG đổi theo',
        hA.permHieuLuc === 'plan' && hB.permHieuLuc !== 'plan',
        `A=${hA.permHieuLuc} B=${hB.permHieuLuc}`);
      ok('đặt mức nghĩ cho phiên A thì phiên B KHÔNG đổi theo',
        hA.effortHieuLuc === 'max' && hB.effortHieuLuc !== 'max',
        `A=${hA.effortHieuLuc} B=${hB.effortHieuLuc}`);

      /* KHÔNG được ghi vào file cấu hình của Claude CLI. settings.json đang giữ các
         quy tắc quyền đã duyệt + hook + plugin; ghi hỏng là người dùng mất hết.

         Đo NỘI DUNG, không đo mtime. Bài này từng dùng mtime > 30s và cho dương tính
         giả: đo được CHÍNH Claude CLI ghi lại settings.json mỗi lần chạy `claude -p`
         (mtime nhảy 8 giây sau một lệnh, dù dashboard không đụng gì). Mà dashboard thì
         có endpoint gọi `claude -p /usage` — nên chỉ cần mở tab Hạn mức là bài đỏ oan.
         Thứ cần bảo đảm là NỘI DUNG không đổi, không phải file bất động. */
      const fCLI = path.join(os.homedir(), '.claude', 'settings.json');
      const docCLI = () => { try { return fs.readFileSync(fCLI, 'utf8'); } catch { return ''; } };
      const truoc = docCLI();
      // đổi cả ba thứ dashboard có thể ghi nhầm, rồi so lại nội dung
      await fetch(`${URL}/api/perm/${A}`, { method: 'POST', headers: H2, body: JSON.stringify({ mode: 'bypassPermissions' }) });
      await fetch(`${URL}/api/effort/${A}`, { method: 'POST', headers: H2, body: JSON.stringify({ effort: 'low' }) });
      await fetch(`${URL}/api/model/${A}`, { method: 'POST', headers: H2, body: JSON.stringify({ model: 'haiku' }) });
      ok('KHÔNG ghi vào settings.json của Claude CLI (so NỘI DUNG)',
        docCLI() === truoc, truoc ? 'nội dung giữ nguyên' : 'không đọc được file');

      // xoá cài đặt riêng -> quay về mặc định chung
      await fetch(`${URL}/api/perm/${A}`, { method: 'POST', headers: H2, body: JSON.stringify({ mode: '' }) });
      await fetch(`${URL}/api/effort/${A}`, { method: 'POST', headers: H2, body: JSON.stringify({ effort: '' }) });
      const hA2 = await su('/api/history/' + A);
      ok('xoá cài đặt riêng thì quay về mặc định chung',
        hA2.perm === null && hA2.effortDat === null && !!hA2.permHieuLuc,
        `đặt riêng=[${hA2.perm},${hA2.effortDat}] hiệu lực=${hA2.permHieuLuc}/${hA2.effortHieuLuc}`);

      // giá trị lạ phải bị từ chối
      const xau = await fetch(`${URL}/api/perm/${A}`, {
        method: 'POST', headers: H2, body: JSON.stringify({ mode: 'linh-tinh' }),
      });
      ok('từ chối chế độ quyền không hợp lệ', xau.status === 400, 'HTTP ' + xau.status);

      /* Giá trị mới bổ sung cho khớp CLI. Mỗi cái đã chạy thử thật bằng
         `claude -p ... --permission-mode X` trước khi đưa vào — `--help` liệt kê
         KHÔNG có nghĩa là dùng được (bài học `--effort auto`: CLI in
         "Unknown --effort value 'auto' — ignoring it" rồi chạy mức khác). */
      for (const mode of ['auto', 'dontAsk']) {
        const r = await fetch(`${URL}/api/perm/${A}`, {
          method: 'POST', headers: H2, body: JSON.stringify({ mode }),
        });
        const j = await r.json().catch(() => ({}));
        ok(`nhận chế độ quyền "${mode}" (giá trị thật của CLI)`,
          r.status === 200 && j.mode === mode, 'HTTP ' + r.status + ' ' + JSON.stringify(j.mode));
      }
      // `manual` là ALIAS của `default` -> cố tình KHÔNG nhận, tránh hai mục cùng nghĩa
      const alias = await fetch(`${URL}/api/perm/${A}`, {
        method: 'POST', headers: H2, body: JSON.stringify({ mode: 'manual' }),
      });
      ok('bỏ "manual" vì trùng nghĩa với "default"', alias.status === 400, 'HTTP ' + alias.status);

      const ef = await fetch(`${URL}/api/effort/${A}`, {
        method: 'POST', headers: H2, body: JSON.stringify({ effort: 'ultracode' }),
      });
      ok('nhận mức nghĩ "ultracode"', ef.status === 200, 'HTTP ' + ef.status);
      // dọn: trả phiên về mặc định để bài sau không chạy trên trạng thái đã đổi
      await fetch(`${URL}/api/perm/${A}`, { method: 'POST', headers: H2, body: JSON.stringify({ mode: '' }) });
      await fetch(`${URL}/api/effort/${A}`, { method: 'POST', headers: H2, body: JSON.stringify({ effort: '' }) });
    }
  }

  /* ---- lệnh slash của Claude CLI ----
     CLI có hàng chục lệnh nhưng phần lớn CHỈ chạy trong phiên tương tác — gọi qua `-p`
     thì trả "… isn't available in this environment". Đã thử từng cái, ra nội dung thật:
     /usage /model /context /cost /mcp /doctor /config /agents, và đợt sau thêm
     /effort /recap /insights /list-agents /autocompact.
     Đưa vào bảng một lệnh rồi bấm ra lỗi còn tệ hơn không có nó, nên bài này chốt
     những lệnh ĐANG quảng cáo trong bảng đều chạy được. */
  {
    const chay = async (cmd) => {
      const r = await fetch(`${URL}/api/claude/run`, {
        method: 'POST',
        headers: { 'X-Dash-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd }),
      });
      const j = await r.json().catch(() => ({}));
      return { ok: !!j.ok, out: String(j.output || j.error || '') };
    };
    for (const c of ['/usage', '/model']) {
      const r = await chay(c);
      const chan = /isn't available|Unknown command/i.test(r.out);
      ok(`lệnh ${c} trả nội dung thật (không bị CLI chặn)`,
        r.ok && r.out.length > 20 && !chan,
        r.out.replace(/\s+/g, ' ').slice(0, 60));
    }
  }

  /* ---- tự cập nhật: /api/capnhat ----
     Hai cách cài -> hai lệnh cập nhật khác nhau (npm i -g / git pull). Server phải TỰ
     nhận ra, vì người bấm nút trên điện thoại không nhìn thấy máy đang chạy kiểu nào. */
  {
    const r = await fetch(`${URL}/api/capnhat/trangthai`, { headers: { 'X-Dash-Token': token } });
    const j = await r.json().catch(() => ({}));
    ok('/api/capnhat/trangthai nhận ra kiểu cài',
      r.status === 200 && (j.kieu === 'git' || j.kieu === 'npm'),
      `${r.status} kiểu=${j.kieu} bản=${j.banHienTai}`);

    if (j.kieu === 'git') {
      ok('bản git: có mã commit và cờ sạch/bẩn',
        !!j.git && typeof j.git.ma === 'string' && typeof j.git.sach === 'boolean',
        JSON.stringify(j.git));

      /* Cây có sửa chưa commit -> PHẢI từ chối. `git pull` lúc đó có thể xung đột
         giữa chừng, để lại cây dở dang mà người bấm không hay vì họ đang ở điện thoại,
         không nhìn thấy terminal. Chỉ kiểm khi cây đang bẩn thật. */
      if (j.git && !j.git.sach) {
        const c = await fetch(`${URL}/api/capnhat/chay`, {
          method: 'POST', headers: { 'X-Dash-Token': token, 'Content-Type': 'application/json' }, body: '{}',
        });
        const cb = await c.json().catch(() => ({}));
        ok('cây git bẩn: từ chối cập nhật, nói rõ file nào',
          c.status === 500 && /chưa commit/.test(cb.error || ''),
          c.status + ' ' + (cb.error || '').split('\n')[0].slice(0, 60));
      }
    }

    // GET không được đổi trạng thái máy — chạy cập nhật phải là POST
    const g = await fetch(`${URL}/api/capnhat/chay`, { headers: { 'X-Dash-Token': token } });
    ok('/api/capnhat/chay không nhận GET', g.status === 404, 'HTTP ' + g.status);
  }

  /* ---- /api/plan: CÙNG chốt chặn với /api/file ----
     Chỗ này từng tự viết luật riêng (resolve + startsWith + endsWith('.md')) và thủng
     y hệt — đã đo thật: symlink tên `x.md` trong ~/.claude/plans trỏ tới
     ~/.ssh/id_ed25519_<tên> trả về nguyên khoá riêng; trỏ tới ~/.zsh_history trả 6.130
     ký tự; hard link cũng lọt. Đuôi `.md` không cứu được gì vì tên symlink do người
     tấn công đặt. Bài cũ chỉ bắn `../` nên xanh suốt trong khi ba đường kia mở toang. */
  {
    const PLANS = path.join(os.homedir(), '.claude', 'plans');
    if (!fs.existsSync(PLANS)) {
      ok('có thư mục kế hoạch để kiểm', true, '(máy này chưa có ~/.claude/plans — bỏ qua)');
    } else {
      const docPlan = async (p) => {
        const r = await fetch(`${URL}/api/plan?path=${encodeURIComponent(p)}`,
          { headers: { 'X-Dash-Token': token } });
        return { code: r.status, body: await r.text() };
      };
      const moi = path.join(os.homedir(), 'moi-plan-kiem.txt');
      const rac = ['zz-kiem-link.md', 'zz-kiem-hl.md'].map((f) => path.join(PLANS, f));
      const donPlan = () => {
        for (const f of rac) { try { fs.unlinkSync(f); } catch {} }
        try { fs.unlinkSync(moi); } catch {}
      };
      donPlan();
      try {
        // symlink .md trỏ ra ngoài — dùng file mồi, không đụng khoá thật
        fs.writeFileSync(moi, 'BI-MAT-NGOAI-PLANS-' + 'z'.repeat(40) + '\n');
        let coLink = false, coHl = false;
        try { fs.symlinkSync(moi, rac[0]); coLink = true; } catch {}
        try { fs.linkSync(moi, rac[1]); coHl = true; } catch {}

        if (coLink) {
          const r = await docPlan(rac[0]);
          ok('/api/plan chặn symlink .md trỏ ra ngoài (đã THỦNG thật)',
            !/BI-MAT/.test(r.body), r.code + ' ' + r.body.slice(0, 46));
        }
        if (coHl) {
          const r = await docPlan(rac[1]);
          ok('/api/plan chặn hard link .md (đã THỦNG thật)',
            !/BI-MAT/.test(r.body), r.code + ' ' + r.body.slice(0, 46));
        }
        // và file kế hoạch thật vẫn phải đọc được
        const that = fs.readdirSync(PLANS).filter((f) => f.endsWith('.md') && !f.startsWith('zz-kiem'))[0];
        if (that) {
          const r = await docPlan(path.join(PLANS, that));
          ok('/api/plan vẫn đọc được file kế hoạch thật',
            r.code === 200 && r.body.length > 20, r.code + ' ' + r.body.length + ' ký tự');
        }
      } finally { donPlan(); }
    }
  }

  const fails = results.filter((r) => !r.pass);
  console.log('\n==== DỰ ÁN: ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR', e);
  process.exit(2);
});
