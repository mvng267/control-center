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
  index.js      định tuyến + logic (46 endpoint)
  tools.js      tool_use/tool_result -> dữ liệu cho thẻ tool
  config.js     hằng số dùng chung
  http-utils.js json, readBody, hostAllowed
bin/control.js  điểm vào khi cài bằng npm (--port, --version, --help)
web-next/       GIAO DIỆN CHÍNH — Next.js 16 + React 19 + Tailwind v4 + shadcn/ui
  out/          bản build tĩnh — ĐƯỢC COMMIT, server phục vụ ở cùng cổng 7799
web/legacy/     giao diện cũ — đường lui, bật bằng NEW_UI=0
tests/          ui-new (giao diện mới), e2e (bản cũ), du-an (server), may-moi, push
docs/           FEATURES.md (bảng kiểm), CLAUDE-DATA.md (cấu trúc ~/.claude), CAI-DAT.md
```

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
