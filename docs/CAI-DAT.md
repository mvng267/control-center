# Cài đặt — Mac và Debian

Dashboard đọc dữ liệu từ `~/.claude` của Claude CLI **trên chính máy chạy nó**.
Cài lên máy chưa dùng Claude CLI thì mở ra sẽ trống — đó không phải lỗi.

Cần: `git`, `node >= 18`. **Không cần `npm install`** — backend không có dependency
nào, và `web-next/out` đã build sẵn trong repo.

---

## Cách nhanh nhất — npm

Không cần Homebrew, không cần git:

```bash
npm i -g claude-control-center
control                    # cổng 7799; đổi bằng --port 8080
```

Cập nhật: `npm i -g claude-control-center@latest`, hoặc bấm nút **Cập nhật** trong màn
cấu hình (bấm vào ô tên ở chân thanh bên).

## Mac — qua Homebrew

```bash
brew tap mvng267/control https://github.com/mvng267/control-center
brew install --HEAD mvng267/control/control
```

Chạy nền, tự bật lại khi đăng nhập:

```bash
brew services start control
```

| việc | lệnh |
|---|---|
| xem log | `tail -f "$(brew --prefix)/var/log/control.log"` |
| khởi động lại | `brew services restart control` |
| dừng | `brew services stop control` |
| cập nhật | `brew upgrade --fetch-HEAD mvng267/control/control` rồi `brew services restart control` |

Chạy một lần ở tiền cảnh (không qua services): `control`

## Mac — chạy thẳng từ repo

Nếu không muốn qua Homebrew, hoặc đang sửa mã:

```bash
cd ~/Desktop/project/control
node scripts/khoi-dong-lai.js
```

Script dừng tiến trình cũ trên cổng 7799, khởi động lại, **chờ tới khi server trả lời
thật**, rồi kiểm `/api/tree` có mặt chưa. Chạy lại nhiều lần vô hại.

Vì sao cần bước kiểm cuối: đã mất gần một giờ vì tiến trình cũ vẫn nghe cổng 7799
trong khi mã đã có endpoint mới — panel xem file dựng ra cây rỗng, test đỏ, mà nhìn
log restart thì tưởng xong.

---

## Debian (server)

Lần đầu:

```bash
ssh <tên>@<địa-chỉ-server>
git clone https://github.com/mvng267/control-center.git ~/control
cd ~/control
node src/server/index.js          # chạy thử, Ctrl+C để dừng
```

Những lần sau, chỉ cần:

```bash
cd ~/control && bash scripts/cap-nhat-debian.sh
```

Script tự làm theo thứ tự: dừng bản cũ → `git pull` → kiểm cú pháp → khởi động lại →
chờ server lên → kiểm endpoint mới đã nạp chưa. Dừng lại báo lỗi nếu có bước nào hỏng,
và **không** kéo nếu trên máy còn thay đổi chưa commit (không nuốt mất công sửa tay).

Chạy nền lâu dài thì dùng systemd — không phụ thuộc phiên SSH:

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/control.service <<'EOF'
[Unit]
Description=Claude Control Center
After=network.target

[Service]
ExecStart=/usr/bin/node %h/control/src/server/index.js
WorkingDirectory=%h/control
Environment=PORT=7799
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now control
loginctl enable-linger "$USER"   # chạy tiếp cả khi đã đăng xuất SSH
```

Kiểm: `systemctl --user status control` · log: `journalctl --user -u control -f`

`cap-nhat-debian.sh` tự nhận ra systemd và dùng `systemctl --user restart` thay vì
giết tiến trình trần.

---

## Vào dashboard

Mã truy cập sinh ở lần chạy đầu, lưu tại `~/.claude/dashboard-token.json`:

```bash
cat ~/.claude/dashboard-token.json
```

Mở link kèm mã — sau lần đầu trình duyệt tự nhớ, mã được xoá khỏi thanh địa chỉ:

```
http://<ip>:7799/?t=<mã>
```

Lấy IP Tailscale: `tailscale ip -4`

**Loopback được miễn mã**, nên `http://localhost:7799` vào thẳng. Từ máy khác thì
bắt buộc có mã — đây là lý do vài lỗi trước chỉ lộ khi vào từ iPhone chứ không lộ
khi thử ở localhost.

### Thêm lớp mã khoá (tuỳ chọn)

Mã truy cập ở trên chặn người **từ mạng ngoài**, nhưng ai ngồi trước máy mở
`localhost` thì vào thẳng. Muốn chặn cả trường hợp đó: bấm **Tạo mã khoá** trong
app, đặt mã số. Mã lưu dạng băm scrypt, không lưu mã thật.

---

## Trục trặc thường gặp

**Mở ra trống, không có phiên nào** — máy đó chưa dùng Claude CLI, `~/.claude/projects`
rỗng. Dashboard không tạo dữ liệu, chỉ đọc.

**"Mất kết nối — dữ liệu đang hiển thị là bản cũ"** — thường là vào từ máy khác mà
thiếu `?t=<mã>`. Kiểm bằng:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<ip>:7799/api/passcode/status
# 401 = thiếu mã, 200 = ổn
```

**Sửa mã rồi mà giao diện không đổi** — tiến trình cũ còn sống. Dùng
`node scripts/khoi-dong-lai.js` (Mac) hoặc `bash scripts/cap-nhat-debian.sh` (Debian),
cả hai đều kiểm bước này và báo lỗi thay vì im lặng.

**Cổng 7799 đã bị chiếm**: `lsof -ti:7799 -sTCP:LISTEN` để xem pid.
Đổi cổng thì đặt `PORT=7800`.

**Panel xem file báo "phiên này chạy ở thư mục nhà"** — đúng như thiết kế. Phiên chạy
thẳng ở `~` thì "thư mục dự án" là cả thư mục nhà (4000 file lẫn Desktop, Documents,
Library), nên không mở cây. Mở phiên chạy trong thư mục dự án để xem mã.
