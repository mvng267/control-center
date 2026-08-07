# Control Center — Project Rules

Dashboard quản lý Claude CLI + Hermes + agy-proxy config. Chạy từ `/Users/mvng/Desktop/project/control/claude-dashboard.js`.

## Mục tiêu sản phẩm
1 tab app quản lý 3 hệ thống: Claude CLI sessions, Hermes chat, agy-proxy config (qua CLI).
Chuẩn bị sẵn sàng cho: Add to Home Screen (iOS/Android), shortcut desktop, dùng hàng ngày.

## RULES — MOBILE (ưu tiên cao nhất, Vinh dùng điện thoại chính)
- Viewport: `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover`.
- Safe area: padding dùng `env(safe-area-inset-top/bottom/left/right)` cho notch + home indicator.
- Touch targets: mọi button/tab ≥ 44px (Apple HIG). Khoảng cách giữa các nút ≥ 8px.
- Input font-size: 16px (tránh iOS auto-zoom khi focus).
- Bottom tab bar (3 tabs): 🖥️ CLAUDE | 💬 HERMES | ⚙️ AGY-PROXY. Tab bar cố định dưới, height ~58px + safe-area-bottom.
- Chat bubbles: max-width 85% trên mobile, font 15-16px, line-height 1.4.
- Scroll: `-webkit-overflow-scrolling: touch`, ẩn scrollbar.
- Không dùng hover-only interaction (mobile không có hover). Mọi action phải tap được.
- Modal/drawer: full-width hoặc bottom-sheet, đóng bằng swipe-down hoặc nút X rõ ràng.
- Test: Chrome DevTools device toolbar iPhone 12/13/14 Pro Max (390x844), Android (360x800).

## RULES — DESKTOP (Mac)
- Sidebar trái collapsible (icon-only 52px ↔ full 220px).
- Keyboard shortcuts: ⌘K command palette, ⌘N task input, ⌘1/⌘2/⌘3 switch tab, Esc close.
- Hover states: glow/accent trên cards, buttons.
- Max-width content ~1200px centered, padding thoáng.
- Font 14-15px, line-height 1.5.

## UI/UX chung
- Dark theme: bg #0f1117 / #1a1d27, text #e4e4e7, accent #3b82f6 (blue) hoặc #8b5cf6 (purple).
- Icons: Lucide (CDN unpkg), SVG vector, không emoji rác.
- Typography: Inter / system-ui, KHÔNG monospace (trừ code block).
- Hiệu ứng: CHỈ fade/slide 1 lần (200ms). KHÔNG animation lặp (matrix rain, scanline, blink) — gây mỏi mắt. Typing indicator chỉ 3 chấm nhấp nháy NHẸ.
- Stable render: diff DOM, chỉ update node thay đổi, KHÔNG innerHTML toàn cục mỗi poll (gây flicker).
- Markdown: render bằng marked + dompurify (đã có). Code block có nút Copy.
- PWA: manifest.json (standalone, theme #0f1117), sw.js, icon.svg (Lucide terminal, 512x512, rounded).
- Không XSS: mọi user input sanitize trước khi innerHTML.

## TAB 3: AGY-PROXY CONFIG (mới)
- Gọi CLI agy-proxy tại `/Users/mvng/Desktop/project/agy-proxy`:
  - `npm run dev` (backend tsx watch) — start/stop qua dashboard button.
  - `npm run typecheck` / `npm test` — chạy từ dashboard, hiển thị kết quả.
  - `cd web && npm run build` — build dashboard.
  - Đọc `src/lib/config.ts` hoặc `.env` để hiển thị cấu hình (accounts, providers, models).
  - Có thể edit 1 vài field (vd: model default, port) rồi save → ghi file.
- Tab hiển thị: status (running?), port, accounts count, last test result, buttons: Start/Stop/Restart/Build/Test.
- Giao tiếp: dashboard spawn `claude` hoặc `npm` qua child_process, capture stdout/stderr → hiển thị realtime.

## QUY TRÌNH PHÁT TRIỂN
- Mọi thay đổi qua Claude CLI session (resume để giữ context).
- Test: `node -c claude-dashboard.js` (syntax) + khởi động server + curl endpoints.
- Commit thường xuyên, KHÔNG push nếu Vinh chưa duyệt.
- Verify trước khi báo "xong": typecheck, test, build, mobile/desktop render, PWA.

## TECH STACK
- Node.js thuần (http server), vanilla JS frontend, Tailwind+daisyUI CDN, Chart.js CDN, marked+dompurify CDN, Lucide CDN.
- KHÔNG dùng build step (giữ đơn giản, dễ sửa trực tiếp).
- Port 7799, bind 0.0.0.0 (Tailscale accessible).
