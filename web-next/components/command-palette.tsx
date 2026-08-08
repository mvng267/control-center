'use client';

import { useEffect, useState } from 'react';
import { Terminal, Loader2 } from 'lucide-react';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { COMMANDS, type Cmd } from '@/lib/commands';
import { toast } from 'sonner';

interface RunResult { ok: boolean; blocked?: boolean; output?: string; error?: string }

export function CommandPalette({
  open, onOpenChange, sid, onUi,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sid: string | null;
  onUi: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; body: string; blocked?: boolean } | null>(null);

  useEffect(() => { if (!open) setQ(''); }, [open]);

  const run = async (c: Cmd) => {
    if (c.needSession && !sid) return toast.error('Mở một phiên trước đã');
    onOpenChange(false);

    if (c.kind === 'ui') return onUi(c.id);

    if (c.kind === 'claude-chat') {
      try {
        await api('/api/chat/' + sid, { method: 'POST', body: JSON.stringify({ message: c.cmd || c.id }) });
        toast.success('Đã gửi ' + c.label + ' vào phiên');
      } catch { toast.error('Không gửi được'); }
      return;
    }

    setRunning(c.id);
    const url = c.kind === 'hermes-run' ? '/api/hermes/run' : '/api/claude/run';
    const body = c.kind === 'hermes-run'
      ? JSON.stringify({ cmd: c.cmd || c.id })
      : JSON.stringify({ cmd: c.cmd || c.id, sid });
    try {
      const r = await api<RunResult>(url, { method: 'POST', body });
      setResult({ title: c.label, body: r.output || r.error || '(không có output)', blocked: r.blocked });
    } catch {
      setResult({ title: c.label, body: 'Không chạy được lệnh.' });
    }
    setRunning(null);
  };

  // Ô lệnh tự do: gõ lệnh bất kỳ -> truyền thẳng xuống CLI. Đây là thứ khiến app
  // không khác terminal — không bị giới hạn bởi danh sách có sẵn.
  const raw = q.trim();
  const isRaw = raw.startsWith('/') && !COMMANDS.some((c) => c.label === raw);
  const runRaw = async () => {
    onOpenChange(false);
    setRunning('raw');
    try {
      const r = await api<RunResult>('/api/claude/run', {
        method: 'POST', body: JSON.stringify({ cmd: raw, sid }),
      });
      setResult({ title: raw, body: r.output || r.error || '(không có output)', blocked: r.blocked });
    } catch { setResult({ title: raw, body: 'Không chạy được lệnh.' }); }
    setRunning(null);
  };

  // Input riêng (không dùng CommandInput) nên cmdk không tự lọc — lọc tay theo q
  const needle = q.trim().toLowerCase();
  const match = (c: Cmd) => !needle || (c.label + ' ' + c.desc).toLowerCase().includes(needle);
  const groups: Cmd['group'][] = ['Claude', 'Hermes', 'Dashboard'];
  const nMatch = COMMANDS.filter(match).length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="top-[15%] max-w-[560px] translate-y-0 gap-0 overflow-hidden p-0">
          <DialogHeader className="sr-only"><DialogTitle>Bảng lệnh</DialogTitle></DialogHeader>
          <Command shouldFilter={false} className="bg-transparent">
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              data-testid="palette-input" placeholder="Gõ lệnh hoặc tìm…  (gõ /lệnh-bất-kỳ để chạy thẳng)"
              className="h-11 rounded-none border-0 border-b border-border text-[16px] focus-visible:ring-0 md:text-[14px]" />
        <CommandList data-testid="palette-list" className="max-h-[60dvh]">
          {!nMatch && !isRaw && (
            <div className="py-6 text-center text-[13px] text-muted-foreground">Không tìm thấy lệnh nào.</div>
          )}

          {isRaw && (
            <CommandGroup heading="Chạy thẳng xuống CLI">
              <CommandItem value={raw} onSelect={runRaw} data-testid="palette-raw">
                <Terminal className="size-4 text-tool-accent" />
                <span className="font-mono">{raw}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">Enter để chạy</span>
              </CommandItem>
            </CommandGroup>
          )}

          {groups.map((g) => (
            COMMANDS.some((c) => c.group === g && match(c)) ? (
            <CommandGroup key={g} heading={g}>
              {COMMANDS.filter((c) => c.group === g && match(c)).map((c) => (
                <CommandItem key={c.id} value={c.label + ' ' + c.desc} onSelect={() => run(c)}
                  data-testid="palette-item" data-cmd={c.id}>
                  <span className="font-mono text-[13px]">{c.label}</span>
                  <span className="ml-2 truncate text-[12px] text-muted-foreground">{c.desc}</span>
                  {c.needSession && !sid && (
                    <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground">cần mở phiên</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            ) : null))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      {running && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-[13px]">
            <Loader2 className="size-4 animate-spin text-primary" /> Đang chạy…
          </div>
        </div>
      )}

      {result && (
      <Dialog open onOpenChange={(v) => !v && setResult(null)}>
        <DialogContent className="max-h-[80dvh] max-w-[680px] overflow-hidden" data-testid="cmd-result">
          <DialogHeader>
            <DialogTitle className="font-mono text-[14px]">{result?.title}</DialogTitle>
          </DialogHeader>
          {result?.blocked && (
            <p className="rounded-[10px] border border-amber-500/25 bg-amber-500/[0.08] px-2.5 py-2 text-[12px] text-amber-500">
              Lệnh này cần terminal tương tác nên Claude CLI chặn ở chế độ nền. Dashboard
              có sẵn chức năng tương đương trong nhóm “Dashboard”.
            </p>
          )}
          <pre className="max-h-[56dvh] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-background/60 p-3 font-mono text-[12.5px] leading-relaxed">
            {result?.body}
          </pre>
        </DialogContent>
      </Dialog>
      )}
    </>
  );
}
