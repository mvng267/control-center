'use client';

import { useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { Card } from '@/components/ui/card';
import type { Session } from '@/lib/types';

// Cùng bảng màu với biểu đồ cũ để nhìn quen mắt
const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
const OTHER = '#4b5163';

export function StatsTab({ sessions }: { sessions: Session[] }) {
  const d = useMemo(() => {
    const byProj: Record<string, { sessions: number; msgs: number }> = {};
    let active = 0, idle = 0, totalMsgs = 0;
    for (const s of sessions) {
      const pr = (byProj[s.project] ||= { sessions: 0, msgs: 0 });
      pr.sessions++;
      pr.msgs += s.msgs;
      totalMsgs += s.msgs;
      if (s.status === 'IDLE') idle++; else active++;
    }
    const sorted = Object.entries(byProj).sort((a, b) => b[1].sessions - a[1].sessions);
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7).reduce((n, x) => n + x[1].sessions, 0);
    const donut = top.map(([name, v], i) => ({ name, value: v.sessions, fill: COLORS[i] }));
    if (rest > 0) donut.push({ name: 'Khác', value: rest, fill: OTHER });
    const bars = [...sorted].sort((a, b) => b[1].msgs - a[1].msgs).slice(0, 5)
      .map(([name, v]) => ({ name, msgs: v.msgs }));
    return { total: sessions.length, active, idle, totalMsgs, donut, bars };
  }, [sessions]);

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 p-4 pb-24 md:pb-6" data-testid="stats-tab">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="TỔNG PHIÊN" value={d.total} testid="stat-total" />
        <Stat label="ĐANG HOẠT ĐỘNG" value={d.active} tone="text-status-ok" testid="stat-active" />
        <Stat label="NGHỈ" value={d.idle} tone="text-muted-foreground" testid="stat-idle" />
        <Stat label="TIN NHẮN" value={d.totalMsgs} tone="text-primary" testid="stat-msgs" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="gap-0 p-4">
          <div className="mb-3 text-[13px] font-semibold text-muted-foreground">Phiên theo dự án</div>
          <div className="h-[240px]" data-testid="chart-donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={d.donut} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="80%"
                  paddingAngle={2} strokeWidth={0} isAnimationActive={false}>
                  {d.donut.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {d.donut.map((e) => (
              <span key={e.name} className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <i className="block size-2 shrink-0 rounded-full" style={{ background: e.fill }} />
                {e.name} · {e.value}
              </span>
            ))}
          </div>
        </Card>

        <Card className="gap-0 p-4">
          <div className="mb-3 text-[13px] font-semibold text-muted-foreground">Tin nhắn theo dự án</div>
          <div className="h-[240px]" data-testid="chart-bar">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.bars} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'currentColor' }}
                  className="text-muted-foreground" axisLine={false} tickLine={false}
                  tickFormatter={(v: string) => (v.length > 12 ? v.slice(0, 11) + '…' : v)} />
                <Tooltip cursor={{ fill: 'rgba(127,127,127,.12)' }} contentStyle={tooltipStyle} />
                <Bar dataKey="msgs" fill="#3b82f6" radius={[6, 6, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  fontSize: 12,
  color: 'var(--foreground)',
};

function Stat({ label, value, tone, testid }: { label: string; value: number; tone?: string; testid: string }) {
  return (
    <Card className="gap-0 p-4">
      <div className={`text-[26px] font-bold leading-none tracking-tight ${tone || ''}`} data-testid={testid}>
        {value}
      </div>
      <div className="mt-1.5 text-[10.5px] tracking-wide text-muted-foreground">{label}</div>
    </Card>
  );
}
