'use client';

import { cn } from '@/lib/utils';
import { PermSwitch } from './perm-switch';
import { ModelSwitch } from './model-switch';

export interface StatusBarProps {
  perm: string;
  model: string | null;
  effort?: string;
  onPermChange?: (perm: string) => void;
  onModelChange?: (model: string) => void;
  onEffortChange?: (effort: string) => void;
  className?: string;
}

/**
 * StatusBar — Always visible bottom bar with permission + model controls
 *
 * Consolidates perm/model/effort switches into a single reusable component.
 * Previously scattered across input footer, now extracted for responsive tweaking
 * in one place (row on desktop, column on mobile).
 */
export function StatusBar({
  perm,
  model,
  effort,
  onPermChange,
  onModelChange,
  onEffortChange,
  className,
}: StatusBarProps) {
  return (
    <div
      className={cn(
        'shrink-0 flex items-center gap-2 border-t border-border/50 bg-background px-2 py-1.5 text-[12px] text-muted-foreground',
        'md:flex-row md:justify-end',
        'flex flex-col gap-1.5',
        className
      )}
    >
      {/* Perm switch */}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0">Quyền:</span>
        <PermSwitch perm={perm} />
      </div>

      {/* Model switch */}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0">Model:</span>
        <ModelSwitch model={model} />
      </div>

      {/* Effort (optional) */}
      {effort && (
        <div className="flex items-center gap-1.5">
          <span className="shrink-0">Suy ngẫm:</span>
          <span className="font-mono">{effort}</span>
        </div>
      )}
    </div>
  );
}
