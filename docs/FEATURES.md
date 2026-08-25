# Bảng kiểm tính năng

Danh sách mọi tính năng đã tích luỹ qua 25 commit, kèm cách kiểm thủ công.

**Vì sao cần file này:** khi viết lại frontend, selector gãy thì test đỏ ngay — biết liền. Nhưng một tính năng biến mất thì **không gì báo cả**. Đây là lưới an toàn: sau mỗi bước di trú, tick lại từng mục.

Cột **Test** ghi **tên bộ test thật sự chạy mục đó** — `ui-new`, `du-an`, `push`,
`keyboard`, `safearea`, `may-moi`, `curl`; `tay` nếu phải kiểm thủ công trên
máy/iPhone thật; **`CHƯA CÓ`** nếu chưa có bài nào.

Cột này từng nói dối hai lần: 37 mục ghi `pw` (không có runner nào tên vậy) và 49
mục ghi `e2e` (bộ đó đã xoá cùng bản legacy). Đối chiếu lại bằng testid: 17 trong
số đó thật sự không có bài nào — giờ ghi `CHƯA CÓ` thay vì để tưởng đã phủ.

---

## Tab CLAUDE — danh sách phiên

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 1 | Danh sách phiên realtime qua SSE (2s/nhịp) | Mở tab, chạy 1 task → dòng mới hiện trong ~2s | ui-new |
| 2 | Không nhấp nháy khi cập nhật | Để yên 5s, dòng phiên phải là **cùng một node DOM** | ui-new |
| 3 | Tiêu đề phiên thật (`ai-title` của CLI) | Danh sách hiện tên có nghĩa, không phải mã hex | ui-new |
| 4 | Đổi tên phiên | Bấm tiêu đề ở đầu khung chat → sửa → Lưu; để trống = về tên CLI | ui-new |
| 5 | Tìm kiếm + lọc theo dự án | Gõ vào ô tìm, chọn dropdown dự án | ui-new |
| 6 | Badge chưa đọc + badge trên tab | Để phiên chạy xong khi đang ở tab khác | ui-new |
| 7 | Chọn bằng bàn phím `j`/`k`/`Enter` | Nhấn j/k di chuyển, Enter mở | ui-new |
| 8 | Kéo-để-làm-mới (mobile) | Ở đỉnh danh sách, kéo xuống >70px | tay |
| 9 | Jobs bar (loop/cron đang chạy) | `/loop 30s test` → thanh hiện | ui-new |

## Tab CLAUDE — khung chat

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 10 | Gửi tin, Claude trả lời | `node tests/ui-new.js` (nhắn thật) | ui-new |
| 11 | **Tool card** đóng/mở | Tap card → mở ra INPUT + KẾT QUẢ | ui-new |
| 12 | Trạng thái tool ✓/✗/đang chạy/ngắt | Xem chip màu ở mỗi card | ui-new |
| 13 | Cập nhật chip tại chỗ khi tool xong | Card đang mở phải **giữ nguyên**, chỉ chip đổi | ui-new |
| 14 | Ảnh trong tool_result hiện thật | Card Read ảnh → thấy ảnh, tap xem full | ui-new |
| 15 | Diff màu cho Edit (xanh thêm/đỏ bớt) | Mở card Edit | ui-new |
| 16 | Gộp lượt + gộp đoạn text liền kề | Lượt dài không bị xé thành nhiều bong bóng | ui-new |
| 17 | Thời gian + vạch ngăn ngày | Dưới mỗi lượt có giờ; đổi ngày có vạch | ui-new |
| 18 | Nút Copy trong khối code | Mở tool card → bấm Copy | ui-new |
| 19 | Window trượt (phiên >30 tin) | Phiên dài, gửi tin mới → vẫn nhận được | ui-new |
| 20 | `/clear` không kéo lại tin cũ | `/clear` → gửi tin mới → chỉ thấy tin mới | may-moi |
| 21 | Banner lỗi khi chạy hỏng | gửi vào sid không tồn tại → phải hiện banner | ui-new |
| 22 | Dừng giữa chừng (nút ⏹ / Esc / `/stop`) | Khi đang chạy, bấm Dừng | ui-new |
| 23 | **Duyệt kế hoạch** | Bật "Duyệt trước" → giao task → bấm ✓ Duyệt | ui-new |
| 24 | **Gửi ảnh** từ điện thoại | Bấm 📎 → chọn ảnh → gửi | ui-new |
| 25 | **Model riêng từng phiên** | Bấm chip model ở header → chọn | ui-new |
| 26 | So sánh 2 phiên (split view) | Bấm nút compare → chọn 2 phiên | ui-new |
| 27 | Export .md/.json + copy clipboard | Bấm nút tải ở header chat | ui-new |
| 28 | `/cost` — token đã dùng | Gõ `/cost` | du-an |
| 29 | `/compact` — dọn ngữ cảnh | Gõ `/compact` | ui-new |
| 30 | Bàn phím ảo iOS không che input | `node tests/keyboard.js` (giả lập visualViewport) | keyboard |

