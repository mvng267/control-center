#!/bin/sh
# Cập nhật control-center trên Debian. Chạy lại nhiều lần vô hại.
#
# Prerequisite: đã cài sẵn bằng `npm i -g claude-control-center` (bản 1.0.0 trở lên)
# và service chạy dưới systemd --user.
#
# Vì sao có script này thay vì bấm nút Cập nhật trong dashboard: nút đó kéo từ npm
# registry, nên chỉ chạy được SAU khi bản mới đã publish. Script hỗ trợ cả đường
# npm lẫn đường cài trực tiếp từ tarball khi chưa publish kịp.
#
#   sh cap-nhat-debian.sh              # kéo bản mới nhất trên npm
#   sh cap-nhat-debian.sh ./goi.tgz    # cài từ file .tgz chép sang (chưa publish)

set -eu

GOI="${1:-}"
SV=control-center

echo "==> bản đang chạy:"
control --version 2>/dev/null || echo "   (chưa cài hoặc lệnh control không có trong PATH)"

if [ -n "$GOI" ]; then
  [ -f "$GOI" ] || { echo "!! không thấy file $GOI"; exit 1; }
  echo "==> cài từ tarball: $GOI"
  npm i -g "$GOI"
else
  echo "==> kéo bản mới nhất từ npm"
  npm i -g claude-control-center@latest
fi

echo "==> bản sau khi cài:"
control --version

# Service có thể chưa được tạo (cài tay, chạy bằng nohup). Không có thì bỏ qua,
# đừng để `set -e` giết script ở đây.
if systemctl --user list-unit-files 2>/dev/null | grep -q "^$SV"; then
  echo "==> khởi động lại $SV"
  systemctl --user restart "$SV"
  sleep 2
  systemctl --user is-active "$SV" >/dev/null 2>&1 \
    && echo "==> $SV đang chạy" \
    || { echo "!! $SV KHÔNG lên — xem log:"; journalctl --user -u "$SV" -n 20 --no-pager; exit 1; }
else
  echo "==> không thấy service $SV, tự khởi động lại tiến trình đang nghe cổng 7799"
  pkill -f "claude-control-center" 2>/dev/null || true
  echo "   (chạy lại bằng: control &)"
fi

# Chốt cuối: server phải trả lời thật, không chỉ "tiến trình còn sống".
echo "==> kiểm server trả lời"
for i in $(seq 1 20); do
  if curl -sf -o /dev/null http://127.0.0.1:7799/api/tree 2>/dev/null; then
    echo "==> OK: server trả lời trên cổng 7799"
    exit 0
  fi
  sleep 1
done
echo "!! server không trả lời sau 20 giây"
exit 1
