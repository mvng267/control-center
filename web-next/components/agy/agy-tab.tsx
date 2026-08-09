'use client';

import { useEffect, useState } from 'react';
import { Play, Square, RotateCw, Search, ChevronDown, ArrowLeftRight, TriangleAlert, Coins } from 'lucide-react';
import { api } from '@/lib/api';
import type { AgyStatus, AgyUsage } from '@/lib/types';
import { PageHeader } from '@/components/layout/app-shell';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AgyLog } from './agy-log';
import { AgyConfig } from './agy-config';
import { cn } from '@/lib/utils';

const ACC_LABEL: Record<string, string> = {
  ok: 'hoạt động', new: 'chưa dùng', needs_human: 'cần xử lý', failed: 'lỗi', unknown: 'không rõ',
};
const ACC_COLOR: Record<string, string> = {
  ok: 'bg-status-ok', new: 'bg-primary', needs_human: 'bg-status-run',
  failed: 'bg-status-error', unknown: 'bg-status-idle',
};
const CODE_LABEL: Record<number, string> = {
  429: 'vượt hạn mức', 503: 'nhà cung cấp quá tải', 500: 'lỗi máy chủ', 400: 'request sai',
  401: 'sai khoá', 402: 'hết tiền', 404: 'không thấy model', 408: 'quá hạn chờ',
};