## Tab HERMES

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 31 | Danh sách hội thoại | Mở tab | ui-new |
| 32 | Gửi/nhận tin | Gõ tin → có phản hồi | ui-new |
| 33 | Giữ tin qua F5 (localStorage, 60 tin/hội thoại) | Gửi tin → F5 → vẫn còn | ui-new |
| 34 | Export hội thoại | Bấm nút export | ui-new |
| 35 | Bong bóng `role: tool` (tím, monospace) | Mở hội thoại có tool | ui-new |

## Tab AGY-PROXY

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 36 | Thẻ trạng thái (chạy/dừng, cổng, CHẠY NGOÀI) | Mở tab | ui-new |
| 37 | Start / Stop / Restart | Bấm nút (mờ khi proxy chạy ngoài) | ui-new |
| 38 | Thanh phân bổ 498 tài khoản | Xem thanh màu + chú thích | ui-new |
| 39 | Lưu lượng 24h (request/lỗi/token/biểu đồ giờ) | Xem khối "Lưu lượng 24 giờ" | ui-new |
| 40 | Cảnh báo khi tỉ lệ lỗi ≥20% | Xem banner đỏ | ui-new |
| 41 | Models gom nhóm + tìm kiếm + tô sáng | Gõ vào ô tìm model | ui-new |
| 42 | Typecheck / Test / Build | Bấm nút, xem chip kết quả | ui-new |
| 43 | Log realtime, tô màu lỗi/cảnh báo | Bấm Start, xem log chảy | ui-new |
| 44 | Sửa config `.env` | Sửa field → Save | ui-new |

## Tab STATS

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 45 | 4 thẻ số (total/active/idle/msgs) | Mở tab | ui-new |
| 46 | Donut theo dự án + Bar theo tin nhắn | Xem biểu đồ có dữ liệu | ui-new |

## Toàn cục

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 47 | **Token truy cập** | Mở từ máy khác không token → hiện màn nhập mã | ui-new |
| 48 | Link `?t=` tự điền + tự dọn URL | Mở link có `?t=` → vào thẳng, URL sạch | ui-new |
| 49 | Công tắc quyền 4 nấc | Bấm chip → xoay vòng | ui-new |
| 50 | Command palette ⌘K + gõ `/` | Nhấn ⌘K | ui-new |
| 51 | Lịch sử lệnh ↑/↓ | Gõ vài lệnh → nhấn ↑ | ui-new |
| 52 | Phím tắt ⌘1-4, chord `g a`/`g s`, Esc | Nhấn thử | ui-new |
| 53 | Vuốt ngang chuyển tab (mobile) | Vuốt trái/phải | ui-new |
| 54 | **Web Push** (báo khi đóng tab) | Đóng tab → chạy task → chờ thông báo | ui-new |
| 55 | Thông báo dùng tiêu đề phiên | Xem nội dung thông báo | ui-new |
| 56 | Toast + rung phản hồi | Bấm tool card (rung 10ms) | ui-new |
| 57 | PWA "Thêm vào Màn hình chính" | Safari → Chia sẻ → Thêm | safearea |
| 58 | **Offline** — app vẫn mở, có banner | Bật chế độ máy bay → mở app | ui-new |
| 59 | Glass design + 2 theme sáng/tối | Xem giao diện | ui-new |
| 60 | Safe-area iPhone (notch + home indicator) | `node tests/safearea.js` (bơm inset 34px) | safearea |
| 61 | `/model` toàn cục, `/theme`, `/help`, `/jobs`, `/summary`, `/enhance` | Gõ từng lệnh | ui-new |
| 62 | Loop + cron job | `/loop 30s test`, `/schedule` | ui-new |

---

## Giao diện mới (Next.js, kiểu Atlas)

