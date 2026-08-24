# Hướng dẫn cho Claude Code

Đọc file này trước khi sửa. Nó ghi lại **bẫy đã gặp thật** — không phải mô tả lại code.

## Chạy và kiểm

```bash
node src/server/index.js          # hoặc npm start — cổng 7799
node scripts/khoi-dong-lai.js     # dừng bản cũ, khởi động lại, CHỜ server lên thật
node scripts/test-all.js          # chạy tất cả, mỗi bộ ở đúng môi trường của nó
node scripts/verify.js            # cú pháp server + client + chốt token
cd web-next && npm run build      # bắt buộc sau khi sửa giao diện
```

**Sửa giao diện xong PHẢI build lại.** `web-next/out` được commit và được gói vào npm —
sửa mã nguồn mà quên build thì bản chạy thật vẫn là bản cũ.

Từng mất gần một giờ vì tiến trình cũ còn nghe cổng 7799 trong khi mã đã có endpoint
mới: panel dựng ra rỗng, test đỏ, mà log restart nhìn thì tưởng xong. Dùng
`scripts/khoi-dong-lai.js` — nó kiểm `/api/tree` sau khi khởi động, 404 nghĩa là tiến
trình cũ chưa chết.

## Kiến trúc

```
src/server/     backend Node THUẦN, zero dependency
  index.js      TẤT CẢ: định tuyến, logic, hằng số, json/readBody/hostAllowed
  tools.js      tool_use/tool_result -> dữ liệu cho thẻ tool
bin/control.js  điểm vào khi cài bằng npm (--port, --version, --autostart, --help)
web-next/       GIAO DIỆN CHÍNH — Next.js 16 + React 19 + Tailwind v4 + shadcn/ui
  out/          bản build tĩnh — ĐƯỢC COMMIT, server phục vụ ở cùng cổng 7799
web/legacy/     giao diện cũ — CHỈ CÒN ĐỂ THAM KHẢO, xem cảnh báo bên dưới
tests/          ui-new (giao diện mới), e2e (bản cũ), du-an (server), may-moi, push
docs/           FEATURES.md (bảng kiểm), CLAUDE-DATA.md (cấu trúc ~/.claude), CAI-DAT.md
```

**`web/legacy` KHÔNG còn là đường lui dùng được.** Chạm lần cuối 13/8/2026, từ đó
72 commit (34 cái `feat:`). Nó không biết 14 endpoint mới — resume, an, fav,
duyet-quyen, tim, imgs, pg, docker, quota, claude, plan, files, cauhinh, capnhat. Bật
`NEW_UI=0` giờ ra một bản MẤT một nửa tính năng, không phải bản dự phòng. Giữ lại chỉ
vì `tests/e2e.js` (147 assertion, phần lớn phủ tab AGY) chưa chuyển sang `ui-new.js`.
Chuyển xong thì xoá cả hai.

**Từng có `config.js` và `http-utils.js` trong `src/server/` — KHÔNG AI require chúng.**
Mọi hằng số và `json`/`readBody`/`hostAllowed` đều được định nghĩa lại trong
`index.js`. Hai file sống 284 dòng code chết mà tài liệu này mô tả như kiến trúc thật,
nên ai đọc cũng tưởng phải sửa ở đó. Đã xoá.

**Một tiến trình, một cổng.** Frontend là static export do chính server Node phục vụ —
bắt buộc, vì Web Push và service worker vỡ nếu tách hai cổng khi vào từ điện thoại qua
Tailscale.

## Bẫy đã gặp — đọc trước khi sửa

**Loopback được miễn token.** Mọi lỗi phân quyền chỉ lộ khi vào từ MÁY KHÁC. Ba lần đã
xảy ra: `EventSource` không gửi được header nên `/stream` trả 401; `<img src>` cũng vậy
nên 52 ảnh vỡ hết; `PasscodeGate` gọi `fetch` trần nên không mở khoá được từ xa. Kiểm
bằng IP thật (LAN hoặc Tailscale), đừng chỉ kiểm `localhost`. `scripts/verify.js` có
bước quét chặn việc này ở mức mã nguồn.

**Chặn đường dẫn phải chạm đĩa.** `path.resolve` chỉ xử lý chuỗi. Symlink trong dự án
trỏ ra ngoài từng đọc được nguyên khoá SSH riêng; hard link cũng lọt vì nó không phải
link. Mọi endpoint đọc file phải đi qua `moFileAnToan()` trong `src/server/index.js` —
đừng viết luật riêng, `/api/plan` và `/api/file` đã thủng cùng một kiểu vì mỗi nơi tự
viết một bản.

