'use client';

import { useEffect, useRef, useState } from 'react';
import { Lock, LockOpen, ShieldCheck, Delete } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* Màn khoá bằng mã số. Khác token: token chặn người từ mạng, còn mã này chặn
   NGƯỜI CẦM CHÍNH CHIẾC MÁY NÀY — trước đây localhost được miễn hoàn toàn, ai mở
   Chrome vào localhost:7799 là vào thẳng.

   Vỏ app vẫn được server cho tải (nếu chặn luôn thì trang trắng, không hiện được cả
   màn nhập mã) — mọi /api/* mới trả 423 khi chưa mở khoá. */

interface Status { daDat: boolean; daMo: boolean; choGiay: number }

export function usePasscode() {
  const [st, setSt] = useState<Status | null>(null);
  const load = () => api<Status>('/api/passcode/status').then(setSt).catch(() => {});
  useEffect(() => { load(); }, []);
  return { st, reload: load };
}

// Bàn phím số tự vẽ: trên iPhone gõ vào input số vẫn bung bàn phím hệ thống che mất
// màn hình. Bàn phím riêng thì luôn thấy được cả ô mã lẫn phím bấm.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'x'];

export function PasscodeGate({ daDat, onDone }: { daDat: boolean; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');   // bước xác nhận khi TẠO mã mới
  const [buoc, setBuoc] = useState<'nhap' | 'xacnhan'>('nhap');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!wait) return;
    timer.current = setInterval(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [wait]);

  const gui = async (value: string) => {
    setBusy(true);
    try {
      if (daDat) {
        // Dùng fetch TRỰC TIẾP chứ không qua api(): api() ném lỗi khi gặp 401/429
        // (lib/api.ts:41-42), mà mã sai chính là 401 -> nhảy thẳng vào catch, dòng
        // xoá ô mã không bao giờ chạy tới. Hậu quả đo được: gõ sai "1111" rồi gõ
        // đúng "2468" thành "11112468" -> sai vĩnh viễn, không vào được nữa.
        const res = await fetch('/api/passcode/verify', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: value }),
        });
        const r = await res.json().catch(() => ({}));
        if (res.ok && r.ok) { navigator.vibrate?.(20); onDone(); return; }
        setWait(r.choGiay || 0);
        toast.error(r.error || 'Mã không đúng');
        setCode('');
      } else {
        // tạo mã mới: nhập hai lần cho chắc, gõ nhầm rồi tự khoá mình thì phiền
        if (buoc === 'nhap') { setConfirm(value); setCode(''); setBuoc('xacnhan'); return; }
        if (value !== confirm) {
          toast.error('Hai lần nhập không khớp');
          setCode(''); setConfirm(''); setBuoc('nhap'); return;
        }
        const res = await fetch('/api/passcode/set', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: value }),
        });
        const r = await res.json().catch(() => ({}));
        if (!res.ok || !r.ok) { toast.error(r.error || 'Không đặt được mã'); setCode(''); return; }
        toast.success('Đã đặt mã khoá');
        navigator.vibrate?.(20);
        onDone();
      }
    } catch { toast.error('Lỗi mạng'); }
    finally { setBusy(false); }
  };

  const bam = (k: string) => {
    if (busy || wait) return;
    if (k === 'x') { setCode((c) => c.slice(0, -1)); return; }
    if (!k) return;
    const next = code + k;
    if (next.length > 12) return;
    setCode(next);
    navigator.vibrate?.(6);
    if (next.length === 4 && !daDat) return;   // tạo mã: cho gõ dài hơn 4 nếu muốn
  };

  const tieuDe = daDat ? 'Nhập mã khoá'
    : buoc === 'nhap' ? 'Tạo mã khoá mới' : 'Nhập lại mã vừa tạo';

  return (
    <div data-testid="passcode-gate"
      className="fixed inset-0 z-[150] flex flex-col items-center justify-center gap-5 bg-background p-6">
      <span className={cn('flex size-14 items-center justify-center rounded-2xl',
        daDat ? 'bg-primary/12 text-primary' : 'bg-status-ok/12 text-status-ok')}>
        {daDat ? <Lock className="size-6" /> : <ShieldCheck className="size-6" />}
      </span>

      <div className="text-center">
        <div className="text-[16px] font-semibold">{tieuDe}</div>
        <div className="mt-1 max-w-[280px] text-[12.5px] leading-relaxed text-muted-foreground">
          {daDat
            ? 'Mã bảo vệ dashboard khỏi người khác cầm máy này.'
            : 'Từ 4 đến 12 chữ số. Quên mã thì xoá file ~/.claude/dashboard-passcode.json để gỡ.'}
        </div>
      </div>

      {/* các chấm thể hiện số ký tự đã gõ — không hiện số thật */}
      <div className="flex items-center gap-2.5" data-testid="passcode-dots" data-len={code.length}>
        {Array.from({ length: Math.max(4, code.length) }).map((_, i) => (
          <span key={i} className={cn('size-3 rounded-full transition-colors',
            i < code.length ? 'bg-primary' : 'bg-muted')} />
        ))}
      </div>

      {wait > 0 && (
        <div className="rounded-lg border border-status-error/30 bg-status-error/[0.08] px-3 py-1.5 text-[12.5px] text-status-error"
          data-testid="passcode-wait">
          Sai nhiều lần — chờ {wait} giây
        </div>
      )}

      <div className="grid w-full max-w-[260px] grid-cols-3 gap-2.5">
        {KEYS.map((k, i) => k === '' ? <span key={i} /> : (
          <button key={i} onClick={() => bam(k)} disabled={busy || wait > 0}
            data-testid={k === 'x' ? 'key-del' : 'key-' + k}
            className="flex h-14 items-center justify-center rounded-xl border border-border bg-card text-[19px] font-medium transition-colors active:bg-accent disabled:opacity-40">
            {k === 'x' ? <Delete className="size-5" /> : k}
          </button>
        ))}
      </div>

      <Button className="w-full max-w-[260px]" disabled={code.length < 4 || busy || wait > 0}
        onClick={() => gui(code)} data-testid="passcode-submit">
        <LockOpen className="size-4" />
        {daDat ? 'Mở khoá' : buoc === 'nhap' ? 'Tiếp tục' : 'Đặt mã'}
      </Button>
    </div>
  );
}
