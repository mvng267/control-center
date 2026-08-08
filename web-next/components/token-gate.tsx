'use client';

import { useState } from 'react';
import { setToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Hiện khi chưa có token hoặc token sai. Server chặn mọi /api/* từ ngoài loopback,
// nên không có mã thì dashboard không dùng được gì.
export function TokenGate() {
  const [v, setV] = useState('');
  const save = () => {
    const t = v.trim();
    if (!t) return;
    setToken(t);
    location.reload(); // nạp lại để SSE cũng dùng token mới
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-background/85 p-5 backdrop-blur-xl"
      data-testid="token-gate"
    >
      <div className="w-full max-w-[340px] rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="mb-1 text-[15px] font-semibold">Nhập mã truy cập</div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
          Mã in ra ở cửa sổ chạy dashboard (dòng “mã truy cập”). Nhập một lần, máy này nhớ luôn.
        </p>
        <Input
          data-testid="token-input"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="dán mã vào đây"
          autoComplete="off"
          className="text-[16px]"
        />
        <Button className="mt-2.5 h-11 w-full font-semibold" onClick={save} data-testid="token-save">
          Vào dashboard
        </Button>
      </div>
    </div>
  );
}
