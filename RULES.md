# Quy tắc thiết kế giao diện

Kiến trúc, lệnh chạy và bẫy kỹ thuật ở [CLAUDE.md](CLAUDE.md). File này chỉ nói về
**giao diện**.

## Điện thoại là chính

Dashboard được dùng chủ yếu trên iPhone qua Tailscale, nên mọi quyết định bố cục lấy
màn 390×844 làm chuẩn, desktop là phần nới thêm.

- Viewport: `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`
- Safe area: dùng `env(safe-area-inset-*)` cho tai thỏ và vạch home
- Vùng chạm ≥ 44px (Apple HIG), cách nhau ≥ 8px. Có sẵn lớp `.tap44` — nhưng đọc cảnh
  báo về nó trong CLAUDE.md trước khi dùng
- Ô nhập cỡ chữ 16px, nếu nhỏ hơn iOS tự phóng to trang khi chạm vào
- Không dùng tương tác chỉ-có-khi-rê-chuột: điện thoại không có hover
- Hộp thoại: toàn màn hoặc trượt từ đáy, đóng bằng nút X rõ ràng

**Chỗ hẹp nhất là thanh tab dưới.** Ở 390px nó vừa đúng 5 tab; thêm nữa là tràn ngang.
Tính năng mới nên mở dạng màn phủ (xem `man-cau-hinh.tsx`, `xem-file.tsx`), đừng thêm
tab.

## Desktop

- Sidebar 256px cố định, không viền phải
- Phím tắt: ⌘K bảng lệnh, ⌘1–5 chuyển tab, Esc thoát
- Khung chat dùng TRỌN bề ngang — không kẹp giữa màn hình. Phần lớn nội dung là log
  tool và đường dẫn dài, bó lại thì xuống dòng liên tục còn hai bên bỏ trống

## Nhìn và cảm

- Nền tối mặc định. Dashboard hay dùng ban đêm
- Icon: Lucide. Không dùng emoji thay icon
- Chữ: hệ thống cho giao diện, monospace cho nội dung chat và mã
- Hiệu ứng: chỉ fade/slide một lần (~200ms). **Không animation lặp** — mỏi mắt. Chỉ
  báo đang chạy là ngoại lệ, và phải nhẹ
- Dựng lại DOM ổn định: chỉ cập nhật node thay đổi. Ghi đè `innerHTML` mỗi nhịp poll
  làm cả trang nháy, mà nhịp là 2 giây một lần

## Không được làm

- **Không có nút xoá** container/image/volume Docker — dữ liệu thật nằm trong đó, bấm
  nhầm trên điện thoại là mất
- Không viết cứng tên người, đường dẫn máy, hay địa chỉ IP vào giao diện — repo công khai
- Không để nút bấm không ra gì. `npm run buttons` quét chặn việc này
