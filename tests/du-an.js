/* Test cho TÊN DỰ ÁN + hiệu năng danh sách phiên — kiểm ở mức server, không cần trình duyệt.

   Vì sao có file này: trước đợt sửa, tên dự án được SUY từ tên thư mục
   ~/.claude/projects (cắt 2 đoạn cuối nối bằng "/"), cho ra "agy/proxy",
   "dalianperfume/com" (mất chữ volvo), "plastic/", "6debb715b13d/scratchpad".
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
     Chặn kiểu sai "mất chữ": volvo.dalianperfume.com -> "dalianperfume/com",
     "Van thong plastic" -> "thong/plastic". */
  {
    // duongDan đã rút gọn $HOME thành "~" để hiện lên màn hình -> bung lại trước khi so,
    // nếu không phiên chạy ngay tại home có duongDan="~" và basename ra "~".
    // So với khoa (cwd đã chuẩn hoá), KHÔNG với duongDan: duongDan giữ nguyên đường
    // dẫn thật để hiện ra, kể cả bản gõ nhầm ".../Van thong plastic " có dấu cách cuối.
    const con = ss.filter((s) => s.duAn?.conTonTai && s.duAn.khoa?.startsWith('/'));
    const sai = con.filter((s) => path.basename(s.duAn.khoa) !== s.duAn.ten);
    ok('tên dự án = basename của cwd (chặn mất chữ "volvo", "Van")', sai.length === 0,
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
    const coModel = ss.filter((s) => s.model).length;
    ok('lấy được model từ .jsonl', coModel > ss.length / 2, coModel + '/' + ss.length + ' phiên');
  }

  /* ---------- ĐỌC THÊM: hai nhánh, kiểm bằng phiên giả tự dựng ----------
     Không thể chờ Vinh gõ để phiên thật dài ra, nên tự tạo một phiên trong
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

  const fails = results.filter((r) => !r.pass);
  console.log('\n==== DỰ ÁN: ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('SCRIPT ERROR', e);
  process.exit(2);
});
