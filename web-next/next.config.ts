import type { NextConfig } from 'next';

// Static export: build ra HTML/CSS/JS tĩnh để server Node hiện có phục vụ ở cùng cổng 7799.
// Vì sao không dùng Next runtime: Vinh vào từ iPhone qua Tailscale — hai cổng nghĩa là
// hai URL, hai lần nhập token, service worker vỡ scope và Web Push chết (khác origin).
// Static export giữ mọi thứ cùng origin, backend không phải sửa một dòng nào.
const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'out',
  images: { unoptimized: true },   // không có server Next để tối ưu ảnh lúc chạy
  trailingSlash: false,
};

export default nextConfig;
