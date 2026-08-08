# Bảng kiểm tính năng

Danh sách mọi tính năng đã tích luỹ qua 25 commit, kèm cách kiểm thủ công.

**Vì sao cần file này:** khi viết lại frontend, selector gãy thì test đỏ ngay — biết liền. Nhưng một tính năng biến mất thì **không gì báo cả**. Đây là lưới an toàn: sau mỗi bước di trú, tick lại từng mục.

Cột **Test** ghi `e2e` nếu đã có assertion tự động; `tay` nếu phải kiểm thủ công.

---

## Tab CLAUDE — danh sách phiên

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 1 | Danh sách phiên realtime qua SSE (2s/nhịp) | Mở tab, chạy 1 task → dòng mới hiện trong ~2s | e2e |
| 2 | Không nhấp nháy khi cập nhật | Để yên 5s, dòng phiên phải là **cùng một node DOM** | e2e |
| 3 | Tiêu đề phiên thật (`ai-title` của CLI) | Danh sách hiện tên có nghĩa, không phải mã hex | e2e |
| 4 | Đổi tên phiên | Bấm tiêu đề ở đầu khung chat → sửa → Lưu; để trống = về tên CLI | e2e |
| 5 | Tìm kiếm + lọc theo dự án | Gõ vào ô tìm, chọn dropdown dự án | e2e |
| 6 | Badge chưa đọc + badge trên tab | Để phiên chạy xong khi đang ở tab khác | e2e |
| 7 | Chọn bằng bàn phím `j`/`k`/`Enter` | Nhấn j/k di chuyển, Enter mở | e2e |
| 8 | Kéo-để-làm-mới (mobile) | Ở đỉnh danh sách, kéo xuống >70px | e2e |
| 9 | Jobs bar (loop/cron đang chạy) | `/loop 30s test` → thanh hiện | e2e |

## Tab CLAUDE — khung chat

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 10 | Gửi tin, Claude trả lời | Gõ tin → có phản hồi | tay |
| 11 | **Tool card** đóng/mở | Tap card → mở ra INPUT + KẾT QUẢ | e2e |
| 12 | Trạng thái tool ✓/✗/đang chạy/ngắt | Xem chip màu ở mỗi card | e2e |
| 13 | Cập nhật chip tại chỗ khi tool xong | Card đang mở phải **giữ nguyên**, chỉ chip đổi | e2e |
| 14 | Ảnh trong tool_result hiện thật | Card Read ảnh → thấy ảnh, tap xem full | e2e |
| 15 | Diff màu cho Edit (xanh thêm/đỏ bớt) | Mở card Edit | e2e |
| 16 | Gộp lượt + gộp đoạn text liền kề | Lượt dài không bị xé thành nhiều bong bóng | e2e |
| 17 | Thời gian + vạch ngăn ngày | Dưới mỗi lượt có giờ; đổi ngày có vạch | e2e |
| 18 | Nút Copy trong khối code | Mở tool card → bấm Copy | e2e |
| 19 | Window trượt (phiên >30 tin) | Phiên dài, gửi tin mới → vẫn nhận được | e2e |
| 20 | `/clear` không kéo lại tin cũ | `/clear` → gửi tin mới → chỉ thấy tin mới | e2e |
| 21 | Banner lỗi khi chạy hỏng | Mở phiên có thư mục gốc đã xoá → gửi tin | tay |
| 22 | Dừng giữa chừng (nút ⏹ / Esc / `/stop`) | Khi đang chạy, bấm Dừng | e2e |
| 23 | **Duyệt kế hoạch** | Bật "Duyệt trước" → giao task → bấm ✓ Duyệt | tay |
| 24 | **Gửi ảnh** từ điện thoại | Bấm 📎 → chọn ảnh → gửi | e2e |
| 25 | **Model riêng từng phiên** | Bấm chip model ở header → chọn | e2e |
| 26 | So sánh 2 phiên (split view) | Bấm nút compare → chọn 2 phiên | e2e |
| 27 | Export .md/.json + copy clipboard | Bấm nút tải ở header chat | e2e |
| 28 | `/cost` — token đã dùng | Gõ `/cost` | e2e |
| 29 | `/compact` — dọn ngữ cảnh | Gõ `/compact` | e2e |
| 30 | Bàn phím ảo iOS không che input | Mở chat trên iPhone, focus ô nhập | tay |