Các mục dưới đây CHỈ có ở bản mới. Bản cũ (`NEW_UI=0`) không có, nên không đưa vào
`tests/e2e.js` — kiểm bằng Playwright riêng, xem cột Test.

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 63 | Page header 4/4 tab (tiêu đề + số đếm + mô tả + nút) | Xem đầu mỗi tab | ui-new |
| 64 | Dải tóm tắt trên bảng phiên, bấm để lọc | Bấm "Đang chạy" → chỉ còn phiên đang chạy | ui-new |
| 65 | Menu ⋯ mỗi dòng: mở / tải .md / dừng | Bấm ⋯ ở một dòng | ui-new |
| 66 | Lối tắt "Xem nhanh" lọc thật, không chỉ đổi tab | Bấm "Phiên đang chạy" ở sidebar | ui-new |
| 67 | Chế độ quyền 4 nấc **trong khung chat** | Mở phiên → nút khiên ở header | ui-new |
| 68 | Nút ảnh nằm cạnh ô nhắn tin | Mở phiên → nhìn trái ô nhập | ui-new |
| 69 | Tin của mình hiện ngay (~50ms), không đợi server | Gửi tin, bấm giờ | ui-new |
| 70 | Nhịp poll co giãn: 700ms khi chạy, 2s khi rảnh | Xem Network lúc Claude chạy | ui-new |
| 71 | Thanh việc-đang-làm (TodoWrite mới nhất) | Mở phiên đang chạy có todo | ui-new |
| 72 | Gõ `/` trong ô chat → gợi ý lệnh, ↑↓/Tab/Esc | Gõ `/` rồi `/comp` | ui-new |
| 73 | Bàn phím ảo iOS không che ô nhập (`--kb`) | `node tests/keyboard.js` — đo ô nhập nằm trên mép bàn phím | keyboard |
| 74 | Kéo-để-làm-mới + vuốt ngang chuyển tab | iPhone thật | ui-new |
| 75 | AGY: log thời gian thực tô màu, tạm dừng/xoá | Bật agy từ dashboard | ui-new |
| 76 | AGY: sửa `.env` tại chỗ, báo khi cần Restart | Đổi `PORT` → hiện nhắc Restart | tay |
| 77 | Hermes: tên hội thoại rút gọn + tin đầu làm phụ đề | Xem tab Hermes | ui-new |
| 78 | Hermes: ô tìm hội thoại | Gõ vào ô tìm | ui-new |
| 78c | REMOTE: duyệt kế hoạch NGAY ở danh sách, không mở phiên | Phiên chờ duyệt → bấm "Duyệt" trên thẻ | du-an |
| 78d | REMOTE: chọn phương án NGAY ở danh sách | Claude hỏi → bấm lựa chọn + "Gửi" trên thẻ | du-an |
| 78e | Nhắn được cả khi Claude đang chạy (xếp hàng, không còn 409) | Phiên đang chạy → gửi tin → hiện "Còn N tin đang chờ" | du-an |
| 78f | Bấm Dừng thì bỏ luôn tin đang xếp | Xếp 2 tin → bấm Dừng → hàng đợi rỗng | du-an |
| 78g | 17 nút công cụ Hermes (gồm pause/resume dừng khẩn cấp) | Tab Hermes → Công cụ | du-an |
| 78h | Xem môi trường Claude CLI (MCP, plugin, phiên terminal, doctor) | Màn cấu hình → Môi trường Claude CLI | du-an |
| 78i | Trần chi phí + model dự phòng cho việc nền | Tạo loop kèm budget → xem `ps` | du-an |
| 78a | Hermes: khung chat kiểu terminal (không phải bong bóng) — header tên+giờ, gập lượt, Markdown | Mở tab Hermes, xem một hội thoại có tin của cả hai bên | **chưa có test** |
| 78b | Hermes: kết quả tool là thẻ bung/gập được, KHÔNG cắt cứng 300 ký tự | Mở hội thoại có lệnh, bấm vào thẻ tool | **chưa có test** |
| 78j | Hermes chat NHỚ ngữ cảnh (qua ACP, không phải `-z`) | Nhắn "nhớ số 42" rồi hỏi lại → phải trả 42 | du-an |
| 78k | REMOTE: xem "Claude đã đổi gì" (git diff) ngay trong app | Khung chat → ⋯ → Claude đã đổi gì | du-an |
| 78l | REMOTE: quay lại lượt trước, liệt kê file Claude tạo mới | Khung chat → ⋯ → Quay lại lượt trước | du-an |
| 78m | `!lệnh` chạy thẳng shell, không tốn lượt Claude | Gõ `!git status` → dưới 1 giây | du-an |
| 78n | Nén gzip cho file tĩnh và dòng SSE | Đo 23/8: mở app 1.831→539 KB (-71%), SSE 149,8→25,2 KB mỗi nhịp (-83%) | du-an |
| 79 | Badge % đổi màu theo NGHĨA (thẻ Lỗi tăng = đỏ) | Xem thẻ Lỗi ở tab AGY | ui-new |
| 80 | Không còn nút chết | `node scripts/dead-buttons.js` | ui-new |
| 81 | Thẻ tool mở ra KHÔNG tự đóng khi poll | mở thẻ, đợi 10s, `data-open` vẫn true | ui-new |
| 82 | ~~Chat có avatar + nhãn vai~~ → đã BỎ, thay bằng kiểu terminal (mục 121-125) | — | — |
| 83 | Thẻ "Suy nghĩ" gập được, không đổ hết ra màn | `think-card` mặc định `data-open=false` | ui-new |
| 84 | So sánh 2 phiên (lệnh ⌘K mở thật, không toast lạc đề) | ⌘K → ui:compare → `compare-view` | ui-new |
| 85 | Tóm tắt phiên qua /api/summary | menu ⋯ → Tóm tắt → `summary-dialog` | ui-new |
| 86 | Hook lỗi / lỗi API / mốc /compact hiện trong chat | `note-line` xuất hiện ở phiên có hook lỗi | ui-new |
| 87 | Lịch sử lệnh ↑/↓ trong ô chat | gõ ↑ ra tin cũ, ↓ quay lại | ui-new |
| 88 | Chart đúng số đo Atlas | lưới `4 8`, 0 trục Y, badge 12px/bo 6px | ui-new |
| 89 | Vỏ khớp Atlas | sidebar 256/không viền, mục 32px/bo 8px, header 64px | ui-new |
| 90 | Mọi nút ≥ 44px vùng chạm trên cảm ứng | quét `button` ở 390px, không cái nào < 44 | ui-new |
| 91 | Mã khoá chặn CẢ loopback | `curl localhost/api/jobs` → 423 khi đã đặt mã | curl |
| 92 | Mã sai rồi mã đúng vẫn vào được (ô được xoá) | gõ sai → `passcode-dots` về 0 → gõ đúng → vào | ui-new |
| 93 | Chống dò mã: sai ≥5 lần phải chờ | 7 lần sai liên tiếp → 429 | curl |
| 94 | Quên mã: xoá file passcode là mở lại | `rm ~/.claude/dashboard-passcode.json` + restart | ui-new |
| 95 | Docker: xem/bật/tắt/khởi động lại/log | tab Docker → `dk-row`, bấm `dk-start` | ui-new |
| 96 | Docker chặn lệnh nguy hiểm | action rm/kill/exec/run → từ chối; id có `;` → từ chối | curl |
| 97 | Docker KHÔNG có nút xoá container/volume | không tồn tại testid nào cho xoá | ui-new |
| 98 | 5 tab vừa màn 320px | mỗi tab 64px, chữ không tràn | ui-new |
| 99 | Việc nền gập lại khi rảnh, tự mở khi có job | `jobs-toggle` | ui-new |
| 100 | Nút bật/tắt thông báo ở header | bấm `notify-toggle` → `data-state` đổi bat/tat | ui-new |
| 101 | Bật đúng MỘT đăng ký (không trùng) | bật 1 lần → `.push-state.json` có đúng 1 sub | ui-new |
| 102 | Tắt rồi KHÔNG tự bật lại khi focus | tắt → phát sự kiện focus → vẫn 0 sub | ui-new |
| 103 | Mức suy nghĩ (--effort) truyền xuống CLI | giao task → `ps -o args=` thấy `--effort` | ui-new |
| 104 | Báo cáo agy qua API (không phải SQLite) | tab AGY → thẻ hiện 8.7k request, 33%, p95 | ui-new |
| 105 | Cảnh báo khi tỉ lệ thành công thấp | `rp-canhbao` hiện khi okRate < 70% | ui-new |
| 106 | Điều khiển agy: 4 lệnh an toàn | đổi rotation → agy xác nhận → gateway VẪN bật | curl |
| 107 | Chặn lệnh agy nguy hiểm | bulk/check/restart/regenerateKey → từ chối | curl |
| 108 | Hermes: bảng 12 lệnh bấm chạy được | mở Công cụ → bấm Phiên bản → ra kết quả thật | ui-new |
| 109 | Component chuẩn Atlas dùng chung | Segmented vỏ bo 10px, chọn bo 8px cao 25px | ui-new |
| 110 | Câu hỏi của Claude hiện thành bảng chọn | `ask-card` với lựa chọn đánh số, bấm được | ui-new |
| 111 | Bấm lựa chọn -> gửi thành tin nhắn mới | `node tests/ui-new.js` (kiểm nội dung gửi đi) | ui-new |
| 112 | Kế hoạch render markdown, gập được | `plan-card`, dài > 900 ký tự thì gập | ui-new |
| 113 | Nút chọn chế độ cuộn được trên iPhone | `mode-seg` scrollWidth > clientWidth | ui-new |
| 114 | Hook lỗi KHÔNG cắt đôi lượt của Claude | 1 khối "Claude" thay vì 3 (dựng assistant→note→assistant) | ui-new |
| 115 | Mốc `/compact` VẪN cắt lượt (ranh giới thật) | 2 khối "Claude" quanh dải phân cách | ui-new |
| 116 | Dán ảnh từ clipboard vào ô chat | bắn sự kiện `paste` kèm File → lên thanh đính kèm | ui-new |
| 117 | Kéo-thả ảnh vào khung chat | `drop-overlay` hiện khi rê file vào | tay |
| 118 | Gõ `@` → gợi ý đường dẫn file của phiên | `/api/files?sid=&q=`, chọn thì điền vào ô nhập | ui-new |
| 119 | `@` giữa email không kích hoạt gợi ý | gõ `a@b` → 0 gợi ý | ui-new |
| 120 | Esc đóng gợi ý `@`, gõ `@` mới lại mở | Esc rồi gõ tiếp → gợi ý hiện lại | ui-new |
| 121 | Bản chép dùng phông chữ đều như terminal | `font-mono` ăn thật (trước trỏ vào biến không tồn tại) | ui-new |
| 122 | Ký tự `⏺` cho lượt/tool, `⎿` cho kết quả | đếm trên nội dung khung chat | ui-new |
| 123 | KHÔNG còn avatar tròn / nhãn vai | terminal không có, đếm phải = 0 | ui-new |
| 124 | Câu chữ không nằm trong bong bóng có nền | borderRadius = 0, nền trong suốt | ui-new |
| 125 | Ô nhập có dấu nhắc `>` và khung viền như CLI | `prompt-sign` đổi theo chế độ | ui-new |
| 126 | Danh sách phiên là **lưới thẻ**, 1/2/3 cột theo bề rộng | `session-grid` có thẻ | ui-new |
| 127 | Thẻ KHÔNG tràn khỏi lưới trên iPhone 390px | đo `right` của thẻ vs lưới (lỗi thật: 455px trong 356px) | ui-new |
| 128 | Thẻ hiện câu cuối — biết phiên đang dở việc gì | `card-last` có nội dung | ui-new |
| 129 | Thẻ hiện số lượt + token cả phiên | đọc trên thẻ | ui-new |
| 130 | Ô chọn + menu ⋯ có ngay trên điện thoại | trước đây bản mobile thiếu hẳn | ui-new |
| 131 | Sắp xếp chuyển từ tiêu đề cột sang thanh trên lưới | bấm `sort-title` → `data-active=true` | ui-new |
| 132 | Thẻ báo "Đang chờ duyệt kế hoạch" | `card-plan` khi `choDuyet` | tay |
| 133 | Khung chat dùng TRỌN bề ngang (bỏ kẹp 920px) | đo `chat-bubbles` > 920px trên 1440px | ui-new |
| 134 | Dòng gợi ý phím dưới ô gõ như CLI in ra | `input-hint` — ẩn trên điện thoại | ui-new |
| 135 | Công cụ phiên gom vào MỘT menu ⋯ có nhãn chữ | trước là 5 nút icon trần + 2 nút nữa = 7 ô xám | ui-new |
| 136 | `Esc` trong ô gõ = dừng Claude (như terminal) | chặn `/api/kill`, bấm Esc lúc đang chạy | ui-new |
| 137 | Hiện mốc đổi ngày / lệnh xếp hàng / chế độ kế hoạch | 3 dạng `note-line` mới từ `attachment` | ui-new |
| 138 | Phần đầu trang gọn trên iPhone (133px → 60px) | đo `page-header`, ngưỡng ≤ 80px | ui-new |
| 139 | Thẻ đầu tiên không bị đẩy quá nửa màn (439px → 288px) | đo `top` thẻ đầu, ngưỡng < 340px | ui-new |
| 140 | Nhìn thấy ít nhất 3 thẻ cùng lúc trên iPhone | đếm thẻ nằm trọn trong khung nhìn | ui-new |
| 141 | `!lệnh` chạy thẳng bash, không tốn lượt Claude | gõ `!ls` → dải báo chế độ, dấu nhắc đổi thành `!` | ui-new |
| 142 | `#ghi` cất vào bộ nhớ cho phiên sau | gõ `#…` → dải báo, dấu nhắc đổi thành `#` | ui-new |
| 143 | Gõ mỗi `!` (chưa có lệnh) chưa tính là chế độ | không hiện dải báo | ui-new |
| 144 | **Chữ hiện dần** khi Claude đang trả lời | `dang-go` có nội dung lúc `typing` | ui-new |
| 145 | Gửi vào phiên không tồn tại → hiện banner lỗi | trước đây im lặng vì `/api/history` trả về sớm | ui-new |
| 146 | **Biểu đồ hạn mức còn lại** theo ngày, 2 đường | `agy-quota-history` — endpoint có sẵn mà chưa ai gọi | ui-new |
| 147 | Thẻ số AGY xếp 2 cột trên iPhone | trước `grid-cols-1`, mỗi thẻ ~250px nuốt cả màn | ui-new |
| 148 | 24h không có request → nói rõ lý do | `agy-khong-luu-luong`, không để ba số 0 trần | ui-new |
| 149 | Docker: hiện **CPU/RAM** từng container đang chạy | `docker stats --no-stream` gộp vào `ps` | ui-new |
| 150 | **PostgreSQL**: phiên bản, uptime, số kết nối | `pg-panel` — qua `docker exec`, máy không có psql | ui-new |
| 151 | Postgres: danh sách database + dung lượng | `pg-db` — chọn để xem bảng bên trong | ui-new |
| 152 | Postgres: bảng lớn nhất theo **dung lượng** | không xếp theo số dòng: bảng 0 dòng vẫn nặng vì index | ui-new |
| 153 | Postgres: truy vấn đang chạy (pid, thời gian, SQL) | `pg-truyvan` — chỗ nhìn đầu tiên khi CSDL ì | tay |
| 154 | Postgres tắt → nói rõ lý do, không để khối trắng | `pg-tat` | ui-new |
| 155 | Postgres: chặn tên database có ký tự lạ | `?db=a;DROP TABLE x` → 400 | ui-new |
| 156 | Kế hoạch vẽ kiểu terminal (⏺/⌐), gập mặc định | `plan-card` — kế hoạch thật 15.371 ký tự | ui-new |
| 157 | Lúc gập vẫn hiện **tiêu đề** kế hoạch | dòng `# ...` đầu tiên | ui-new |
| 158 | Mở được bản `.md` đầy đủ của kế hoạch | `plan-file` → `/api/plan` | ui-new |
| 159 | `/api/plan` chặn đọc file ngoài `~/.claude/plans` | `~/.ssh/id_rsa` và `plans/../../.zshrc` → 400 | ui-new |
| 160 | iPhone: đang chat thì **ẩn header + thanh tab** | khung chat 656px → 720px | ui-new |
| 161 | Ẩn xong vẫn quay lại được danh sách | bấm mũi tên ← | ui-new |
| 162 | Nhiều câu hỏi → **tab ngang** như CLI, mỗi lúc một câu | 3 câu: 623px → 280px | ui-new |
| 163 | Chọn xong tự nhảy sang câu chưa trả lời | `ask-tab` đổi `data-active` | ui-new |
| 164 | Còn câu bỏ trống → nói rõ còn mấy câu | "Còn 2 câu chưa chọn" | ui-new |
| 165 | Lựa chọn KHÔNG mất khi poll 2s | React key bất biến qua cửa sổ trượt | ui-new |
| 166 | Chế độ quyền + mức nghĩ nằm ở **dòng trạng thái** dưới ô gõ | đúng chỗ CLI in ra, không phải header | ui-new |
| 167 | Dòng trạng thái HIỆN trên iPhone | trước bị `hidden sm:flex` ẩn hẳn ở 390px | ui-new |
| 168 | **Xem mọi ảnh trong phiên** (ngoài cửa sổ 30 tin) | menu ⋯ → Ảnh trong phiên; phiên thật có 130 ảnh | ui-new |
| 169 | Ảnh trong bảng tải THẬT, không phải ô rỗng | `naturalWidth > 0` | ui-new |
| 170 | Ô ảnh và hàng lưới cao theo nội dung | ô 144px, hàng 144px — không bị chia đều 10.78px | ui-new |
| 171 | Chấm `⏺` của LƯỢT khác màu chấm của TOOL | trắng = Claude nói, tím = chạy lệnh | ui-new |
| 172 | Dòng `⎿` thụt vào làm con của tool (18px) | trước chỉ 3px, dính sát lề | ui-new |
| 173 | Dòng `⎿` hook lỗi cũng thụt cùng mức | nó sinh ra TỪ một tool cụ thể | ui-new |
| 174 | Dấu nhắc `❯` đúng như CLI (không phải `>`) | bắt bằng PTY thật | ui-new |
| 175 | Khung nhập là **đường kẻ ngang**, không phải hộp bo góc | CLI dùng 80 dấu `─`, không có ┌┐└┘ | ui-new |
| 176 | Ô gõ không có nền (`dark:bg-input/30` bị đè) | terminal không có nền nào | ui-new |
| 177 | Gợi ý ngăn nhau bằng `·` như CLI | "Enter to confirm · Esc to cancel" | ui-new |
| 178 | **Bông hoa Claude xoay** khi đang chạy | `hoa-xoay` đổi ký tự mỗi 120ms | ui-new |
| 179 | Trạng thái có động từ + số giây trôi | "Đang nghĩ… 2s" → "Vẫn đang chạy" → "Chạy khá lâu rồi" | ui-new |
| 180 | Ô nhập cao 44px trên điện thoại (5 chỗ) | trước 32–36px, dưới ngưỡng ngón tay | ui-new |
| 181 | Ô chọn phiên có vùng chạm 44×44 | ô vuông vẫn 14px, `<label>` bọc ngoài nới ra | ui-new |

