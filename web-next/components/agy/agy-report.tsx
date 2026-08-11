'use client';

import { useEffect, useState } from 'react';
import {
  AreaChart, Area, XAxis, CartesianGrid, ResponsiveContainer, Tooltip,
} from 'recharts';
import { ArrowLeftRight, CircleCheck, Coins, Timer, Download, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Segmented } from '@/components/ui/segmented';
import { RankList } from '@/components/ui/rank-list';
import { DonutCard } from '@/components/ui/donut-card';
import { Button } from '@/components/ui/button';

/* Báo cáo lưu lượng agy-proxy, lấy qua API chính thức (/api/agy/report).
   Trước đây tab AGY đọc SQLite nên "Lưu lượng 24 giờ" toàn số 0 trong khi thực tế
   có 8.700 request — API mới có phân rã theo API key, độ trễ p95 và tỉ lệ thành công. */

const RANGES = [
  { id: '7d', label: '7 ngày' },
  { id: '30d', label: '30 ngày' },
  { id: '90d', label: '90 ngày' },
] as const;
type Range = (typeof RANGES)[number]['id'];

interface Diem { bucket: string; requests: number; tokIn: number; tokOut: number }
interface Hang { requests: number; tokIn: number; tokOut: number }
interface Rep {
  ok: boolean; error?: string; range?: string;
  usage?: {
    totals: { requests: number; tokIn: number; tokOut: number; accounts: number };
    series: Diem[];
    byModel: (Hang & { model: string })[];
    byAccount: (Hang & { email: string })[];
    byApiKey: (Hang & { apiKeyId: string; name: string })[];
  };
  stats?: { providers: { provider: string; label: string; n: number; okRate: number; p95: number }[] } | null;
  quota?: { geminiAvg: number; thirdPartyAvg: number; total: number } | null;
}

const gon = (n: number) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
    : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);

/* Series từ agy THƯA — chỉ có bucket của ngày CÓ dữ liệu, không có dòng 0.
   Vẽ thẳng thì biểu đồ méo: hai ngày cách nhau một tuần trông như liền kề. */
function dienNgayTrong(series: Diem[], range: Range): Diem[] {
  // KHÔNG thoát sớm khi rỗng: đó đúng là lúc cần điền nhất, nếu không biểu đồ trắng
  // trơn không trục không lưới, nhìn như hỏng.
  const ngay = range === '90d' ? 90 : range === '30d' ? 30 : 7;
  const co = new Map(series.map((d) => [d.bucket, d]));
  const out: Diem[] = [];
  const hnay = new Date(); hnay.setHours(0, 0, 0, 0);
  for (let i = ngay - 1; i >= 0; i--) {
    const d = new Date(hnay.getTime() - i * 86400000);
    // bucket agy là chuỗi YYYY-MM-DD theo giờ LOCAL của server, không phải epoch/UTC
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push(co.get(key) || { bucket: key, requests: 0, tokIn: 0, tokOut: 0 });
  }
  return out;
}