## Tab HERMES

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 31 | Danh sách hội thoại | Mở tab | e2e |
| 32 | Gửi/nhận tin | Gõ tin → có phản hồi | tay |
| 33 | Giữ tin qua F5 (localStorage, 60 tin/hội thoại) | Gửi tin → F5 → vẫn còn | e2e |
| 34 | Export hội thoại | Bấm nút export | e2e |
| 35 | Bong bóng `role: tool` (tím, monospace) | Mở hội thoại có tool | tay |

## Tab AGY-PROXY

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 36 | Thẻ trạng thái (chạy/dừng, cổng, CHẠY NGOÀI) | Mở tab | e2e |
| 37 | Start / Stop / Restart | Bấm nút (mờ khi proxy chạy ngoài) | e2e |
| 38 | Thanh phân bổ 498 tài khoản | Xem thanh màu + chú thích | e2e |
| 39 | Lưu lượng 24h (request/lỗi/token/biểu đồ giờ) | Xem khối "Lưu lượng 24 giờ" | e2e |
| 40 | Cảnh báo khi tỉ lệ lỗi ≥20% | Xem banner đỏ | e2e |
| 41 | Models gom nhóm + tìm kiếm + tô sáng | Gõ vào ô tìm model | e2e |
| 42 | Typecheck / Test / Build | Bấm nút, xem chip kết quả | e2e |
| 43 | Log realtime, tô màu lỗi/cảnh báo | Bấm Start, xem log chảy | e2e |
| 44 | Sửa config `.env` | Sửa field → Save | e2e |

## Tab STATS

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 45 | 4 thẻ số (total/active/idle/msgs) | Mở tab | e2e |
| 46 | Donut theo dự án + Bar theo tin nhắn | Xem biểu đồ có dữ liệu | e2e |

## Toàn cục

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 47 | **Token truy cập** | Mở từ máy khác không token → hiện màn nhập mã | e2e |
| 48 | Link `?t=` tự điền + tự dọn URL | Mở link có `?t=` → vào thẳng, URL sạch | tay |
| 49 | Công tắc quyền 4 nấc | Bấm chip → xoay vòng | e2e |
| 50 | Command palette ⌘K + gõ `/` | Nhấn ⌘K | e2e |
| 51 | Lịch sử lệnh ↑/↓ | Gõ vài lệnh → nhấn ↑ | e2e |
| 52 | Phím tắt ⌘1-4, chord `g a`/`g s`, Esc | Nhấn thử | e2e |
| 53 | Vuốt ngang chuyển tab (mobile) | Vuốt trái/phải | e2e |
| 54 | **Web Push** (báo khi đóng tab) | Đóng tab → chạy task → chờ thông báo | tay |
| 55 | Thông báo dùng tiêu đề phiên | Xem nội dung thông báo | e2e |
| 56 | Toast + rung phản hồi | Bấm tool card (rung 10ms) | tay |
| 57 | PWA "Thêm vào Màn hình chính" | Safari → Chia sẻ → Thêm | tay |
| 58 | **Offline** — app vẫn mở, có banner | Bật chế độ máy bay → mở app | e2e |
| 59 | Glass design + 2 theme sáng/tối | Xem giao diện | e2e |
| 60 | Safe-area iPhone (notch + home indicator) | Xem tab bar dưới | tay |
| 61 | `/model` toàn cục, `/theme`, `/help`, `/jobs`, `/summary`, `/enhance` | Gõ từng lệnh | tay |
| 62 | Loop + cron job | `/loop 30s test`, `/schedule` | tay |

---

## Cách dùng khi di trú

1. Trước khi bắt đầu: chạy `node e2e-test.js`, lưu output làm mốc.
2. Sau **mỗi bước**: chạy lại, so với mốc.
3. Ở bước cuối (B5c): mở trên **iPhone thật**, tick tay toàn bộ mục ghi `tay`.
4. Mục nào không tick được → dừng, sửa xong mới đi tiếp.
