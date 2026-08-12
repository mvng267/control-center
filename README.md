# Claude Control Center

Dashboard quản lý **Claude CLI**, **Hermes**, **agy-proxy** và **Docker** trong một tab.
Tối ưu cho iPhone, truy cập qua Tailscale. Giao diện theo mẫu
[Atlas](https://atlas-admin.reui.io/products).

---

## Chạy

```bash
node src/server/index.js       # hoặc: npm start
```

Mở `http://localhost:7799`. Backend **không cần cài gì cả** — Node thuần, zero dependency.

Lần chạy đầu server tự sinh **mã truy cập** và in ra:

```
claude-dashboard listening on http://localhost:7799
  mã truy cập: xxxxxxxxxxxxx
  mở nhanh trên máy khác: http://<ip>:7799/?t=xxxxxxxxxxxxx
```

Mã lưu ở `~/.claude/dashboard-token.json`, giữ nguyên qua các lần khởi động.

## Vào từ iPhone

1. Lấy địa chỉ Tailscale: `tailscale ip -4` (dạng `100.x.x.x`)
2. Mở link kèm mã: `http://100.x.x.x:7799/?t=<mã>` — vào thẳng, URL tự dọn mã
3. Safari → **Chia sẻ** → **Thêm vào Màn hình chính** để chạy như app

Máy trong cùng Wi-Fi thì thay bằng IP LAN.

## Khoá bằng mã số

Mã truy cập ở trên chặn người **từ mạng**. Nhưng request từ chính máy này (localhost)
được miễn — ai cầm máy mở trình duyệt vào `localhost:7799` là vào thẳng.

Muốn chặn cả trường hợp đó: bấm **Tạo mã khoá** ở chân thanh bên trái, đặt mã 4–12
chữ số. Từ đó mọi truy cập đều phải nhập mã, kể cả từ chính máy.

- Mã lưu dạng băm scrypt ở `~/.claude/dashboard-passcode.json` (quyền `600`) — **không
  lưu mã thật**.
- Sai từ 5 lần trở lên phải chờ, thời gian chờ tăng gấp đôi mỗi lần.
- **Quên mã:** `rm ~/.claude/dashboard-passcode.json` — có hiệu lực trong 2 giây,
  không cần khởi động lại.

---

## Cấu trúc

```
src/server/        backend Node thuần, zero dependency
  index.js         định tuyến + logic (44 endpoint)
  tools.js         tool_use/tool_result -> dữ liệu cho tool card
  config.js        hằng số dùng chung
  http-utils.js    json, readBody, hostAllowed
web-next/          GIAO DIỆN CHÍNH — Next.js + shadcn/ui, kiểu Atlas
  app/ components/ lib/
  out/             bản build tĩnh (được commit)
web/legacy/        giao diện cũ — đường lui, bật bằng NEW_UI=0
tests/             ui-new (109, giao diện mới), e2e (147, bản cũ), push (19),
                   push-browser, keyboard, safearea
scripts/           test-all, verify, dead-buttons, make-icons, bench, check-procs
docs/
  FEATURES.md      bảng kiểm 102 tính năng — dùng khi sửa lớn
  CLAUDE-DATA.md   cấu trúc ~/.claude, dashboard đọc/ghi gì
RULES.md           quy tắc thiết kế + bẫy đã gặp
```

### Sửa giao diện

```bash
cd web-next
npm install        # lần đầu (~590MB, chỉ cần khi SỬA giao diện)
npm run dev        # hot reload ở cổng 3000, API vẫn gọi sang 7799
npm run build      # xong thì build lại vào out/
```

`web-next/out` **được commit**, nên trên máy mới chỉ cần `node src/server/index.js` là chạy — không phải cài gì.

**Quay về giao diện cũ:** `NEW_UI=0 node src/server/index.js`. Bản cũ nằm ở `web/legacy/`, vẫn hoạt động đầy đủ.

## Test

```bash
npm run setup      # cài playwright-core (một lần)
npm run test:all   # chạy TẤT CẢ — tự bật server ở cổng riêng cho từng bộ

npm run verify     # cú pháp server lẫn client JS
npm run buttons    # tìm nút bấm không ra gì
npm run test:ui    # GIAO DIỆN MỚI: 109 mục (cần server đang chạy ở 7799)
npm test           # bản cũ: 147 assertion — PHẢI chạy với NEW_UI=0
npm run test:push  # Web Push (VAPID + RFC 8291)
```

`npm run verify` bắt lỗi cú pháp trong JS phía trình duyệt — thứ `node -c` không thấy.

`test:all` tự bật hai server (cổng 7896 cho bản cũ, 7897 cho bản mới) rồi tắt sau khi
xong — không đụng server 7799 đang dùng. Cần vậy vì `e2e.js` viết cho giao diện **cũ**
(tìm `#sidenav`, `#bubbles`), chạy nhầm vào giao diện mới là treo rồi ném TimeoutError,
nhìn như code hỏng trong khi chỉ là sai môi trường.

Bài "agy lưu lượng 24h" hỏng khi agy-proxy chưa có request nào trong ngày — đó là do
**môi trường**, không phải lỗi code; `test:all` sẽ nói rõ điều đó.

`test:ui` gọi Claude **thật** để kiểm luồng nhắn tin, nên hơi lâu. Thêm `SKIP_CHAT=1`
để bỏ qua phần đó. Nó cũng tự đặt rồi gỡ mã khoá trong lúc chạy; nếu bị ngắt giữa
chừng mà để sót thì xoá `~/.claude/dashboard-passcode.json`.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `7799` | cổng |
| `DASH_TOKEN` | tự sinh | mã truy cập (ghi đè file) |
| `AGY_DIR` | `~/Desktop/project/agy-proxy` | thư mục agy-proxy |
| `HERMES_BIN` | `~/.hermes/.../hermes` | đường dẫn Hermes CLI |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | tự sinh | khoá Web Push |

## Sự cố thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Cổng bận | `PORT=7800 npm start`, hoặc `npm run procs` tìm tiến trình sót |
| Quên mã | Xem `~/.claude/dashboard-token.json` hoặc log khởi động |
| Vào bị 401 | Thiếu mã — mở lại bằng link `?t=<mã>` |
| Push không chạy | Cần https hoặc localhost (yêu cầu của trình duyệt) |
| Chat không gửi được | Thư mục gốc của phiên đã bị xoá — dashboard sẽ báo rõ trong khung chat |
| Quên **mã khoá** (khác mã truy cập) | `rm ~/.claude/dashboard-passcode.json` |
| Tab Docker báo "Docker không phản hồi" | Docker Desktop đang tắt — bật lên rồi tải lại trang |
| Không nhận được thông báo | Bấm nút chuông ở góc phải header để bật |

---

## Ghi chú kỹ thuật

- **Zero dependency ở backend** — chỉ dùng thư viện chuẩn của Node. Web Push tự cài đặt VAPID + RFC 8291.
- **Mã truy cập là bắt buộc** với mọi request từ ngoài máy. `hostAllowed` chỉ đọc header `Host` (client tự khai được) nên **không phải** cơ chế bảo mật — mã mới là.
- Dashboard **không sửa** file `.jsonl` của Claude CLI. Mọi thứ cần lưu để ở `dashboard-*.json` riêng.
- **Docker**: chỉ cho xem / bật / tắt / khởi động lại / đọc log / dọn build cache.
  **Không có nút xoá** container, image hay volume — dữ liệu thật nằm trong đó, bấm
  nhầm trên điện thoại là mất. Server tra bảng lệnh cứng, client không truyền cờ tự do.
- Chi tiết dữ liệu: [docs/CLAUDE-DATA.md](docs/CLAUDE-DATA.md).
