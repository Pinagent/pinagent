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

import { StatusBadge } from '@pinagent/ui/components/status-badge';
import { cn } from '@pinagent/ui/lib/utils';
import type { StatusKey } from '@pinagent/ui/tokens';
import type { ReactNode } from 'react';
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
  /**
   * When set, renders a left-side multi-select checkbox. Clicking the
   * checkbox toggles `selected` via `onSelectChange` without firing the
   * row's `onClick` (the click only triggers detail navigation), so
   * "open" and "select" stay distinct gestures.
   */
  onSelectChange?: (selected: boolean) => void;
  /** ARIA label for the multi-select checkbox. Falls back to `title`. */
  selectLabel?: string;
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
  onSelectChange,
  selectLabel,
  className,
}: ListRowProps) {
  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-2.5',
        'transition-colors',
        onClick && 'hover:bg-secondary/40 focus-within:bg-secondary/40',
        selected && 'border-foreground/40 bg-secondary/60',
        className,
      )}
    >
      {/* Overlay button covers the full row so clicking anywhere triggers
          onClick — but the checkbox + actions live in siblings stacked
          above it, so their clicks don't bubble through to the row. */}
      {onClick && (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={selected}
          aria-label={title}
          className={cn(
            'absolute inset-0 z-0 rounded-lg cursor-pointer',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          )}
        />
      )}

      {onSelectChange && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectChange(e.target.checked)}
          // Stop the click from reaching the overlay button below —
          // toggling a checkbox shouldn't also navigate into detail.
          onClick={(e) => e.stopPropagation()}
          aria-label={selectLabel ?? title}
          className={cn(
            'mt-1.5 h-3.5 w-3.5 shrink-0 relative z-10 rounded border-border',
            'accent-foreground cursor-pointer',
          )}
        />
      )}

      <StatusBadge
        status={status}
        variant="dot"
        pulse={status === 'working'}
        className="mt-1.5 relative z-10 pointer-events-none"
      />
      <div className="flex-1 min-w-0 relative z-10 pointer-events-none">
        <div className="flex items-start gap-2">
          <span className="flex-1 text-sm font-medium leading-tight text-foreground truncate">
            {title}
          </span>
          <TimestampDot iso={updatedAt} className="mt-0.5" />
        </div>
        {meta && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-1 shrink-0 relative z-10">{actions}</div>}
    </div>
  );
}