---

## Agent con, xem lại phiên dài, hạn mức

Nhóm này sinh ra từ một câu hỏi đo được: dashboard chỉ hiện **30 tin cuối**, mà phiên
`control` có **19.806 lượt** — tức xem được **0,2 %** nội dung. Muốn đọc lại điều đã bàn
100 lượt trước thì phải tải cả file `.md` về đọc ngoài app.

| # | Tính năng | Cách kiểm | Test |
|---|---|---|---|
| 182 | Đếm **agent con đang chạy** trên thẻ phiên | chip `N agent` ở dòng số liệu, hover ra tên | du-an |
| 183 | Danh sách agent đầy đủ trong khung chat | mỗi agent một dòng ở dải đang chạy | du-an |
| 184 | `tool_result` về SỚM không bị tính là xong | đo thật: 83/83 lần gọi Task đều có `tool_result` ngay lúc phóng | du-an |
| 185 | Trạng thái agent giữ nguyên `failed`/`stopped`/`killed` | không gộp hết thành "xong" — sẽ giấu mất agent chết | du-an |
| 186 | Agent quá 30 phút chưa báo → đánh dấu **đứt** | ngưỡng = 2× agent lâu nhất từng đo (13,5 phút) | du-an |
| 187 | **Xem thêm 30 tin trước** (phân trang lịch sử) | `?them=N`, nút ở đầu vùng cuộn | du-an |
| 188 | **Tìm trong nội dung phiên** | nút kính lúp ở header chat | du-an |
| 189 | Tìm **không dấu** vẫn ra chữ có dấu | gõ `ke hoach` → ra "kế hoạch" | du-an |
| 190 | Nhảy tới kết quả nằm **ngoài** cửa sổ 30 | bấm kết quả cách cuối 40 tin | du-an |
| 191 | Tin nhắn của mình **dính đầu** khi cuộn | cuộn lên giữa phiên dài | ui-new |
| 192 | Thẻ kế hoạch **ghim trên** dải đang chạy | phiên chờ duyệt — không cuộn mất nút Duyệt | ui-new |
| 193 | Push tách riêng "**chờ bạn duyệt**" với "đã trả lời xong" | dựng phiên chờ duyệt, xem thông báo trên iPhone | du-an + tay |
| 194 | Tab **Hạn mức**: 3 thanh + mốc đặt lại | so số với `claude -p /usage` chạy tay | du-an |
| 195 | Chip % hạn mức tuần ở header | bấm vào mở tab Hạn mức | tay |
| 196 | Cache 60 giây cho `/usage` | đo thật 11.751ms → 5ms | du-an |
| 197 | Nút **Khởi động lại ngay** sau khi cập nhật | chỉ chạy khi có systemd; không thì báo lệnh gõ tay | du-an |
| 198 | Giá trị chế độ khớp CLI thật (`auto`, `dontAsk`, `ultracode`) | đổi rồi giao task thật | du-an |
| 199 | Thang chữ **3 mức** theo ReUI (12/14/16) | trước có 15 cỡ rời rạc, 37% là nửa pixel | ui-new |
| 200 | Thẻ phiên có **hiệu ứng vào** (mờ dần + trồi lên) | đổi bộ lọc — thẻ không thay đột ngột | ui-new |
| 201 | Phiên ĐANG CHẠY giữ nhịp thở, không dính hiệu ứng vào | `animate-tho` và `animate-in` cùng dùng `animation`, đè nhau là mất nhịp thở | ui-new |
| 202 | Test **hết nhảy kết quả** giữa các lần chạy | `donCong()` giết server cũ còn nghe cổng test | tay |
| 203 | Lượt của mình dính đầu khung có **đệm riêng** | có nền thì phải có đệm, không chữ dính sát mép | ui-new |
| 204 | Nút `/lệnh` `@file` `!bash` `#ghi nhớ` **bỏ icon trùng** | ký tự mới là thứ được chèn vào ô nhập, icon chỉ làm chật | ui-new |
| 205 | Nút **ảnh** giống hệt các nút cùng hàng | trước là nút icon tròn 44px không viền, đứng cạnh thì lạc | ui-new |
| 206 | Công tắc quyền/model **có viền** như nút bên cạnh | bỏ viền thì trông như chữ rơi vãi, không ra nút | ui-new |
| 207 | Tab Hạn mức không lẫn **cảnh báo của CLI** | đóng stdin + lọc dòng `Warning:` | du-an |
| 208 | **Ghim phiên** (sao trên thẻ) — phiên ghim luôn ở đầu | bấm sao, phiên nhảy lên đầu bất kể sắp xếp gì | du-an |
| 209 | Lọc **chỉ phiên đã ghim** trong menu ⇅ | nhớ qua localStorage như các bộ lọc khác | du-an |
| 210 | Ghim hai lần không sinh bản trùng | mảng lưu thứ tự ghim, không phải Set | du-an |
| 211 | **Tin tự động tách khỏi tin mình gõ** | `<task-notification>`, `/lệnh`… mang nhãn riêng + icon bot, không gắn tên người dùng | du-an |
| 212 | Câu người gõ KHÔNG bị nhận nhầm là tin tự động | kể cả câu mở đầu bằng `<` mà không khớp mẫu nào | du-an |
| 213 | **Chỉ MỘT thanh câu hỏi dính trên cùng** | kiểu Claude CLI — trước đây mọi lượt user đều sticky nên chồng lớp | ui-new |
| 214 | Tin tự động không bị dính lên thanh câu hỏi | chỉ câu người gõ mới mang `data-tom-tat` | ui-new |
| 215 | **Bố cục HAI CỘT kiểu Telegram** từ 1024px | trái danh sách, phải chat — không phải bấm quay lại mới đổi phiên | ui-new |
| 216 | Phiên đang mở được tô sáng trong danh sách | viền + nền, khác với chọn-nhiều | ui-new |
| 217 | Cột hẹp tự gọn: ẩn phân trang, chọn-cả-trang | 200 phiên/trang rồi cuộn, kiểu Telegram | ui-new |
| 218 | Nút giao việc không đè lên khung chat | `fixed right-4` từng neo vào mép cửa sổ | ui-new |
| 219 | Chưa chọn phiên -> desktop hiện lời mời | màn rộng mà nửa phải trắng trơn nhìn như hỏng | ui-new |

