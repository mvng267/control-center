import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

// Inter — cùng font Atlas dùng. next/font tự nhúng nên không phụ thuộc mạng ngoài.
const inter = Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Claude Control Center',
  description: 'Quản lý Claude CLI, Hermes và agy-proxy',
  manifest: '/manifest.json',
  // apple-touch-icon là BẮT BUỘC: iOS bỏ qua icon SVG khi "Thêm vào Màn hình chính",
  // thiếu nó thì shortcut hiện ảnh chụp màn hình mờ thay vì logo.
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Claude CC' },
};

// viewport-fit=cover + maximum-scale=1: cần cho safe-area iPhone và chặn iOS tự zoom
// khi focus input (input phải để font-size 16px, xem RULES.md).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f1117' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // suppressHydrationWarning: next-themes gắn class vào <html> trước khi React hydrate
  return (
    <html lang="vi" className={inter.variable} suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          {children}
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
