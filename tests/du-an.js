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
    const coModel = ss.filter((s) => s.model).length;
    ok('lấy được model từ .jsonl', coModel > ss.length / 2, coModel + '/' + ss.length + ' phiên');
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

  /* ---------- Chốt chặn đường dẫn của /api/file ----------
     Đây là endpoint DUY NHẤT trong app đọc file tuỳ ý theo đường dẫn gửi từ ngoài vào.
     Thủng nó là dashboard thành công cụ đọc trộm cả đĩa — mà máy này mở trên tailnet.
     Ba lớp: resolve + phải nằm trong cwd; danh sách cấm; trần 512KB.
     KHÔNG dựa vào việc quetFile() bỏ file ẩn: hàm đó phục vụ gợi ý "@", ai sửa nó là
     chốt chặn thủng lúc đó. Nên test bắn thẳng đường dẫn, không lấy từ cây. */
  {
    const snap = await snapshot();
    const ss = (snap.data.sessions || []).filter((s) => s.duAn && s.duAn.conTonTai && !s.duAn.laNhap);
    const phien = ss[0];
    if (!phien) {
      ok('có phiên để kiểm chốt chặn /api/file', false, 'không tìm được phiên nào có cwd thật');
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
         quy tắc quyền đã duyệt + hook + plugin; ghi hỏng là người dùng mất hết. */
      const fCLI = path.join(os.homedir(), '.claude', 'settings.json');
      let moiSua = 999;
      try { moiSua = (Date.now() - fs.statSync(fCLI).mtimeMs) / 1000; } catch {}
      ok('KHÔNG ghi vào settings.json của Claude CLI',
        moiSua > 30, Math.round(moiSua) + 's kể từ lần sửa cuối');

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
    }
  }

  /* ---- lệnh slash của Claude CLI ----
     CLI có 40 lệnh nhưng phần lớn CHỈ chạy trong phiên tương tác — gọi qua `-p` thì
     trả "… isn't available in this environment". Đã thử từng cái: chỉ /usage, /model,
     /context, /cost, /mcp, /doctor, /config, /agents là ra nội dung thật.
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
