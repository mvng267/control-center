# Bảng kiểm tính năng

Danh sách mọi tính năng đã tích luỹ qua 25 commit, kèm cách kiểm thủ công.

**Vì sao cần file này:** khi viết lại frontend, selector gãy thì test đỏ ngay — biết liền. Nhưng một tính năng biến mất thì **không gì báo cả**. Đây là lưới an toàn: sau mỗi bước di trú, tick lại từng mục.

Cột **Test** ghi `e2e` nếu đã có assertion trong `tests/e2e.js`; `pw` nếu kiểm bằng
Playwright (giao diện mới); `tay` nếu phải kiểm thủ công trên máy/iPhone thật.

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
| 10 | Gửi tin, Claude trả lời | `node tests/ui-new.js` (nhắn thật) | ui-new |
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
| 32 | Gửi/nhận tin | Gõ tin → có phản hồi | ui-new |
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
| 48 | Link `?t=` tự điền + tự dọn URL | Mở link có `?t=` → vào thẳng, URL sạch | ui-new |
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
| 62 | Loop + cron job | `/loop 30s test`, `/schedule` | ui-new |

---

## Giao diện mới (Next.js, kiểu Atlas)

Các mục dưới đây CHỈ có ở bản mới. Bản cũ (`NEW_UI=0`) không có, nên không đưa vào
`tests/e2e.js` — kiểm bằng Playwright riêng, xem cột Test.

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 63 | Page header 4/4 tab (tiêu đề + số đếm + mô tả + nút) | Xem đầu mỗi tab | pw |
| 64 | Dải tóm tắt trên bảng phiên, bấm để lọc | Bấm "Đang chạy" → chỉ còn phiên đang chạy | pw |
| 65 | Menu ⋯ mỗi dòng: mở / tải .md / dừng | Bấm ⋯ ở một dòng | pw |
| 66 | Lối tắt "Xem nhanh" lọc thật, không chỉ đổi tab | Bấm "Phiên đang chạy" ở sidebar | pw |
| 67 | Chế độ quyền 4 nấc **trong khung chat** | Mở phiên → nút khiên ở header | pw |
| 68 | Nút ảnh nằm cạnh ô nhắn tin | Mở phiên → nhìn trái ô nhập | pw |
| 69 | Tin của mình hiện ngay (~50ms), không đợi server | Gửi tin, bấm giờ | pw |
| 70 | Nhịp poll co giãn: 700ms khi chạy, 2s khi rảnh | Xem Network lúc Claude chạy | ui-new |
| 71 | Thanh việc-đang-làm (TodoWrite mới nhất) | Mở phiên đang chạy có todo | pw |
| 72 | Gõ `/` trong ô chat → gợi ý lệnh, ↑↓/Tab/Esc | Gõ `/` rồi `/comp` | pw |
| 73 | Bàn phím ảo iOS không che ô nhập (`--kb`) | iPhone thật: chạm ô nhập | tay |
| 74 | Kéo-để-làm-mới + vuốt ngang chuyển tab | iPhone thật | pw |
| 75 | AGY: log thời gian thực tô màu, tạm dừng/xoá | Bật agy từ dashboard | tay |
| 76 | AGY: sửa `.env` tại chỗ, báo khi cần Restart | Đổi `PORT` → hiện nhắc Restart | tay |
| 77 | Hermes: tên hội thoại rút gọn + tin đầu làm phụ đề | Xem tab Hermes | pw |
| 78 | Hermes: ô tìm hội thoại | Gõ vào ô tìm | pw |
| 79 | Badge % đổi màu theo NGHĨA (thẻ Lỗi tăng = đỏ) | Xem thẻ Lỗi ở tab AGY | pw |
| 80 | Không còn nút chết | `node scripts/dead-buttons.js` | pw |
| 81 | Thẻ tool mở ra KHÔNG tự đóng khi poll | mở thẻ, đợi 10s, `data-open` vẫn true | pw |
| 82 | Chat kiểu CLI: avatar + nhãn vai + tool thụt lề | đếm `msg-avatar`, `msg-role`; tool L > bong bóng L | pw |
| 83 | Thẻ "Suy nghĩ" gập được, không đổ hết ra màn | `think-card` mặc định `data-open=false` | pw |
| 84 | So sánh 2 phiên (lệnh ⌘K mở thật, không toast lạc đề) | ⌘K → ui:compare → `compare-view` | pw |
| 85 | Tóm tắt phiên qua /api/summary | menu ⋯ → Tóm tắt → `summary-dialog` | pw |
| 86 | Hook lỗi / lỗi API / mốc /compact hiện trong chat | `note-line` xuất hiện ở phiên có hook lỗi | pw |
| 87 | Lịch sử lệnh ↑/↓ trong ô chat | gõ ↑ ra tin cũ, ↓ quay lại | pw |
| 88 | Chart đúng số đo Atlas | lưới `4 8`, 0 trục Y, badge 12px/bo 6px | pw |
| 89 | Vỏ khớp Atlas | sidebar 256/không viền, mục 32px/bo 8px, header 64px | pw |
| 90 | Mọi nút ≥ 44px vùng chạm trên cảm ứng | quét `button` ở 390px, không cái nào < 44 | pw |
| 91 | Mã khoá chặn CẢ loopback | `curl localhost/api/jobs` → 423 khi đã đặt mã | curl |
| 92 | Mã sai rồi mã đúng vẫn vào được (ô được xoá) | gõ sai → `passcode-dots` về 0 → gõ đúng → vào | pw |
| 93 | Chống dò mã: sai ≥5 lần phải chờ | 7 lần sai liên tiếp → 429 | curl |
| 94 | Quên mã: xoá file passcode là mở lại | `rm ~/.claude/dashboard-passcode.json` + restart | ui-new |
| 95 | Docker: xem/bật/tắt/khởi động lại/log | tab Docker → `dk-row`, bấm `dk-start` | pw |
| 96 | Docker chặn lệnh nguy hiểm | action rm/kill/exec/run → từ chối; id có `;` → từ chối | curl |
| 97 | Docker KHÔNG có nút xoá container/volume | không tồn tại testid nào cho xoá | ui-new |
| 98 | 5 tab vừa màn 320px | mỗi tab 64px, chữ không tràn | pw |
| 99 | Việc nền gập lại khi rảnh, tự mở khi có job | `jobs-toggle` | pw |
| 100 | Nút bật/tắt thông báo ở header | bấm `notify-toggle` → `data-state` đổi bat/tat | pw |
| 101 | Bật đúng MỘT đăng ký (không trùng) | bật 1 lần → `.push-state.json` có đúng 1 sub | pw |
| 102 | Tắt rồi KHÔNG tự bật lại khi focus | tắt → phát sự kiện focus → vẫn 0 sub | pw |

