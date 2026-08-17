#!/bin/sh
# Chẩn đoán vì sao dashboard trên Debian vẫn hiện bản cũ sau khi bấm Cập nhật.
#
# Phân biệt ba chuyện hay bị lẫn:
#   1. npm đã cài bản mới vào ĐĨA chưa
#   2. TIẾN TRÌNH đang chạy là mã nào (nạp vào RAM lúc khởi động, không đổi theo đĩa)
#   3. lệnh `control` trong PATH trỏ vào đâu
#
# Bấm Cập nhật chỉ làm việc 1. Chưa khởi động lại thì việc 2 vẫn là mã cũ, nên
# dashboard vẫn hiện version cũ dù đĩa đã có bản mới.

set -u

echo "=============================================="
echo " 1. npm — bản trên ĐĨA"
echo "=============================================="
npm ls -g claude-control-center --depth=0 2>/dev/null || echo "   (không thấy gói cài toàn cục)"
echo
echo "   lệnh control trỏ vào:"
command -v control 2>/dev/null || echo "   (không có control trong PATH)"
echo
echo "   version file trên đĩa:"
GOC=$(npm root -g 2>/dev/null)/claude-control-center
if [ -f "$GOC/package.json" ]; then
  node -p "require('$GOC/package.json').version" 2>/dev/null
  echo "   thư mục: $GOC"
  echo -n "   có mã agent không: "
  grep -q "agentChay" "$GOC/src/server/index.js" 2>/dev/null && echo "CÓ" || echo "THIẾU"
else
  echo "   (không thấy $GOC/package.json)"
fi

echo
echo "=============================================="
echo " 2. TIẾN TRÌNH đang chạy"
echo "=============================================="
ps aux | grep -E "control|claude-control" | grep -v grep || echo "   (không thấy tiến trình nào)"
echo
echo "   dashboard tự khai bản nào:"
curl -s http://127.0.0.1:7799/api/capnhat/trangthai 2>/dev/null \
  | head -c 400 || echo "   (không gọi được API — server không chạy?)"
echo

echo
echo "=============================================="
echo " 3. systemd service"
echo "=============================================="
if systemctl --user list-unit-files 2>/dev/null | grep -q control-center; then
  systemctl --user status control-center --no-pager -n 5 2>/dev/null | head -12
  echo
  echo "   file service trỏ lệnh nào:"
  systemctl --user cat control-center --no-pager 2>/dev/null | grep -i "ExecStart" || true
else
  echo "   (không có service control-center dưới systemd --user)"
  echo "   -> nhiều khả năng chạy tay bằng nohup/screen, phải kill rồi chạy lại thủ công"
fi

echo
echo "=============================================="
echo " KẾT LUẬN"
echo "=============================================="
echo "So ba số ở trên:"
echo "  - đĩa mới + tiến trình cũ  -> CHỈ CẦN KHỞI ĐỘNG LẠI"
echo "  - đĩa vẫn cũ               -> npm chưa cài được, xem lỗi ở mục 1"
echo "  - control trỏ chỗ khác     -> đang chạy nhầm bản cài ở nơi khác"
