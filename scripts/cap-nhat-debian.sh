#!/usr/bin/env bash
# Cập nhật dashboard trên máy Debian. Chạy ĐƯỢC NHIỀU LẦN, không hỏng gì nếu chạy lại.
#
# Cách chạy (trên máy Debian, qua SSH):
#   bash scripts/cap-nhat-debian.sh
#
# Cần sẵn: git, node >= 18 (đã rà src/: API mới nhất dùng tới là fetch()).
# KHÔNG cần npm install — backend zero dependency và web-next/out đã build sẵn trong repo.
set -euo pipefail

THU_MUC="${THU_MUC:-$HOME/control}"
CONG="${PORT:-7799}"

cd "$THU_MUC"

echo "==> Thư mục: $(pwd)"
echo "==> Bản hiện tại: $(git rev-parse --short HEAD) ($(git log -1 --format=%s | cut -c1-60))"

# Có sửa tay trên server thì dừng lại, đừng nuốt mất công của người ta
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "!! Có thay đổi chưa commit trên máy này. Xem 'git status' rồi tự quyết." >&2
  git status --short >&2
  exit 1
fi

echo "==> Kéo bản mới"
git pull --ff-only

echo "==> Bản sau khi kéo: $(git rev-parse --short HEAD) ($(git log -1 --format=%s | cut -c1-60))"

# Kiểm cú pháp trước khi khởi động lại — thà không restart còn hơn restart vào bản hỏng
echo "==> Kiểm cú pháp"
node --check src/server/index.js
node scripts/verify.js

# Dừng bản đang chạy. Ba đường, tuỳ máy cài kiểu nào:
#   1) systemd  2) pm2  3) tiến trình trần
if systemctl --user list-units --type=service 2>/dev/null | grep -q '^\s*control'; then
  echo "==> Khởi động lại qua systemd (user)"
  systemctl --user restart control
elif command -v pm2 >/dev/null 2>&1 && pm2 list 2>/dev/null | grep -q control; then
  echo "==> Khởi động lại qua pm2"
  pm2 restart control
else
  echo "==> Khởi động lại tiến trình trần"
  # Chỉ giết tiến trình CHÍNH của dashboard, không đụng node khác trên máy
  pkill -f "node .*control/src/server/index.js" || true
  sleep 1
  PORT="$CONG" nohup node src/server/index.js > "$THU_MUC/dashboard.log" 2>&1 &
  disown || true
fi

echo "==> Chờ server lên"
for i in $(seq 1 20); do
  if curl -sf -o /dev/null "http://127.0.0.1:$CONG/api/passcode/status"; then
    echo "==> OK: server trả lời trên cổng $CONG (sau ${i}s)"
    break
  fi
  [ "$i" = 20 ] && { echo "!! Server KHÔNG lên sau 20s. Xem $THU_MUC/dashboard.log" >&2; exit 1; }
  sleep 1
done

# Kiểm bản mới ĐÃ THẬT SỰ nạp, không phải tiến trình cũ còn sống.
# Vừa gặp trên Mac: server cũ vẫn nghe cổng 7799 nên /api/tree trả 404 dù mã đã có.
TOKEN="$(node -e "try{console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.claude/dashboard-token.json','utf8')).token)}catch{}" 2>/dev/null || true)"
if [ -n "$TOKEN" ]; then
  MA="$(curl -s -o /dev/null -w '%{http_code}' -H "X-Dash-Token: $TOKEN" "http://127.0.0.1:$CONG/api/tree?sid=kiem-tra" || true)"
  if [ "$MA" = "404" ]; then
    echo "!! /api/tree trả 404 — tiến trình CŨ vẫn đang chạy, bản mới chưa nạp." >&2
    exit 1
  fi
  echo "==> Endpoint mới có mặt (/api/tree -> HTTP $MA)"
fi

# Địa chỉ vào từ iPhone
IP_TS="$(tailscale ip -4 2>/dev/null | head -1 || true)"
[ -n "$IP_TS" ] && echo "==> Vào từ iPhone: http://$IP_TS:$CONG"
echo "==> Xong."