export function AgyReport() {
  const [range, setRange] = useState<Range>('7d');
  const [r, setR] = useState<Rep | null>(null);
  const [dangTai, setDangTai] = useState(true);

  useEffect(() => {
    let alive = true;
    setDangTai(true);
    // chỉ tải khi mở tab / đổi dải — KHÔNG poll nền, vì /api/gateway/stats quét bảng
    api<Rep>('/api/agy/report?range=' + range)
      .then((x) => { if (alive) { setR(x); setDangTai(false); } })
      .catch(() => { if (alive) { setR({ ok: false, error: 'không gọi được' }); setDangTai(false); } });
    return () => { alive = false; };
  }, [range]);

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] font-semibold">Báo cáo lưu lượng</span>
      <Segmented items={RANGES} value={range} onChange={setRange} testid="agy-range" size="sm" />
      <Button variant="outline" size="sm" className="tap44 ml-auto h-8 text-[12px]"
        data-testid="agy-csv" title="Tải toàn bộ request dạng CSV"
        onClick={() => { location.href = '/api/agy/export.csv?range=' + range; }}>
        <Download className="size-3.5" /> CSV
      </Button>
    </div>
  );

  if (dangTai && !r) {
    return <Card className="gap-0 p-4" data-testid="agy-report">{header}
      <p className="py-8 text-center text-[13px] text-muted-foreground">Đang tải báo cáo…</p></Card>;
  }

  if (!r?.ok) {
    return (
      <Card className="gap-0 p-4" data-testid="agy-report">
        {header}
        <p className="mt-3 rounded-[10px] border border-amber-500/25 bg-amber-500/[0.08] px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-500">
          Không lấy được báo cáo từ agy-proxy: {r?.error || 'lỗi không rõ'}.
          Phần trạng thái và lưu lượng 24 giờ ở trên vẫn đọc được từ dữ liệu dự phòng.
        </p>
      </Card>
    );
  }

  /* Không tin agy trả đúng shape: thiếu một trường là ném lỗi giữa lúc render, mà
     web-next chưa có error boundary nên trắng CẢ dashboard chứ không riêng thẻ này. */
  const raw = r.usage;
  const u = {
    totals: raw?.totals ?? { requests: 0, tokIn: 0, tokOut: 0, accounts: 0 },
    series: Array.isArray(raw?.series) ? raw!.series : [],
    byModel: Array.isArray(raw?.byModel) ? raw!.byModel : [],
    byAccount: Array.isArray(raw?.byAccount) ? raw!.byAccount : [],
    byApiKey: Array.isArray(raw?.byApiKey) ? raw!.byApiKey : [],
  };
  const diem = dienNgayTrong(u.series, range);
  const nhaCC = (Array.isArray(r.stats?.providers) ? r.stats!.providers : [])
    .filter((x) => x && typeof x.okRate === 'number' && typeof x.n === 'number');
  const tongN = nhaCC.reduce((a, p) => a + p.n, 0);
  // Tỉ lệ thành công gộp — cân theo số request của từng nhà cung cấp
  const okRate = tongN > 0
    ? Math.round(nhaCC.reduce((a, p) => a + p.okRate * p.n, 0) / tongN * 100) : null;
  const p95 = nhaCC.length ? Math.max(...nhaCC.map((p) => p.p95)) : null;
  const xau = okRate !== null && okRate < 70;

  return (
    <div className="flex flex-col gap-4" data-testid="agy-report">
      <Card className="gap-0 p-4">{header}</Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Request" sub="request" icon={ArrowLeftRight}
          value={gon(u.totals.requests)} spark={diem.map((d) => d.requests)}
          deltaLabel={`${u.totals.accounts} account`} testid="rp-req" />
        <StatCard title="Thành công" sub="tỉ lệ thành công" icon={CircleCheck}
          value={okRate === null ? '—' : okRate + '%'}
          tone={okRate === null ? 'idle' : xau ? 'error' : 'ok'}
          dot={okRate === null ? 'idle' : xau ? 'error' : 'ok'}
          deltaLabel={okRate === null ? 'chưa có mẫu' : `${gon(tongN)} lượt gọi`} testid="rp-ok" />
        <StatCard title="Token" sub="token vào" icon={Coins}
          value={gon(u.totals.tokIn)} spark={diem.map((d) => d.tokIn)}
          deltaLabel={`ra ${gon(u.totals.tokOut)}`} testid="rp-tok" />
        <StatCard title="Độ trễ" sub="độ trễ p95" icon={Timer}
          value={p95 === null ? '—' : (p95 / 1000).toFixed(1) + 's'}
          tone={p95 !== null && p95 > 10000 ? 'warn' : 'primary'}
          deltaLabel="95% request nhanh hơn mức này" testid="rp-p95" />
      </div>

      {xau && (
        <div className="flex items-start gap-2 rounded-[10px] border border-status-error/30 bg-status-error/[0.07] px-3 py-2.5"
          data-testid="rp-canhbao">
          <TriangleAlert className="mt-[2px] size-4 shrink-0 text-status-error" />
          <p className="text-[12.5px] leading-relaxed text-status-error">
            Chỉ <b>{okRate}%</b> request thành công — phần lớn lượt gọi bị lỗi. Thường do
            account hết hạn mức hoặc bị nhà cung cấp chặn tốc độ. Xem bảng tài khoản bên
            dưới, hoặc bấm <b>Gỡ cooldown</b> ở phần điều khiển.
          </p>
        </div>
      )}

      <Card className="gap-0 p-4">
        <div className="mb-1 text-[13px] font-semibold">Request theo ngày</div>
        <div className="mb-3 text-[12px] text-muted-foreground">
          {range === '7d' ? '7 ngày' : range === '30d' ? '30 ngày' : '90 ngày'} gần nhất
        </div>
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={diem} margin={{ top: 14, right: 8, bottom: 4, left: 8 }}>
              <defs>
                <linearGradient id="rpFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 8" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                axisLine={false} tickLine={false} minTickGap={24}
                tickFormatter={(v: string) => v.slice(5)} />
              <Tooltip contentStyle={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 10, fontSize: 12, color: 'var(--foreground)',
              }} />
              <Area type="monotone" dataKey="requests" name="request" stroke="var(--primary)"
                strokeWidth={1.8} fill="url(#rpFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* HẠN MỨC CÒN LẠI theo ngày — /api/agy/quota-history có sẵn ở server từ lâu
          nhưng KHÔNG giao diện nào gọi tới, nên dữ liệu này chưa từng hiện ra.
          Đây là thứ đáng nhìn nhất khi pool sắp cạn: trung bình % còn lại mỗi ngày,
          tách Gemini và bên thứ ba vì hai nhóm cạn theo nhịp khác nhau. */}
      <QuotaHistory range={range} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-0 p-4">
          <div className="mb-1 text-[13px] font-semibold">Model dùng nhiều nhất</div>
          <div className="mb-2 text-[12px] text-muted-foreground">{u.byModel.length} model</div>
          <RankList mono testid="rp-model"
            rows={u.byModel.map((m) => ({ label: m.model, value: m.requests }))} />
        </Card>

        <Card className="gap-0 p-4">
          <div className="mb-1 text-[13px] font-semibold">Theo API key</div>
          <div className="mb-3 text-[12px] text-muted-foreground">Ai đang gọi nhiều</div>
          <DonutCard testid="rp-key" tongLabel="Request"
            data={u.byApiKey.map((k) => ({ name: k.name || k.apiKeyId, value: k.requests }))} />
        </Card>
      </div>

      <Card className="gap-0 p-4">
        <div className="mb-1 text-[13px] font-semibold">Account dùng nhiều nhất</div>
        <div className="mb-2 text-[12px] text-muted-foreground">
          {u.byAccount.length} account có lưu lượng
        </div>
        <RankList mono max={8} testid="rp-acc"
          rows={u.byAccount.map((a) => ({ label: a.email, value: a.requests }))} />
      </Card>
    </div>
  );
}

