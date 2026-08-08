import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Claude Control Center',
  description: 'Quản lý Claude CLI, Hermes và agy-proxy',
  manifest: '/manifest.json',
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
    <html lang="vi" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          {children}
          <Toaster position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
