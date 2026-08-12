'use client';

import { useMemo } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Legend,
} from 'recharts';
import { Download, Layers, Activity, Moon, MessageSquare } from 'lucide-react';
import { PageHeader } from '@/components/layout/app-shell';
import { StatCard } from '@/components/ui/stat-card';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Session } from '@/lib/types';

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];
const OTHER = '#4b5163';

const tooltipStyle = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 10, fontSize: 12, color: 'var(--foreground)',
};

export function StatsTab({ sessions: tatCa }: { sessions: Session[] }) {
  /* LOẠI PHIÊN NHÁP khỏi mọi biểu đồ. Đo trên máy này: 28/133 phiên nằm trong thư mục
     tạm /tmp/claude-* do test sinh ra — trước đây chúng chiếm tới 27/100 lát donut,
     đẩy cả "cmdtest" và "permtest" lên làm dự án lớn. Biểu đồ phải nói về công việc
     thật, không phải về rác test. */
  const sessions = useMemo(() => tatCa.filter((s) => !s.duAn?.laNhap), [tatCa]);

  const d = useMemo(() => {
    const byProj: Record<string, { sessions: number; msgs: number }> = {};
    let active = 0, idle = 0, totalMsgs = 0;
    for (const s of sessions) {
      // duAn.ten là tên thư mục thật; s.project giờ cũng bằng nó nhưng ưu tiên duAn
      // để nếu sau này gỡ trường project đi thì chỗ này không vỡ.
      const pr = (byProj[s.duAn?.ten || s.project] ||= { sessions: 0, msgs: 0 });
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
    const bars = [...sorted].sort((a, b) => b[1].msgs - a[1].msgs).slice(0, 6)
      .map(([name, v]) => ({ name: name.length > 14 ? name.slice(0, 13) + '…' : name, msgs: v.msgs }));

    // mtimeMs = lần SỬA CUỐI của phiên, nên đây là 'phiên hoạt động lần cuối vào ngày nào',
    // KHÔNG phải 'phiên tạo mới mỗi ngày'. Nhãn phải nói đúng điều đó.
    // Mốc phải là 0h TỪNG NGÀY, không phải "now trừ đi n×24h": tính theo now thì ô cuối
    // là 24h tới (luôn rỗng) còn phiên của hôm nay rơi hết sang ô kế bên -> badge -100% giả.
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const dayStart = (back: number) => midnight.getTime() - back * 86400000;
    const days = Array.from({ length: 7 }, (_, i) => {
      const from = dayStart(6 - i);
      const to = from + 86400000;
      return sessions.filter((s) => s.mtimeMs >= from && s.mtimeMs < to).length;
    });
    // Sparkline cho CẢ 4 thẻ, không chỉ thẻ đầu — Atlas thẻ nào cũng có đường xu
    // hướng, thiếu thì 4 thẻ nhìn so le. Cùng khung 7 ngày, khác bộ lọc.
    const daySeries = (pick: (s: Session) => boolean, val?: (s: Session) => number) =>
      Array.from({ length: 7 }, (_, i) => {
        const from = dayStart(6 - i);
        const hit = sessions.filter((s) => s.mtimeMs >= from && s.mtimeMs < from + 86400000 && pick(s));
        return val ? hit.reduce((a, s) => a + val(s), 0) : hit.length;
      });
    const isRun = (s: Session) => s.status === 'RUNNING' || s.status === 'ACTIVE';
    const daysActive = daySeries(isRun);
    const daysIdle = daySeries((s) => !isRun(s));
    const daysMsgs = daySeries(() => true, (s) => s.msgs || 0);

    const dayRows = days.map((n, i) => ({
      day: new Date(dayStart(6 - i)).toLocaleDateString('vi-VN', { weekday: 'short' }),
      phiên: n,
    }));

    // So hôm nay với TRUNG BÌNH 6 ngày trước — so với đúng hôm qua thì hôm qua bằng 0
    // là ra -100% vô nghĩa. Không đủ dữ liệu thì không hiện badge.
    const today = days[6];
    const prevAvg = days.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
    const delta = prevAvg >= 1 ? Math.round(((today - prevAvg) / prevAvg) * 100) : undefined;

    const recent = [...sessions].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 6);
    return { total: sessions.length, active, idle, totalMsgs, donut, bars, days,
      daysActive, daysIdle, daysMsgs, dayRows, delta, recent };
  }, [sessions]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sessions }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'thong-ke-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <>
      <PageHeader title="Thống kê" count={d.total} desc="Tổng quan phiên và tin nhắn theo dự án."
        actions={
          <Button variant="outline" size="sm" className="tap44 h-9 gap-1.5" onClick={exportJson}
            data-testid="stats-export">
            <Download className="size-3.5" /> Export
          </Button>
        } />

      <div className="flex flex-col gap-4 px-4 pb-24 md:px-6 md:pb-6" data-testid="stats-tab">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard title="Tổng phiên" sub="tổng phiên" icon={Layers} value={d.total} spark={d.days}
            delta={d.delta} deltaLabel={d.delta === undefined ? 'tất cả dự án' : 'so với trung bình tuần'} tone="primary" dot="primary" testid="stat-total" />
          <StatCard title="Đang hoạt động" sub="đang hoạt động" icon={Activity} value={d.active}
            spark={d.daysActive} tone="ok" dot={d.active ? 'ok' : 'idle'} testid="stat-active" />
          <StatCard title="Nghỉ" sub="nghỉ" icon={Moon} value={d.idle} spark={d.daysIdle}
            tone="idle" dot="idle" testid="stat-idle" />
          <StatCard title="Tin nhắn" sub="tin nhắn" icon={MessageSquare} value={d.totalMsgs.toLocaleString('vi-VN')}
            spark={d.daysMsgs} tone="primary" testid="stat-msgs" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gap-0 p-4">
            <div className="mb-3">
              <div className="text-[14px] font-semibold">Phiên theo dự án</div>
              <div className="mt-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                PHÂN BỔ
              </div>
            </div>
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
            <div className="mb-3">
              <div className="text-[14px] font-semibold">Tin nhắn theo dự án</div>
              <div className="mt-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                TOP 6
              </div>
            </div>
            <div className="h-[240px]" data-testid="chart-bar">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.bars} margin={{ top: 14, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="4 8" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    axisLine={false} tickLine={false} interval={0} angle={-18} textAnchor="end" height={44} />
                  {/* Atlas KHÔNG có trục Y (đo: 0 phần tử .recharts-yAxis). Bỏ đi cho
                      thoáng, bù lại ghi số ngay trên đỉnh cột nên vẫn đọc được giá trị. */}
                  <Tooltip cursor={{ fill: 'rgba(127,127,127,.12)' }} contentStyle={tooltipStyle} />
                  <Bar dataKey="msgs" fill="#3b82f6" radius={[6, 6, 0, 0]} isAnimationActive={false}
                    label={{ position: 'top', fontSize: 10, fill: 'var(--muted-foreground)' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* hàng dưới: lấp khoảng trống — hoạt động 7 ngày + phiên gần đây */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="gap-0 p-4">
            <div className="mb-3">
              <div className="text-[14px] font-semibold">Hoạt động 7 ngày</div>
              <div className="mt-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                PHIÊN CHẠM LẦN CUỐI
              </div>
            </div>
            <div className="h-[200px]" data-testid="chart-days">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.dayRows} margin={{ top: 14, right: 8, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="4 8" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    axisLine={false} tickLine={false} />
                  {/* Atlas KHÔNG có trục Y (đo: 0 phần tử .recharts-yAxis). Bỏ đi cho
                      thoáng, bù lại ghi số ngay trên đỉnh cột nên vẫn đọc được giá trị. */}
                  <Tooltip cursor={{ fill: 'rgba(127,127,127,.12)' }} contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="phiên" fill="#8b5cf6" radius={[6, 6, 0, 0]} isAnimationActive={false}
                    label={{ position: 'top', fontSize: 10, fill: 'var(--muted-foreground)' }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="gap-0 p-4">
            <div className="mb-3">
              <div className="text-[14px] font-semibold">Phiên gần đây</div>
              <div className="mt-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                MỚI CẬP NHẬT
              </div>
            </div>
            <div className="flex flex-col" data-testid="recent-list">
              {d.recent.map((s) => (
                <div key={s.sid} className="flex items-center gap-2.5 border-b border-border py-2 last:border-0">
                  <span className={`size-1.5 shrink-0 rounded-full ${
                    s.status === 'RUNNING' ? 'bg-status-ok' : s.status === 'ACTIVE' ? 'bg-primary' : 'bg-status-idle'
                  }`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{s.title || s.sid.slice(0, 8)}</span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">{s.duAn?.ten || s.project}</span>
                  </span>
                  <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{s.msgs} tin</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
