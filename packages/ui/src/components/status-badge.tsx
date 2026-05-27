// SPDX-License-Identifier: Apache-2.0
/**
 * Conversation/change status badge. Reads from the cream-tuned status
 * palette in @pinagent/ui/tokens — guaranteed AA contrast on cream and
 * ink surfaces, and visually distinct from the brand cream/ink/gold so
 * statuses don't compete with chrome for attention.
 *
 * Render as a dot (`variant="dot"`) for tight list rows, or as a labeled
 * chip (`variant="chip"`, default) when the status should be readable
 * without a tooltip.
 */
import { forwardRef, type HTMLAttributes } from 'react';
import type { StatusKey } from '../tokens';
import { cn } from '../lib/utils';

const LABEL: Record<StatusKey, string> = {
  pending: 'Pending',
  working: 'Working',
  awaitingClarification: 'Needs reply',
  readyToLand: 'Ready to land',
  landed: 'Landed',
  discarded: 'Discarded',
  error: 'Error',
  anchorLost: 'Anchor lost',
};

const TONE_CLASS: Record<StatusKey, string> = {
  pending:
    'bg-status-pending-bg text-status-pending-fg border-status-pending-border',
  working:
    'bg-status-working-bg text-status-working-fg border-status-working-border',
  awaitingClarification:
    'bg-status-awaiting-bg text-status-awaiting-fg border-status-awaiting-border',
  readyToLand:
    'bg-status-ready-bg text-status-ready-fg border-status-ready-border',
  landed: 'bg-status-landed-bg text-status-landed-fg border-status-landed-border',
  discarded:
    'bg-status-discarded-bg text-status-discarded-fg border-status-discarded-border',
  error: 'bg-status-error-bg text-status-error-fg border-status-error-border',
  anchorLost:
    'bg-status-anchor-lost-bg text-status-anchor-lost-fg border-status-anchor-lost-border border-dashed',
};

const DOT_TONE_CLASS: Record<StatusKey, string> = {
  pending: 'bg-status-pending-fg',
  working: 'bg-status-working-fg',
  awaitingClarification: 'bg-status-awaiting-fg',
  readyToLand: 'bg-status-ready-fg',
  landed: 'bg-status-landed-fg',
  discarded: 'bg-status-discarded-fg',
  error: 'bg-status-error-fg',
  anchorLost: 'bg-status-anchor-lost-fg',
};

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: StatusKey;
  /** Use a labeled chip (default) or just a colored dot. */
  variant?: 'chip' | 'dot';
  /** Override the default label text on `chip` variant. */
  label?: string;
  /** Pulse the dot — wire this for the `working` status. */
  pulse?: boolean;
}

export const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ status, variant = 'chip', label, pulse = false, className, ...rest }, ref) => {
    if (variant === 'dot') {
      return (
        <span
          ref={ref}
          role="img"
          aria-label={label ?? LABEL[status]}
          className={cn(
            'inline-block h-2 w-2 shrink-0 rounded-full',
            DOT_TONE_CLASS[status],
            pulse && 'animate-pulse motion-reduce:animate-none',
            className,
          )}
          {...rest}
        />
      );
    }
    return (
      <span
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap',
          TONE_CLASS[status],
          className,
        )}
        {...rest}
      >
        <span
          className={cn(
            'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
            DOT_TONE_CLASS[status],
            pulse && 'animate-pulse motion-reduce:animate-none',
          )}
        />
        {label ?? LABEL[status]}
      </span>
    );
  },
);
StatusBadge.displayName = 'StatusBadge';
