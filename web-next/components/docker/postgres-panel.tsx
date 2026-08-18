'use client';

import { useEffect, useState } from 'react';
import { Database, TriangleAlert, Table2, Activity } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { RankList } from '@/components/ui/rank-list';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';

/* Xem sức khoẻ Postgres chạy trong Docker.

   Máy này KHÔNG có psql (đã kiểm: `which psql` rỗng, không gói homebrew nào) nên
   server đi qua `docker exec` vào chính container — giữ đúng nguyên tắc zero-dependency.

   CHỈ ĐỌC. Không có nút xoá bảng, không nhận SQL tự do: bảng truy vấn nằm cứng ở
   server, client chỉ gửi tên database. Đây là dashboard bấm trên điện thoại, một cú
   chạm nhầm vào DROP TABLE là mất dữ liệu thật. */

interface Db { ten: string; bytes: number }
interface Bang { ten: string; dong: number; bytes: number }
interface KetNoi { trangThai: string; n: number }
interface TruyVan { pid: string; trangThai: string; lau: string; sql: string }

interface TrangThai {
  ok: boolean; error?: string; container?: string;
  version?: string; uptime?: string; dbs?: Db[]; ketNoi?: KetNoi[];
}

const gonByte = (n: number) => {
  if (!n) return '0';
  if (n >= 1 << 30) return (n / (1 << 30)).toFixed(1) + ' GB';
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB';
  return Math.round(n / 1024) + ' KB';
};

export function PostgresPanel() {
  const [st, setSt] = useState<TrangThai | null>(null);
  const [db, setDb] = useState('');
  const [bang, setBang] = useState<Bang[] | null>(null);
  const [chay, setChay] = useState<TruyVan[]>([]);

  useEffect(() => {
    let alive = true;
    const tai = () => {
      api<TrangThai>('/api/pg/status')
        .then((x) => { if (alive) setSt(x); })
        .catch(() => { if (alive) setSt({ ok: false, error: 'không gọi được server' }); });
      api<{ ok: boolean; truyVan?: TruyVan[] }>('/api/pg/activity')
        .then((x) => { if (alive) setChay(x.ok && x.truyVan ? x.truyVan : []); })
        .catch(() => {});
    };
    tai();
    // 8s: đủ để thấy truy vấn đang chạy mà không gọi docker exec dồn dập
    const t = setInterval(tai, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Chọn sẵn database lớn nhất khi có danh sách
  useEffect(() => {
    if (!db && st?.ok && st.dbs?.length) setDb(st.dbs[0].ten);
  }, [st, db]);

  useEffect(() => {
    if (!db) return;
    let alive = true;
    setBang(null);
    api<{ ok: boolean; bang?: Bang[] }>('/api/pg/tables?db=' + encodeURIComponent(db))
      .then((x) => { if (alive) setBang(x.ok && x.bang ? x.bang : []); })
      .catch(() => { if (alive) setBang([]); });
    return () => { alive = false; };
  }, [db]);

  if (!st) {
    return (
      <Card className="gap-0 p-4" data-testid="pg-panel">
        <div className="mb-1 flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          <span className="text-[14px] font-semibold">PostgreSQL</span>
        </div>
        <p className="py-6 text-center text-[14px] text-muted-foreground">Đang kiểm tra…</p>
      </Card>
    );
  }

  if (!st.ok) {
    return (
      <Card className="gap-0 p-4" data-testid="pg-panel">
        <div className="mb-2 flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          <span className="text-[14px] font-semibold">PostgreSQL</span>
        </div>
        <p className="flex items-start gap-2 rounded-[10px] border border-border bg-muted/40 px-2.5 py-2 text-[12px] leading-relaxed text-muted-foreground"
          data-testid="pg-tat">
          <TriangleAlert className="mt-[2px] size-3.5 shrink-0" />
          {st.error || 'Không kết nối được'} — bật container Postgres ở danh sách trên
          rồi khối này tự hiện.
        </p>
      </Card>
    );
  }

  const tongKetNoi = (st.ketNoi || []).reduce((a, k) => a + k.n, 0);
  const dangLam = (st.ketNoi || []).find((k) => k.trangThai === 'active')?.n || 0;

  return (
    <Card className="gap-0 p-4" data-testid="pg-panel">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Database className="size-4 text-status-ok" />
        <span className="text-[14px] font-semibold">PostgreSQL</span>
        <span className="rounded bg-muted px-1.5 py-px font-mono text-[12px] text-muted-foreground">
          {st.version}
        </span>
        <span className="ml-auto text-[12px] text-muted-foreground">
          chạy {st.uptime} · {tongKetNoi} kết nối
          {dangLam > 0 && <b className="text-foreground"> ({dangLam} đang làm việc)</b>}
        </span>
      </div>
      <div className="mb-3 truncate font-mono text-[12px] text-muted-foreground">
        {st.container}
      </div>

      {/* chọn database — dùng chính Segmented của hệ, không tự chế nút mới */}
      {!!st.dbs?.length && (
        <div className="mb-3">
          <Segmented size="sm" testid="pg-db"
            items={st.dbs.map((d) => ({ id: d.ten, label: `${d.ten} · ${gonByte(d.bytes)}` }))}
            value={db} onChange={setDb} />
        </div>
      )}

      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <Table2 className="size-3.5" /> Bảng lớn nhất
      </div>
      {bang === null ? (
        <p className="py-4 text-center text-[12px] text-muted-foreground">Đang đọc…</p>
      ) : !bang.length ? (
        <p className="py-4 text-center text-[12px] text-muted-foreground">
          Database này chưa có bảng nào
        </p>
      ) : (
        /* Xếp theo DUNG LƯỢNG chứ không theo số dòng: bảng 0 dòng vẫn có thể chiếm
           hàng trăm MB vì index và dead tuple chưa được VACUUM dọn. */
        <RankList mono max={8} testid="pg-bang"
          rows={bang.map((b) => ({
            label: b.ten,
            value: b.bytes,
            display: `${gonByte(b.bytes)} · ${b.dong.toLocaleString('vi-VN')} dòng`,
          }))} />
      )}

      {/* Truy vấn đang chạy — chỗ nhìn đầu tiên khi CSDL ì */}
      <div className="mt-4 mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <Activity className="size-3.5" /> Truy vấn đang chạy
      </div>
      {!chay.length ? (
        <p className="text-[12px] text-muted-foreground" data-testid="pg-ranh">
          Không có truy vấn nào đang chạy
        </p>
      ) : (
        <div className="flex flex-col gap-1.5" data-testid="pg-truyvan">
          {chay.map((q) => (
            <div key={q.pid} className="rounded-[10px] border border-border bg-background/50 px-2.5 py-1.5">
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <span className="font-mono">pid {q.pid}</span>
                <span className={cn(q.trangThai === 'active' && 'text-status-ok')}>{q.trangThai}</span>
                <span className="ml-auto tabular-nums">{q.lau}</span>
              </div>
              <div className="truncate font-mono text-[12px]">{q.sql}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
