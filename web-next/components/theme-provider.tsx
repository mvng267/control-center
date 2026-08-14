'use client';

import { ThemeProvider as NextThemes } from 'next-themes';

// Mặc định TỐI: dashboard hay dùng ban đêm trên giường.
// Vẫn có đủ theme sáng để đổi bằng nút trên header.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}