function shortNum(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

export function AgyTab() {
  const [st, setSt] = useState<AgyStatus | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    const load = () => api<AgyStatus>('/api/agy/status').then((r) => alive && setSt(r)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!st) {
    return <div className="p-6 text-sm text-muted-foreground">Đang tải…</div>;
  }

  const usage = st.usage?.ok ? (st.usage as AgyUsage) : null;
  const errPct = usage && usage.reqs ? Math.round((usage.errs / usage.reqs) * 100) : 0;
  const accKeys = ['ok', 'new', 'needs_human', 'failed', 'unknown'].filter((k) => st.acc?.status?.[k]);

  const act = (seg: string, name?: string) =>
    api('/api/agy/' + seg, { method: 'POST', body: JSON.stringify(name ? { name } : {}) }).catch(() => {});

  return (
    <>
      <PageHeader title="Agy Proxy" count={st.models.length}
        desc="Trạng thái gateway, lưu lượng và sức khoẻ tài khoản." />
    <div className="flex flex-col gap-4 px-4 pb-24 md:px-6 md:pb-6">
      {/* thẻ trạng thái — mọi thứ quan trọng ở một chỗ */}
      <Card
        className={cn('gap-0 p-4', st.running ? 'border-status-ok/35' : 'border-status-error/35')}
        data-testid="agy-hero"
        data-running={st.running}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className={cn('size-2.5 shrink-0 rounded-full', st.running ? 'bg-status-ok' : 'bg-status-error')} />
          <span className="text-[17px] font-bold tracking-tight" data-testid="agy-status">
            {st.running ? 'Đang chạy' : 'Đã dừng'}
          </span>
          <span className="text-[12.5px] text-muted-foreground">
            cổng {st.port}
            {st.dev ? ` · dashboard quản lý (pid ${st.dev.pid})` : ''}
          </span>
          {st.external && (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10.5px] text-amber-500">
              CHẠY NGOÀI
            </Badge>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!!st.dev || st.running} onClick={() => act('start')}>
            <Play className="size-4" /> Start
          </Button>
          <Button size="sm" variant="outline" disabled={!st.dev} onClick={() => act('stop')}
            className="text-status-error">
            <Square className="size-4" /> Stop
          </Button>
          <Button size="sm" variant="outline" disabled={st.running && !st.dev} onClick={() => act('restart')}>
            <RotateCw className="size-4" /> Restart
          </Button>
        </div>
        {st.running && !st.dev && (
          <p className="mt-2.5 rounded-[10px] border border-amber-500/20 bg-amber-500/[0.08] px-2.5 py-2 text-[12px] leading-relaxed text-amber-500">
            Proxy đang chạy NGOÀI dashboard nên Stop/Restart không tác dụng — dừng nó ở nơi đã khởi chạy.
          </p>
        )}
      </Card>

      {/* lưu lượng 24h — thẻ số liệu kiểu Atlas */}
      {usage && (
        <Card className="gap-0 p-4" data-testid="agy-usage">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-muted-foreground">Lưu lượng 24 giờ</span>
            {!!usage.avgMs && (
              <span className="text-[11.5px] text-muted-foreground">
                trễ trung bình {(usage.avgMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard title="Request" sub="request 24h" icon={ArrowLeftRight} value={shortNum(usage.reqs)}
              spark={usage.hours.map((h) => h.n)} tone="primary" dot="primary" testid="agy-reqs" />
            <StatCard title="Lỗi" sub="lỗi" icon={TriangleAlert} value={usage.errs ? shortNum(usage.errs) : '0'}
              delta={errPct} deltaLabel="trên tổng request" tangLaTot={false}
              spark={usage.hours.map((h) => h.e)} tone={errPct >= 20 ? 'error' : 'ok'}
              dot={errPct >= 20 ? 'error' : 'ok'} testid="agy-errs" />
            <StatCard title="Token" sub="token đã dùng" icon={Coins} value={shortNum(usage.tokens)}
              deltaLabel={usage.avgMs ? `trễ TB ${(usage.avgMs / 1000).toFixed(1)}s` : undefined}
              tone="primary" testid="agy-tokens" />
          </div>

          {errPct >= 20 && usage.codes[0] && (
            <p className="mt-3 rounded-[10px] border border-status-error/25 bg-status-error/[0.08] px-2.5 py-2 text-[12px] leading-relaxed text-status-error">
              {errPct}% request lỗi trong 24h — chủ yếu do{' '}
              {CODE_LABEL[usage.codes[0].status ?? -1] || 'không rõ nguyên nhân'} ({usage.codes[0].n} lần).
            </p>
          )}

          {/* biểu đồ cột theo giờ: đỏ chồng trên xanh */}
          <HourBars hours={usage.hours} />

          <div className="mt-3 flex flex-col gap-1.5">
            {usage.models.map((m) => {
              const max = Math.max(1, ...usage.models.map((x) => x.n));
              return (
                <div key={m.model} className="relative overflow-hidden rounded-lg bg-muted/40">
                  <div className="absolute inset-y-0 left-0 bg-primary/15" style={{ width: `${(m.n / max) * 100}%` }} />
                  <div className="relative flex items-center gap-2 px-2.5 py-1.5 text-[12px]">
                    <span className="min-w-0 flex-1 truncate font-mono">{m.model}</span>
                    <span className="shrink-0 text-[11.5px] text-muted-foreground">{m.n}</span>
                    {!!m.e && <span className="shrink-0 text-[11px] text-status-error">{m.e} lỗi</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-2.5">
            {usage.codes.map((c) => (
              <span key={String(c.status)}
                className="rounded-full border border-border bg-card px-2.5 py-[3px] text-[11px] text-muted-foreground">
                <b className="font-semibold text-status-error">{c.status ?? '?'}</b>{' '}
                {CODE_LABEL[c.status ?? -1] || 'khác'} · {c.n}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* sức khoẻ tài khoản */}
      <Card className="gap-0 p-4" data-testid="agy-accounts">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold text-muted-foreground">
            Tài khoản <span className="text-foreground">{st.accounts}</span>
          </span>
          <span className="text-[11.5px] text-muted-foreground">{st.acc?.recent24h ?? 0} chạy trong 24h</span>
        </div>
        <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-muted/40" data-testid="agy-accbar">
          {accKeys.map((k) => (
            <span key={k} className={ACC_COLOR[k]} title={`${ACC_LABEL[k]}: ${st.acc.status[k]}`}
              style={{ width: `${(st.acc.status[k] / st.acc.total) * 100}%` }} />
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {accKeys.map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <i className={cn('block size-2 shrink-0 rounded-full', ACC_COLOR[k])} />
              {st.acc.status[k]} {ACC_LABEL[k]}
            </span>
          ))}
        </div>
      </Card>

      {/* kiểm tra */}
      <Card className="gap-0 p-4">
        <div className="mb-2.5 text-[13px] font-semibold text-muted-foreground">Kiểm tra</div>
        <div className="flex flex-wrap gap-2">
          {(['typecheck', 'test', 'build'] as const).map((n) => (
            <Button key={n} size="sm" variant="outline" disabled={!!st.task}
              onClick={() => act('run', n)} className="capitalize">
              {n}
            </Button>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {(['typecheck', 'test', 'build'] as const).map((n) => {
            const l = st.last?.[n];
            return (
              <span key={n} className={cn(
                'rounded-full border px-2.5 py-[3px] text-[11px] uppercase',
                l ? (l.ok ? 'border-status-ok/40 text-status-ok' : 'border-status-error/40 text-status-error')
                  : 'border-border text-muted-foreground',
              )}>
                {n}: {l ? (l.ok ? '✓' : '✗') : '—'}
              </span>
            );
          })}
        </div>
      </Card>

      {/* models gom nhóm + tìm kiếm */}
      <Card className="gap-0 p-4" data-testid="agy-models">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[13px] font-semibold text-muted-foreground">
            Models <span className="text-foreground">{st.models.length}</span>
          </span>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="tìm model…"
              data-testid="model-search" className="h-8 w-[150px] pl-8 text-[16px] md:text-[12.5px]" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {(st.modelGroups || []).map((g) => {
            const items = q ? g.items.filter((m) => m.toLowerCase().includes(q.toLowerCase())) : g.items;
            if (!items.length) return null;
            const isOpen = !!q || open[g.name];
            return (
              <div key={g.name} className="overflow-hidden rounded-lg border border-border bg-card"
                data-testid="model-group" data-open={isOpen}>
                <button onClick={() => setOpen((o) => ({ ...o, [g.name]: !o[g.name] }))}
                  className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-accent/50">
                  <span className="font-semibold capitalize">{g.name}</span>
                  <span className="text-[11.5px] text-muted-foreground">{items.length}</span>
                  <ChevronDown className={cn('ml-auto size-4 text-muted-foreground transition-transform',
                    isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="pb-1">
                    {items.map((m) => (
                      <div key={m} className="break-all px-3 py-1 pl-8 font-mono text-[12px] text-muted-foreground">
                        {highlight(m, q)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {q && !(st.modelGroups || []).some((g) => g.items.some((m) => m.toLowerCase().includes(q.toLowerCase()))) && (
            <div className="text-[12.5px] text-muted-foreground">Không có model nào khớp “{q}”</div>
          )}
        </div>
      </Card>

      {/* Log + cấu hình: hai cột trên màn rộng, xếp dọc trên điện thoại */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <AgyLog />
        <AgyConfig />
      </div>
    </div>
    </>
  );
}

function HourBars({ hours }: { hours: { h: string; n: number; e: number }[] }) {
  if (!hours?.length) return null;
  const max = Math.max(1, ...hours.map((h) => h.n));
  return (
    <>
      <div className="mt-3 flex h-[46px] items-end gap-[3px]" data-testid="agy-hours">
        {hours.map((h) => {
          const pct = (h.n / max) * 100;
          const eRatio = h.n ? h.e / h.n : 0;
          return (
            <div key={h.h} className="flex h-full min-w-0 flex-1 flex-col justify-end"
              title={`${h.h}h: ${h.n} request${h.e ? `, ${h.e} lỗi` : ''}`}>
              {h.n ? (
                <>
                  {!!h.e && <div className="rounded-t-sm bg-status-error" style={{ height: `${pct * eRatio}%` }} />}
                  <div className="bg-primary" style={{ height: `${pct * (1 - eRatio)}%` }} />
                </>
              ) : (
                <div className="h-[2px] rounded-sm bg-muted" />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-[3px] flex gap-[3px]">
        {hours.map((h) => (
          <span key={h.h} className="min-w-0 flex-1 text-center text-[9px] text-muted-foreground">{h.h}</span>
        ))}
      </div>
    </>
  );
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-[3px] bg-primary/25 text-foreground">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}
