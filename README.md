# Claude Control Center

Dashboard quản lý **Claude CLI sessions**, **Hermes chat** và **agy-proxy** trong một tab. Tối ưu cho iPhone, truy cập qua Tailscale.

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

---

## Cấu trúc

```
src/server/        backend Node thuần (zero dependency)
web/               giao diện
tests/             test tự động (cần playwright-core)
scripts/           tiện ích: verify, bench, check-procs
docs/
  FEATURES.md      bảng kiểm 62 tính năng — dùng khi sửa lớn
  CLAUDE-DATA.md   cấu trúc ~/.claude, dashboard đọc/ghi gì
RULES.md           quy tắc thiết kế (mobile là ưu tiên cao nhất)
```

## Test

```bash
npm run setup      # cài playwright-core (một lần)
npm test           # e2e: 147 assertion, 2 viewport
npm run test:push  # Web Push (VAPID + RFC 8291)
npm run verify     # kiểm tra cú pháp cả server lẫn client JS
```

`npm run verify` bắt được lỗi cú pháp trong JS phía trình duyệt — thứ `node -c` không thấy.

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

---

## Ghi chú kỹ thuật

- **Zero dependency ở backend** — chỉ dùng thư viện chuẩn của Node. Web Push tự cài đặt VAPID + RFC 8291.
- **Mã truy cập là bắt buộc** với mọi request từ ngoài máy. `hostAllowed` chỉ đọc header `Host` (client tự khai được) nên **không phải** cơ chế bảo mật — mã mới là.
- Dashboard **không sửa** file `.jsonl` của Claude CLI. Mọi thứ cần lưu để ở `dashboard-*.json` riêng.
- Chi tiết dữ liệu: [docs/CLAUDE-DATA.md](docs/CLAUDE-DATA.md).
