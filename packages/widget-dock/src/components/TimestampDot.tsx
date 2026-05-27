// SPDX-License-Identifier: Apache-2.0
/**
 * Right-aligned timestamp for list rows. Shows relative time with the
 * absolute time as a tooltip via `title`.
 */
import { cn } from '@pinagent/ui/lib/utils';
import { FIXTURE_NOW, relativeTime } from '../lib/time';

export interface TimestampDotProps {
  iso: string;
  className?: string;
}

export function TimestampDot({ iso, className }: TimestampDotProps) {
  return (
    <time
      dateTime={iso}
      title={new Date(iso).toLocaleString()}
      className={cn('shrink-0 text-[11px] text-muted-foreground tabular-nums', className)}
    >
      {relativeTime(iso, FIXTURE_NOW)}
    </time>
  );
}
