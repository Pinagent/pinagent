// SPDX-License-Identifier: Apache-2.0
import { Skeleton } from '@pinagent/ui/components/ui/skeleton';
import { cn } from '@pinagent/ui/lib/utils';
import { useMemo } from 'react';

export interface LoadingStateProps {
  /** Number of placeholder rows to render. */
  rows?: number;
  className?: string;
}

export function LoadingState({ rows = 4, className }: LoadingStateProps) {
  // Skeletons have no semantic identity; React still wants a stable
  // key. Generate fresh UUIDs on mount and memoize so re-renders keep
  // the same keys. Avoids biome's noArrayIndexKey (which traces back
  // through string concat / Array.from index closures).
  const keys = useMemo(
    () =>
      Array.from({ length: rows }, () =>
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2),
      ),
    [rows],
  );
  return (
    <div className={cn('flex flex-col gap-2 p-3', className)} aria-busy>
      {keys.map((key) => (
        <div
          key={key}
          className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
        >
          <Skeleton className="h-2 w-2 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-6 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}
