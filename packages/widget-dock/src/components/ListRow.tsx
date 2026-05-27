// SPDX-License-Identifier: Apache-2.0
/**
 * The dock's canonical list row. Used by Overview, Conversations, and
 * Changes — all three lists share the same density and shape so the
 * visual rhythm carries across screens.
 *
 * Layout:
 *   [status badge]  Title                                    timestamp
 *                   AnchorChip · message preview             [actions ▸]
 */
import type { ReactNode } from 'react';
import { StatusBadge } from '@pinagent/ui/components/status-badge';
import type { StatusKey } from '@pinagent/ui/tokens';
import { cn } from '@pinagent/ui/lib/utils';
import { TimestampDot } from './TimestampDot';

export interface ListRowProps {
  status: StatusKey;
  title: string;
  /** Lines below the title. AnchorChip + preview typically. */
  meta?: ReactNode;
  updatedAt: string;
  /** Right-side action cluster (buttons, dropdowns, multi-select checkbox). */
  actions?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function ListRow({
  status,
  title,
  meta,
  updatedAt,
  actions,
  selected = false,
  onClick,
  className,
}: ListRowProps) {
  const interactive = !!onClick;
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        'group flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5',
        'transition-colors',
        interactive &&
          'cursor-pointer hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        selected && 'border-foreground/40 bg-secondary/60',
        className,
      )}
    >
      <StatusBadge
        status={status}
        variant="dot"
        pulse={status === 'working'}
        className="mt-1.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <h3 className="flex-1 text-sm font-medium leading-tight text-foreground truncate">
            {title}
          </h3>
          <TimestampDot iso={updatedAt} className="mt-0.5" />
        </div>
        {meta && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
      {actions && (
        <div
          className="flex items-center gap-1 shrink-0"
          // Don't trigger row click when interacting with actions.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
