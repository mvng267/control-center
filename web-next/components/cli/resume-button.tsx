'use client';

import { useState } from 'react';
import { RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export interface ResumeButtonProps {
  sid: string;
  hungMinutes: number;
  onResume?: () => void;
}

/**
 * ResumeButton — Auto-restart hung/dead session
 *
 * Shows when session status = HUNG (process >15min without output).
 * Spawns `claude --resume :sid` to recover from last state in .jsonl.
 */
export function ResumeButton({ sid, hungMinutes, onResume }: ResumeButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleResume = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const result = await api<{ ok: boolean; output?: string; error?: string }>(
        `/api/resume/${sid}`,
        { method: 'POST' }
      );

      if (result.ok) {
        toast.success(`Phiên khôi phục (treo ${hungMinutes} phút)`);
        onResume?.();
      } else {
        toast.error(`Lỗi khôi phục: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      toast.error(`Không khôi phục được phiên`);
      console.error('Resume failed:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-status-run/30 bg-status-run/[0.08] p-3">
      <div className="flex-1">
        <div className="text-[12px] font-medium text-status-run">
          ⏱ Phiên treo {hungMinutes} phút
        </div>
        <div className="text-[12px] text-muted-foreground">
          Bấm khôi phục để tiếp tục từ điểm cuối cùng
        </div>
      </div>
      <Button
        size="sm"
        onClick={handleResume}
        disabled={loading}
        className="shrink-0 tap44"
        variant="outline"
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <RotateCcw className="size-3.5" />
        )}
        Khôi phục
      </Button>
    </div>
  );
}