**Trạng thái giao diện khoá theo mốc thời gian, KHÔNG theo chỉ số.** Server chỉ trả 30
tin gần nhất, cửa sổ đó trượt mỗi khi có tin mới nên mọi chỉ số tụt đi một. Dùng chỉ số
thì cứ 2 giây mất sạch trạng thái (đã xảy ra với thẻ tool và bảng câu hỏi). Khoá là
`tsDau` — mốc đầu lượt.

**`.tap44` tạo lớp phủ 44px bằng `::after`.** Đặt lên phần tử cao ~20px thì vùng chạm
tràn lên hàng xóm và nuốt nút của nó (Playwright báo "element intercepts pointer
events"). Hàng ngắn thì nới bằng đệm thật.

**KHÔNG sửa file `.jsonl` của Claude CLI.** Đó là dữ liệu gốc, CLI ghi đè bất cứ lúc
nào. Thứ dashboard cần lưu để ở `~/.claude/dashboard-*.json`.

**`settings.json` bị chính Claude CLI ghi lại mỗi lần chạy `claude -p`.** Đo được:
mtime nhảy 8 giây sau đúng một lệnh, trong khi dashboard không đụng gì. Nên bài test
nào canh "dashboard có ghi vào settings.json không" mà đo `mtime` sẽ **dương tính
giả** — và dashboard lại có endpoint gọi `claude -p /usage` (tab Hạn mức), nên chỉ cần
mở tab đó là đỏ oan. Đo **nội dung** file, đừng đo mốc thời gian.

**`src/server/index.js` có một byte NUL, nên `grep` THƯỜNG trả rỗng mà không báo lỗi.**
Byte đó nằm ở `khoa = a.hookName + '\0' + body` — dấu phân cách chủ ý trong khoá gộp
hook lỗi, hoàn toàn hợp lệ. Nhưng `file` xếp cả file là *binary data*, nên `grep permFor`
trả về **rỗng, exit 1**, đúng như thể hàm đó không tồn tại. Đã vài lần kết luận nhầm
"không tìm thấy hàm" vì lý do này. **Luôn dùng `grep -a`** với file này.

**Test nhảy kết quả giữa các lần chạy = server cũ còn nghe cổng test.** Cùng một commit
đã chạy ra 68/69, rồi 53/68, rồi 190/190, rồi TimeoutError — đọc mã không thấy sai vì mã
không sai. Bắt được thật: một tiến trình giữ cổng 7797 suốt 12 phút, và một `test-all`
cũ vẫn chạy nền. Bộ test mới bind cổng thất bại rồi lặng lẽ nói chuyện với server CŨ (mã
cũ, khoá VAPID cũ). `scripts/test-all.js` giờ có `donCong()` dọn trước khi chạy — nếu
vẫn thấy kết quả nhảy, kiểm `lsof -ti:7896,7897,7797` trước khi nghi mã.

**`npm run build` xanh KHÔNG có nghĩa là mã sạch — phải chạy `npx eslint`.** Một đợt
sửa giao diện qua build với "TypeScript 0 lỗi" ở cả 4 lỗi sau: `useState` gọi sau một
early return (hook có điều kiện — state lượt này nhảy sang lượt khác), gán biến trong
`.map()` của JSX (React chạy lại map mà không dựng lại hàm, cả khối diff tô sai màu),
bốn import chết, và một file 63 dòng không nơi nào import. Lint bắt hết trong 30 giây.
Cách đo nợ mới: `npx eslint components lib app --ext .ts,.tsx` rồi so số lỗi/cảnh báo
với commit trước — bằng nhau mới là không để lại nợ.

**`animate-tho` đè mọi `bg-*` đặt trên cùng phần tử.** Animation đặt
`background-color` ở mỗi khung hình nên nó thắng class nền tĩnh. Thẻ phiên vừa ĐANG
CHẠY vừa ĐANG MỞ có đủ `border-primary bg-accent/50` mà `getComputedStyle` vẫn trả về
màu nhịp thở — nhìn trên màn thì không biết mình đang đọc phiên nào. Dấu tô sáng phải
dùng thuộc tính animation KHÔNG đụng tới: viền trái dày. `ring-*` cũng không được vì
thẻ có `transition-colors`, mà box-shadow không nằm trong danh sách đó.

**Nhiều phần tử cùng `sticky top-0` thì CHỒNG lên nhau, không đẩy nhau.** Đã cho mọi
lượt user `sticky top-0` để câu hỏi dính đầu khung — cuộn phiên dài ra một chồng box
xếp lớp che hết nội dung. CSS chỉ đẩy nhau khi các phần tử sticky nằm trong những khối
cha KHÁC nhau. Muốn giữ đúng MỘT dòng trên cùng (kiểu Claude CLI) thì phải vẽ một thanh
riêng rồi tự tính xem lượt nào đã cuộn qua mép trên — xem `cau-dinh` trong
`chat-view.tsx`.

**Chú thích JSX `{/* … */}` KHÔNG đặt được giữa các thuộc tính.** Viết
`{...(a ? {x:1} : {})}` rồi chèn chú thích ngay sau là cú pháp hỏng — Turbopack báo
`Expected '</', got '}'`, mà thông báo đó không chỉ ra dòng thật. Tệ hơn: có lần build
vẫn qua nhưng thuộc tính KHÔNG được render, nên selector trong test tìm mãi không thấy
và mất một vòng truy lỗi. Đặt chú thích TRƯỚC thẻ, hoặc dùng `/* … */` trần giữa các
thuộc tính.

**Tin mang vai `user` chưa chắc do người gõ.** Claude CLI nhét `<task-notification>`,
`<system-reminder>`, `<command-name>`, `<local-command-stdout>`,
`<local-command-caveat>`, `<user-prompt-submit-hook>` vào cùng `type: 'user'`. Đo trên
phiên control: 16% lượt user là loại này. Vẽ giống nhau thì khung chat hiện
"mvng: <task-notification>…", đọc như chính mình gõ ra. Dùng `loaiTuDong()` trong
`index.js`; câu mở đầu bằng `<` mà không khớp mẫu nào thì CỨ coi là người gõ — giấu
nhầm câu thật tệ hơn để lọt vài tin máy.

**Máy nghẽn làm test đỏ mà đọc mã không thấy sai.** Đo thật: tải 14–24 trên 8 core,
riêng `WindowServer` ăn 130% CPU. Bộ test đỏ ở `waitForSelector 20000ms` trong khi mở
tay cùng trang thì mọi thứ hiện đủ, không lỗi JS. `tests/ui-new.js` giờ đặt hạn chờ
mặc định 60s cho cả bộ. Playwright bị ngắt giữa chừng còn để lại Chrome mồ côi —
`test-all` tự dọn, hoặc chạy `lsof -ti:7896,7897` rồi `ps | grep ms-playwright`.
**Bài test lấy `ss[0]` là bài test ngẫu nhiên.** Danh sách phiên xoay theo thời gian nên
phiên đầu lúc là dự án thật, lúc là phiên chạy ở thư mục nhà (server chặn đọc file →
cả khối đỏ), lúc là phiên chỉ toàn câu chữ (không có tool → bài đòi icon đỏ). Lọc theo
điều kiện bài đó CẦN, đừng lấy phần tử đầu.

**`hostAllowed` không phải cơ chế bảo mật** — nó chỉ đọc header `Host` mà client tự
khai được. Token mới là.

**Client JS của `web/legacy` dùng chung scope.** 14 file nạp bằng thẻ `<script>` tuần
tự, không phải module. Biến dùng xuyên file phải khai ở `js/core.js` (nạp đầu tiên).
`npm run verify` có bước quét chặn.

## Quy ước

- **Backend zero dependency.** Web Push tự cài đặt VAPID + RFC 8291. Không thêm package.
- **Comment giải thích LÝ DO**, không mô tả lại code. Ghi cả số đo thật nếu có.
- **Không viết cứng thông tin cá nhân.** Tên người dùng lấy từ `os.userInfo()`, đường
  dẫn lấy từ `os.homedir()`. Repo này công khai.
- **Mỗi tính năng mới kèm test** trong cùng lượt, không để sau.
- Base UI dùng prop `render`, KHÔNG dùng `asChild`.
- Giao diện và tài liệu bằng tiếng Việt.

## Test

`test-all` tự bật hai server ở cổng riêng (7896 cho bản cũ, 7897 cho bản mới) rồi tắt —
không đụng server 7799 đang dùng. Cần vậy vì `e2e.js` viết cho giao diện **cũ** (tìm
`#sidenav`, `#bubbles`), chạy nhầm vào giao diện mới là treo rồi ném TimeoutError, nhìn
như code hỏng trong khi chỉ sai môi trường.

`test:ui` gọi Claude **thật** để kiểm luồng nhắn tin nên hơi lâu — thêm `SKIP_CHAT=1`
để bỏ qua phần đó.

Vài bài đỏ vì **môi trường**, không phải lỗi code: Docker daemon tắt, agy-proxy chưa có
request nào trong ngày, Postgres không chạy. `test-all` nói rõ điều đó.

Sửa lớn thì tick lại `docs/FEATURES.md` — test bắt được selector gãy, KHÔNG bắt được
tính năng biến mất.