---

## Chạy test

```bash
node scripts/verify.js          # cú pháp + thứ tự nạp
node scripts/dead-buttons.js    # nút bấm không ra gì
node tests/ui-new.js            # GIAO DIỆN MỚI — 40 mục (server ở 7799)
SKIP_CHAT=1 node tests/ui-new.js # bỏ qua phần nhắn thật cho nhanh
NEW_UI=0 PORT=7895 node src/server/index.js &   # rồi:
DASH_URL=http://localhost:7895/ node tests/e2e.js   # bản cũ, 147 mục
node tests/push.js              # Web Push, 19 mục
```

`tests/ui-new.js` tự đặt/gỡ mã khoá trong lúc chạy và dọn sạch sau đó — nhưng nếu
nó bị ngắt giữa chừng thì có thể để sót `~/.claude/dashboard-passcode.json`. Xoá
file đó là gỡ khoá.

## Cách dùng khi di trú

1. Trước khi bắt đầu: chạy `node e2e-test.js`, lưu output làm mốc.
2. Sau **mỗi bước**: chạy lại, so với mốc.
3. Ở bước cuối (B5c): mở trên **iPhone thật**, tick tay toàn bộ mục ghi `tay`.
4. Mục nào không tick được → dừng, sửa xong mới đi tiếp.