/* ---- Hạn mức còn lại theo ngày ----
   Server đã có /api/agy/quota-history từ lâu mà KHÔNG giao diện nào gọi — kiểm bằng
   cách quét toàn bộ web-next tìm chuỗi '/api/agy/quota-history': 0 kết quả. Dữ liệu
   thật có sẵn (7 điểm, gemini 90-94%, third 29-87%), chỉ thiếu chỗ vẽ.

   Vẽ HAI đường vì Gemini và bên thứ ba cạn theo nhịp khác hẳn nhau: gộp trung bình
   lại thì một nhóm sắp hết vẫn bị nhóm kia kéo lên nhìn như còn nhiều. */
interface DiemQuota { bucket: string; gemini: number; third: number; n: number }

function QuotaHistory({ range }: { range: Range }) {
  const [diem, setDiem] = useState<DiemQuota[] | null>(null);
  const [hong, setHong] = useState('');

  useEffect(() => {
    let alive = true;
    setDiem(null); setHong('');
    api<{ ok: boolean; series?: DiemQuota[]; error?: string }>(
      '/api/agy/quota-history?range=' + range)
      .then((x) => {
        if (!alive) return;
        if (!x.ok) { setHong(x.error || 'agy chưa hỗ trợ mục này'); return; }
        setDiem(x.series || []);
      })
      .catch(() => { if (alive) setHong('không gọi được'); });
    return () => { alive = false; };
  }, [range]);

  if (hong) {
    return (
      <Card className="gap-0 p-4" data-testid="agy-quota-history">
        <div className="mb-1 text-[13px] font-semibold">Hạn mức còn lại</div>
        <p className="text-[12px] text-muted-foreground">Không lấy được: {hong}</p>
      </Card>
    );
  }
  if (!diem) {
    return (
      <Card className="gap-0 p-4" data-testid="agy-quota-history">
        <div className="mb-1 text-[13px] font-semibold">Hạn mức còn lại</div>
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">Đang tải…</p>
      </Card>
    );
  }

  // Ngày gần nhất — để nói thẳng con số thay vì bắt người đọc dò trên đường cong
  const cuoi = diem[diem.length - 1];

  return (
    <Card className="gap-0 p-4" data-testid="agy-quota-history">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold">Hạn mức còn lại</span>
        {cuoi && (
          <span className="text-[11.5px] text-muted-foreground">
            mới nhất — Gemini <b className="tabular-nums text-foreground">{cuoi.gemini}%</b>,
            bên thứ ba <b className="tabular-nums text-foreground">{cuoi.third}%</b>
          </span>
        )}
      </div>
      <div className="mb-2 text-[12px] text-muted-foreground">
        Trung bình % còn lại mỗi ngày · càng thấp càng sắp cạn
      </div>
      {/* Chú giải màu: hai đường mà không có chú giải thì nhìn ảnh không biết đường
          nào là nhóm nào — phải rê chuột lên tooltip mới đoán ra. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <i className="h-[3px] w-4 rounded-full bg-primary" /> Gemini
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-[3px] w-4 rounded-full bg-tool-accent" /> Bên thứ ba
        </span>
      </div>

      {!diem.length ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">Chưa có dữ liệu</p>
      ) : (
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={diem} margin={{ top: 14, right: 8, bottom: 4, left: 8 }}>
              <defs>
                <linearGradient id="qhGem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="qhThird" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--tool-accent)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--tool-accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 8" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                axisLine={false} tickLine={false} minTickGap={24}
                tickFormatter={(v: string) => v.slice(5)} />
              <Tooltip contentStyle={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 10, fontSize: 12, color: 'var(--foreground)',
              }} formatter={(v) => (v === undefined || v === null ? '—' : v + '%')} />
              <Area type="monotone" dataKey="gemini" name="Gemini" stroke="var(--primary)"
                strokeWidth={1.8} fill="url(#qhGem)" isAnimationActive={false} />
              <Area type="monotone" dataKey="third" name="Bên thứ ba" stroke="var(--tool-accent)"
                strokeWidth={1.8} fill="url(#qhThird)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
