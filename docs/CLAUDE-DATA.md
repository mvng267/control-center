# Cấu trúc dữ liệu `~/.claude`

Dashboard đọc/ghi trực tiếp vào thư mục này. Ghi lại đây để dựng lại được trên máy mới.

> ⚠️ **KHÔNG commit thư mục này lên git.** Lý do cụ thể ở cuối file.

---

## Toàn cảnh

```
~/.claude/
├── .credentials.json          🔴 TOKEN ĐĂNG NHẬP Claude — tuyệt đối không chia sẻ
├── settings.json              cấu hình chung (model, quyền, hooks…)
├── settings.local.json        cấu hình riêng máy này
├── hooks/                     script tự động hoá
├── plans/           120K      kế hoạch do plan mode sinh ra
├── projects/        206M ⚠️   TOÀN BỘ nội dung hội thoại — 15 dự án, 142 phiên
├── file-history/    9.7M      lịch sử sửa file (để undo)
├── sessions/                  metadata phiên
├── backups/ cache/ debug/ ide/  tạm, tự sinh
│
└── ── dashboard tạo ra ──
    ├── dashboard-token.json   🔴 mã truy cập dashboard
    ├── dashboard-titles.json  tên phiên tự đặt
    ├── dashboard-models.json  model riêng từng phiên
    ├── dashboard-perm.json    chế độ quyền (acceptEdits/plan/…)
    └── dashboard-uploads/     ảnh gửi từ điện thoại (tự dọn sau 7 ngày / 200 ảnh)
```

---

## Dashboard dùng những gì

### Chỉ đọc

**`projects/<thư-mục-dự-án>/<session-id>.jsonl`** — nguồn dữ liệu chính.
Tên thư mục là đường dẫn dự án với `/` đổi thành `-`. Mỗi dòng là một JSON:

| `type` | Ý nghĩa | Dashboard dùng để |
|---|---|---|
| `user` / `assistant` | nội dung hội thoại | dựng bong bóng chat, tool card |
| `ai-title` | tiêu đề CLI tự sinh | hiện tên phiên (lấy bản **mới nhất**) |
| còn lại | queue-operation, attachment, file-history… | bỏ qua |

Trường quan trọng trong dòng `user`/`assistant`:
- `cwd` — **thư mục làm việc của phiên**. Bắt buộc phải có để `--resume` chạy đúng chỗ; sai là tin nhắn rơi vào hư không.
- `message.usage` — token đã dùng (`input_tokens`, `output_tokens`, `cache_read_input_tokens`…) → dùng cho `/cost`.
- `message.content[]` — mảng block: `text`, `thinking`, `tool_use` (có `id`, `name`, `input`), `tool_result` (có `tool_use_id`, `content`, `is_error`).

Ghép `tool_use` ↔ `tool_result` theo `tool_use_id`, làm trên **toàn file** trước khi cắt cửa sổ 30 tin — nếu không, tool ở đầu cửa sổ sẽ mất kết quả.

**`~/.agyproxy/data/`** (ngoài `.claude`, phục vụ tab AGY):
- `accounts.csv` — 498 tài khoản, cột `status_agy` / `status_kiro` / `last_run`
- `state.db` — SQLite, bảng `gateway_usage` ghi từng request (`ts`, `model`, token, `ok`, `ms`, `status`)

### Đọc và ghi

| File | Nội dung | Sinh ra khi |
|---|---|---|
| `dashboard-token.json` | `{"token":"..."}` | lần chạy đầu, tự sinh ngẫu nhiên |
| `dashboard-titles.json` | `{"<sid>":"tên tự đặt"}` | bấm đổi tên phiên |
| `dashboard-models.json` | `{"<sid>":"opus"}` | chọn model riêng phiên |
| `dashboard-perm.json` | `{"mode":"acceptEdits"}` | bấm công tắc quyền |
| `dashboard-uploads/` | ảnh gửi từ điện thoại | bấm 📎 |

Dashboard **không bao giờ sửa file `.jsonl`** — đó là dữ liệu gốc của Claude CLI, có thể bị ghi đè bất cứ lúc nào. Mọi thứ dashboard cần lưu đều để ở file `dashboard-*.json` riêng.

Một file nữa nằm trong repo, không phải ở đây: `.push-state.json` (khoá VAPID + danh sách thiết bị nhận thông báo) — đã gitignore.

---

## Dựng lại trên máy mới

Cần mang theo (nếu muốn giữ nguyên trạng):

| Việc | File |
|---|---|
| Đăng nhập lại | chạy `claude` rồi đăng nhập — **đừng chép `.credentials.json`** |
| Giữ cấu hình | `settings.json`, `hooks/` |
| Giữ tên phiên / model đã đặt | `dashboard-titles.json`, `dashboard-models.json` |
| Giữ mã dashboard cũ | `dashboard-token.json` — hoặc để trống cho nó sinh mã mới |
| Giữ lịch sử hội thoại | `projects/` — 206MB, chỉ chép nếu thật sự cần |

Không chép gì cả thì dashboard vẫn chạy: nó tự sinh mã mới, tự đọc các phiên đang có.

---

## Vì sao không đưa lên git

Tôi đã kiểm tra thực tế trước khi khuyến nghị:

1. **`.credentials.json` chứa token đăng nhập Claude.** Ai có file này dùng được tài khoản. Git giữ lịch sử vĩnh viễn — xoá file ở commit sau **không** gỡ được khỏi lịch sử.
2. **`projects/` nặng 206MB, 142 phiên chứa toàn bộ nội dung hội thoại** — gồm cả mật khẩu, đường dẫn nội bộ, mã nguồn từng dán vào. GitHub cũng cảnh báo với file lớn.
3. **`dashboard-token.json` là mã vào dashboard**, mà dashboard giao được việc cho Claude ở chế độ tự sửa file.

Repo private cũng không đủ an toàn: lỡ tay đổi sang public là lộ hết, và lịch sử thì không xoá được.

**Cách đúng:** git giữ mã nguồn; dữ liệu cá nhân sao lưu riêng (iCloud, ổ ngoài) sau khi đã loại `.credentials.json` và `dashboard-token.json`.
