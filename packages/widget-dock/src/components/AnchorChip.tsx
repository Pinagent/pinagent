// SPDX-License-Identifier: Apache-2.0
/**
 * Compact anchor descriptor — shows `file:line:col` (truncated by the
 * filename) with optional selector preview underneath. Used in list
 * rows and conversation headers.
 */

import { cn } from '@pinagent/ui/lib/utils';
import { FileCode } from 'lucide-react';

export interface AnchorChipProps {
  loc: string;
  selector?: string;
  className?: string;
  /** When true, omit the icon (for ultra-dense rows). */
  bare?: boolean;
}

function shortFile(loc: string): string {
  // `src/marketing/Hero.tsx:42:8` → `Hero.tsx:42`
  const [path, line] = loc.split(':');
  const filename = path?.split('/').pop() ?? path ?? '';
  return line ? `${filename}:${line}` : filename;
}

export function AnchorChip({ loc, selector, className, bare = false }: AnchorChipProps) {
  return (
    <span
      title={selector ? `${loc} — ${selector}` : loc}
      className={cn(
        'inline-flex items-center gap-1 rounded-md',
        'bg-secondary/70 px-1.5 py-0.5',
        'font-mono text-[10.5px] text-muted-foreground',
        'border border-transparent hover:border-border transition-colors',
        'max-w-full min-w-0',
        className,
      )}
    >
      {!bare && <FileCode className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="truncate">{shortFile(loc)}</span>
    </span>
  );
}
