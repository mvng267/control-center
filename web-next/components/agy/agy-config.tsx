'use client';

import { useEffect, useState } from 'react';
import { SlidersHorizontal, Check, RotateCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface Field { key: string; value: string; desc: string }
interface ConfigRes { file: string; fields: Field[] }

export function AgyConfig() {
  const [cfg, setCfg] = useState<ConfigRes | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<ConfigRes>('/api/agy/config')
      .then((r) => { if (alive) { setCfg(r); setDraft(Object.fromEntries(r.fields.map((f) => [f.key, f.value]))); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const save = async (f: Field) => {
    const value = (draft[f.key] ?? '').trim();
    if (value === f.value) return;
    setSaving(f.key);
    try {
      // Server whitelist từng khoá và tự kiểm định dạng — lỗi trả về là câu tiếng Việt
      // giải thích được, nên hiện thẳng thay vì nuốt đi.
      const r = await api<{ ok: boolean; restart?: boolean; error?: string }>('/api/agy/config', {
        method: 'POST', body: JSON.stringify({ key: f.key, value }),
      });
      if (!r.ok) { toast.error(r.error || 'Không lưu được'); return; }
      setCfg((c) => c && { ...c, fields: c.fields.map((x) => (x.key === f.key ? { ...x, value } : x)) });
      toast.success(r.restart ? `Đã lưu ${f.key} — cần Restart để có hiệu lực` : `Đã lưu ${f.key}`);
      navigator.vibrate?.(10);
    } catch { toast.error('Lỗi mạng'); }
    finally { setSaving(null); }
  };

  const restart = async () => {
    try {
      await api('/api/agy/restart', { method: 'POST', body: '{}' });
      toast.success('Đang khởi động lại agy-proxy');
    } catch { toast.error('Không khởi động lại được'); }
  };

  if (!cfg) return null;

  return (
    <Card className="gap-0 p-4" data-testid="agy-config">
      <div className="mb-1 flex items-center gap-2">
        <SlidersHorizontal className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-semibold">Cấu hình</span>
        <Button variant="outline" size="sm" className="ml-auto h-7 text-[12px]"
          data-testid="agy-restart" onClick={restart}>
          <RotateCw className="size-3.5" /> Restart
        </Button>
      </div>
      <p className="mb-3 truncate font-mono text-[11px] text-muted-foreground" title={cfg.file}>{cfg.file}</p>

      <div className="flex flex-col gap-3">
        {cfg.fields.map((f) => {
          const changed = (draft[f.key] ?? '') !== f.value;
          return (
            <div key={f.key} className="flex flex-col gap-1.5" data-testid="agy-field" data-key={f.key}>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[12px] font-medium">{f.key}</span>
                {changed && <span className="text-[10.5px] text-amber-500">chưa lưu</span>}
              </div>
              <div className="flex items-center gap-2">
                <Input value={draft[f.key] ?? ''} data-testid={'field-' + f.key}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && save(f)}
                  className="h-8 flex-1 font-mono text-[16px] md:text-[12.5px]" />
                <Button size="icon" variant={changed ? 'default' : 'ghost'} className="size-8 shrink-0"
                  disabled={!changed || saving === f.key} onClick={() => save(f)}
                  data-testid={'save-' + f.key} title="Lưu">
                  <Check className="size-3.5" />
                </Button>
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
