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

**Nếu báo lỗi quyền** (`EACCES`, "you do not have the permissions") — nghĩa là
`npm root -g` trỏ vào thư mục hệ thống. Đừng dùng `sudo`: nó tạo file thuộc `root`
trong thư mục của bạn, lần cập nhật sau lại vướng tiếp. Đổi sang thư mục nhà:

```bash
npm config set prefix ~/.local
mkdir -p ~/.local/bin
npm i -g claude-control-center
```

Kiểm `control` đã vào PATH chưa: `which control`. Chưa thấy thì thêm dòng này vào
`~/.bashrc` (hoặc `~/.zshrc`) rồi mở terminal mới:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Cập nhật: `npm i -g claude-control-center@latest`, hoặc bấm nút **Cập nhật** trong màn
cấu hình (bấm vào ô tên ở chân thanh bên) — server tự nhận ra cài bằng npm hay clone
git rồi chạy đúng lệnh.

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

### Autostart khi đăng nhập (launchd)

```bash
launchctl load ~/Library/LaunchAgents/com.mvng.control.plist
```

Lần sau bật máy, dashboard tự chạy nền. Kiểm bằng:

```bash
launchctl list | grep control       # phải thấy "com.mvng.control"
```

Xem log:

```bash
tail -f /tmp/control.log
```

Tắt autostart:

```bash
launchctl unload ~/Library/LaunchAgents/com.mvng.control.plist
```

---

## Debian (server) — cài bằng npm

Toàn bộ phần này đã chạy thật trên Debian (Node v18.20.4), không phải viết theo trí nhớ.

**1. Cài** — dùng `~/.local` để không cần `sudo`:

```bash
ssh mvng@<địa-chỉ-server>

npm config set prefix ~/.local
mkdir -p ~/.local/bin
npm i -g claude-control-center

~/.local/bin/control --version     # phải in ra số phiên bản
```

**2. Chạy nền bằng systemd** (toàn bộ — root cài một lần):

```bash
sudo tee /etc/systemd/system/control.service > /dev/null << 'EOF'
[Unit]
Description=Claude Control Center Dashboard
After=network.target

[Service]
Type=simple
User=mvng
ExecStart=/home/mvng/.local/bin/control --port 7799
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=control

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable control
sudo systemctl start control
```

**3. Kiểm**:

```bash
sudo systemctl status control --no-pager    # phải in "active (running)"
curl -s http://127.0.0.1:7799/api/tree     # phải có {"ok":true,...}
sudo journalctl -u control -f               # xem log real-time
```

**Cập nhật** về sau — bấm nút **Cập nhật** trong màn cấu hình (giao diện tự nhận cài
bằng npm hay git rồi chạy đúng lệnh), hoặc tay:

```bash
npm i -g claude-control-center@latest
sudo systemctl restart control
```

### Nếu đang chạy bản clone git

Gỡ trước cho khỏi hai bản tranh cổng 7799. Dữ liệu ở `~/.claude` **không** bị đụng —
nhưng cứ sao lưu cho chắc:

```bash
cp -a ~/.claude/dashboard-*.json ~/dashboard-backup/   # mã truy cập, mã khoá, cấu hình

sudo systemctl stop control
sudo systemctl disable control
rm -rf ~/control-center        # hoặc ~/control, tuỳ chỗ đã clone
```

Rồi làm lại từ bước 1. Cài xong, mã truy cập và mã khoá cũ vẫn dùng được vì chúng nằm
ở `~/.claude`, không nằm trong thư mục mã.

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
Đổi cổng thì đặt `PORT=7800`. Trên Debian không có `lsof` thì dùng `ss -lntp | grep 7799`.

**`npm i -g` báo lỗi quyền** — xem mục npm ở đầu trang: đổi `prefix` sang `~/.local`,
đừng dùng `sudo`.

**Gõ `control` báo "command not found"** sau khi cài xong — `~/.local/bin` chưa có
trong `PATH`. Kiểm bằng `echo $PATH | tr ':' '\n' | grep local`. Thêm vào `~/.bashrc`
rồi mở terminal mới. Cách chắc ăn không cần PATH: gõ thẳng
`~/.local/bin/control`.

**Icon trắng khi "Thêm vào Màn hình chính"** trên bản npm **1.0.0** — icon PWA trả 404
vì gói thiếu thư mục chứa icon. Sửa ở **1.0.1**: `npm i -g claude-control-center@latest`.

**Tab Hermes / Agy Proxy không thấy đâu** — đúng như thiết kế. Máy không có `~/.hermes`
hay thư mục `agy-proxy` thì tab tự tắt, vì mở ra cũng chỉ thấy lỗi. Bật lại trong màn
cấu hình (bấm ô tên ở chân thanh bên) nếu cài chúng sau.

**Panel xem file báo "phiên này chạy ở thư mục nhà"** — đúng như thiết kế. Phiên chạy
thẳng ở `~` thì "thư mục dự án" là cả thư mục nhà (4000 file lẫn Desktop, Documents,
Library), nên không mở cây. Mở phiên chạy trong thư mục dự án để xem mã.
