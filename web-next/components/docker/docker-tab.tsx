'use client';

import { useEffect, useState } from 'react';
import {
  Container, Play, Square, RotateCw, ScrollText, HardDrive, Layers, Trash2, Loader2, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/app-shell';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PostgresPanel } from './postgres-panel';

/* Quản lý Docker: xem trạng thái, bật/tắt/khởi động lại, đọc log, dọn build cache.
   KHÔNG có xoá container/image/volume — volume postgres/neo4j của webapp nằm trong
   đó, bấm nhầm trên điện thoại là mất dữ liệu thật. */

interface Ct {
  ID: string; Names: string; Image: string; Status: string; State: string;
  // chỉ có ở container ĐANG CHẠY — `docker stats` không liệt kê cái đã dừng
  cpu?: string; ram?: string; ramPct?: string;
  Ports: string; RunningFor: string;
}
interface Df { Type: string; TotalCount: string; Active: string; Size: string; Reclaimable: string }
interface Res { ok: boolean; error?: string; containers?: Ct[]; df?: Df[] }

// "Up 13 hours (healthy)" -> tách phần sức khoẻ ra để tô màu riêng
function sucKhoe(s: string) {
  const m = /\((healthy|unhealthy|health: starting)\)/i.exec(s || '');
  return m ? m[1].toLowerCase() : '';
}
const dangChay = (c: Ct) => /^up/i.test(c.Status || '');

export function DockerTab() {
  const [r, setR] = useState<Res | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<{ ten: string; noiDung: string } | null>(null);
  const [hoiDon, setHoiDon] = useState(false);

  const load = () => api<Res>('/api/docker/ps').then(setR).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const lam = async (action: string, id: string, ten: string) => {
    setBusy(id);
    try {
      const x = await api<{ ok: boolean; error?: string }>('/api/docker/action', {
        method: 'POST', body: JSON.stringify({ action, id }),
      });
      if (!x.ok) toast.error(x.error || 'Không thực hiện được');
      else { toast.success(`${action === 'stop' ? 'Đã dừng' : action === 'start' ? 'Đã bật' : 'Đã khởi động lại'} ${ten}`); navigator.vibrate?.(12); }
      load();
    } catch { toast.error('Lỗi mạng'); }
    finally { setBusy(null); }
  };

  const xemLog = async (id: string, ten: string) => {
    setLog({ ten, noiDung: '' });
    try {
      const x = await api<{ ok: boolean; log?: string; error?: string }>('/api/docker/logs?id=' + encodeURIComponent(id));
      setLog({ ten, noiDung: x.ok ? (x.log || '(trống)') : 'Lỗi: ' + (x.error || '?') });
    } catch { setLog({ ten, noiDung: 'Không đọc được log' }); }
  };

  const don = async () => {
    setHoiDon(false);
    setBusy('prune');
    try {
      const x = await api<{ ok: boolean; error?: string }>('/api/docker/prune-build', {
        method: 'POST', body: JSON.stringify({ confirm: true }),
      });
      toast[x.ok ? 'success' : 'error'](x.ok ? 'Đã dọn build cache' : (x.error || 'Không dọn được'));
      load();
    } catch { toast.error('Lỗi mạng'); }
    finally { setBusy(null); }
  };

  /* Đang tải cũng phải có PageHeader. Trước đây nhánh này trả về mỗi chữ "Đang tải…":
     bấm sang tab Docker là tiêu đề biến mất rồi hiện lại — màn hình giật một nhịp.
     Không phải chớp nhoáng: `docker system df` phải tính dung lượng toàn bộ image
     (2.385GB trên máy này), lần đầu sau khi bật daemon mất hơn 1,6 giây — đủ lâu để
     bài test "tab docker có phần đầu trang" bắt được lúc trống. */
  if (!r) {
    return (
      <>
        <PageHeader title="Docker" desc="Container đang chạy trên máy này." />
        <div className="px-4 md:px-6">
          <p className="py-8 text-center text-[14px] text-muted-foreground">Đang tải…</p>
        </div>
      </>
    );
  }

  /* Docker daemon TẮT — vẫn phải dựng khối Postgres. Trước đây nhánh này thoát sớm
     và bỏ luôn <PostgresPanel/>, nên tắt Docker là cả khối CSDL biến mất thay vì nói
     "Postgres đang tắt". Người dùng nhìn vào tưởng dashboard hỏng, mà đúng ra đây là
     lúc CẦN thấy nó nhất — để biết vì sao CSDL không lên.
     Chính hai bài test "khối PostgreSQL luôn có mặt" bắt được cảnh này. */
  if (!r.ok) {
    return (
      <>
        <PageHeader title="Docker" desc="Container đang chạy trên máy này." />
        <div className="flex flex-col gap-4 px-4 pb-24 md:px-6 md:pb-6">
          <Card className="gap-0 p-6 text-center" data-testid="docker-loi">
            <Container className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 text-[14px] text-muted-foreground">{r.error}</p>
          </Card>
          <PostgresPanel />
        </div>
      </>
    );
  }

  const cts = r.containers || [];
  const df = r.df || [];
  const lay = (t: string) => df.find((d) => d.Type === t);
  const cache = lay('Build Cache');
  const soChay = cts.filter(dangChay).length;

  return (
    <>
      <PageHeader title="Docker" count={cts.length}
        desc="Container đang chạy trên máy này." />

      <div className="flex flex-col gap-4 px-4 pb-24 md:px-6 md:pb-6" data-testid="docker-tab">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard title="Đang chạy" sub="đang chạy" icon={Play} value={`${soChay}/${cts.length}`}
            tone={soChay ? 'ok' : 'idle'} dot={soChay ? 'ok' : 'idle'} testid="dk-run" />
          <StatCard title="Image" sub="image" icon={Layers}
            value={lay('Images')?.TotalCount || '0'} deltaLabel={lay('Images')?.Size} testid="dk-img" />
          <StatCard title="Ổ đĩa" sub="volume" icon={HardDrive}
            value={lay('Local Volumes')?.TotalCount || '0'} deltaLabel={lay('Local Volumes')?.Size} testid="dk-vol" />
          <StatCard title="Cache" sub="build cache" icon={Trash2}
            value={cache?.Size || '0'} deltaLabel="dọn được" tone="warn" testid="dk-cache" />
        </div>

        <Card className="gap-0 p-0" data-testid="docker-list">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Container className="size-4 text-muted-foreground" />
            <span className="text-[14px] font-semibold">Container</span>
            {cache && cache.Size !== '0B' && (
              <Button variant="outline" size="sm" className="tap44 ml-auto h-8 text-[12px]"
                disabled={busy === 'prune'} onClick={() => setHoiDon(true)} data-testid="dk-prune">
                {busy === 'prune' ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Dọn cache {cache.Size}
              </Button>
            )}
          </div>

          {cts.length === 0 && (
            <p className="px-4 py-8 text-center text-[14px] text-muted-foreground">Chưa có container nào</p>
          )}

          {cts.map((c) => {
            const chay = dangChay(c);
            const sk = sucKhoe(c.Status);
            return (
              <div key={c.ID} data-testid="dk-row" data-name={c.Names} data-running={chay}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 last:border-0">
                <span className={cn('size-2 shrink-0 rounded-full',
                  !chay ? 'bg-status-idle' : sk === 'unhealthy' ? 'bg-status-error'
                    : sk === 'health: starting' ? 'bg-status-run' : 'bg-status-ok')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{c.Names}</span>
                  <span className="block truncate font-mono text-[12px] text-muted-foreground">{c.Image}</span>
                  {/* CPU/RAM thật từ `docker stats`. Trước đây chỉ biết container CÒN
                      SỐNG hay không — mà khi máy ì thì thứ cần biết là cái nào đang
                      ngốn tài nguyên. Container đã dừng không có số nên không hiện. */}
                  {c.cpu && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[12px] text-muted-foreground"
                      data-testid="dk-taiNguyen">
                      <span className="tabular-nums">CPU {c.cpu}</span>
                      <span className="tabular-nums">RAM {String(c.ram || '').split(' / ')[0]}</span>
                    </span>
                  )}
                </span>
                <Badge variant="outline" className="shrink-0 text-[12px]">
                  {chay ? c.RunningFor || 'đang chạy' : 'đã dừng'}
                </Badge>
                {sk && (
                  <Badge variant="outline" className={cn('hidden shrink-0 text-[12px] sm:inline-flex',
                    sk === 'healthy' ? 'border-status-ok/40 text-status-ok'
                      : sk === 'unhealthy' ? 'border-status-error/40 text-status-error' : 'text-status-run')}>
                    {sk === 'healthy' ? 'khoẻ' : sk === 'unhealthy' ? 'có vấn đề' : 'đang khởi động'}
                  </Badge>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="tap44 size-8" title="Xem log"
                    aria-label="Xem log" data-testid="dk-log" onClick={() => xemLog(c.ID, c.Names)}>
                    <ScrollText className="size-3.5" />
                  </Button>
                  {chay ? (
                    <>
                      <Button variant="ghost" size="icon" className="tap44 size-8" title="Khởi động lại"
                        aria-label="Khởi động lại" data-testid="dk-restart" disabled={busy === c.ID}
                        onClick={() => lam('restart', c.ID, c.Names)}>
                        <RotateCw className={cn('size-3.5', busy === c.ID && 'animate-spin')} />
                      </Button>
                      <Button variant="ghost" size="icon" className="tap44 size-8 text-status-error"
                        title="Dừng" aria-label="Dừng" data-testid="dk-stop" disabled={busy === c.ID}
                        onClick={() => lam('stop', c.ID, c.Names)}>
                        <Square className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" size="icon" className="tap44 size-8 text-status-ok"
                      title="Bật" aria-label="Bật" data-testid="dk-start" disabled={busy === c.ID}
                      onClick={() => lam('start', c.ID, c.Names)}>
                      <Play className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </Card>

        {/* Postgres nằm TRONG tab Docker vì CSDL chạy bằng container — tách ra tab
            riêng thì phải nhảy qua lại giữa hai chỗ mỗi lần bật/tắt nó. */}
        <PostgresPanel />
      </div>

      {log && (
        <Dialog open onOpenChange={() => setLog(null)}>
          <DialogContent className="max-h-[85dvh] max-w-[760px] overflow-hidden" data-testid="dk-log-dialog">
            <DialogHeader><DialogTitle className="font-mono text-[14px]">{log.ten}</DialogTitle></DialogHeader>
            {log.noiDung ? (
              <pre className="max-h-[65dvh] overflow-auto whitespace-pre-wrap break-words rounded-[10px] border border-border bg-background/60 p-3 font-mono text-[12px] leading-relaxed">
                {log.noiDung}
              </pre>
            ) : (
              <div className="flex items-center gap-2 py-6 text-[14px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" /> Đang đọc log…
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {hoiDon && (
        <Dialog open onOpenChange={() => setHoiDon(false)}>
          <DialogContent className="max-w-[400px]" data-testid="dk-prune-dialog">
            <DialogHeader><DialogTitle>Dọn build cache?</DialogTitle></DialogHeader>
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              Xoá {cache?.Size} cache dựng image. Container đang chạy và dữ liệu KHÔNG bị ảnh hưởng —
              chỉ là lần build sau sẽ lâu hơn vì phải tải lại.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="tap44" onClick={() => setHoiDon(false)}>Hủy</Button>
              <Button size="sm" className="tap44" onClick={don} data-testid="dk-prune-ok">
                <Trash2 className="size-3.5" /> Dọn
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