---

## Chạy test

```bash
node scripts/test-all.js        # CHẠY TẤT CẢ — mỗi bộ ở đúng môi trường của nó
node scripts/verify.js          # cú pháp + biến chưa khai + chốt token
node scripts/dead-buttons.js    # nút bấm không ra gì
node tests/ui-new.js            # giao diện (server ở 7799)
SKIP_CHAT=1 node tests/ui-new.js # bỏ qua phần nhắn thật cho nhanh
node tests/du-an.js             # server + endpoint
node tests/push.js              # Web Push
node tests/push-browser.js      # Web Push qua trình duyệt thật
node tests/keyboard.js          # bàn phím ảo iOS
node tests/safearea.js          # safe-area iPhone
node tests/may-moi.js           # cài trên máy mới
```

Cột cuối mỗi bảng là **tên bộ test chạy mục đó**. Trước đây 37 mục ghi `pw` — không
có runner nào tên vậy, `package.json` cũng không có script đó, nên cột này từng chỉ
vào hư không.

`tests/ui-new.js` tự đặt/gỡ mã khoá trong lúc chạy và dọn sạch sau đó — nhưng nếu
nó bị ngắt giữa chừng thì có thể để sót `~/.claude/dashboard-passcode.json`. Xoá
file đó là gỡ khoá.

## Nợ lưới test còn lại (đo 25/8/2026)

Cột Test ở trên giờ nói đúng: mọi mục đều có runner thật, hoặc ghi `tay` khi cần
phần cứng. Nhưng **bảng này không phủ hết giao diện**.

Đo bằng cách quét mọi `data-testid` trong `web-next/` rồi tìm xem có file test nào
nhắc tới:

```
321 testid trong mã
113 chưa test nào chạm tới  (đầu đợt: 205)
```

Đợt này lấp 92 cái, ưu tiên thứ dùng thật hàng ngày: chọn nhiều, menu ⋯ mỗi dòng,
tìm trong phiên, phân trang, tab Hạn mức, Docker, xem file, hộp xuất/chi phí/mức
nghĩ, thẻ phiên, Hermes, điều khiển AGY, khung so sánh.

113 còn lại vẫn là nợ. Selector gãy ở đó thì không gì báo cả.
Không phải mục nào cũng đáng viết test, nhưng con số này nên GIẢM qua mỗi đợt —
đo lại bằng:

```bash
grep -rhoE 'data-testid="[a-z0-9-]+"' web-next/components web-next/app \
  | sort -u | sed 's/data-testid=//' | tr -d '"' \
  | while read id; do grep -q "$id" tests/*.js || echo "$id"; done | wc -l
```

## Cách dùng khi di trú

1. Trước khi bắt đầu: chạy `node scripts/test-all.js`, lưu output làm mốc.
2. Sau **mỗi bước**: chạy lại, so với mốc.
3. Ở bước cuối (B5c): mở trên **iPhone thật**, tick tay toàn bộ mục ghi `tay`.
4. Mục nào không tick được → dừng, sửa xong mới đi tiếp.
