// SPDX-License-Identifier: Apache-2.0

import { isNotionalCost } from '@pinagent/shared';
import { cn } from '@pinagent/ui/lib/utils';
import { type CostBadgeTone, formatCostBadge } from '../lib/cost';

/**
 * Running-cost chip used on both the list row and the detail header.
 * Shows `$0.12 / $5.00` when the per-conversation cap is configured,
 * `$0.12` otherwise. Color-shifts as spending approaches the cap so
 * a long-running conversation surfaces the cliff *before* the next
 * turn gets refused by `agent.ts.checkCostCaps`.
 *
 * For OAuth/subscription runs (`isNotionalCost(apiKeySource)`), the
 * dollar figure is notional — billed against the Claude subscription
 * quota, not a card — so we relabel to `subscription` and tuck the
 * API-equivalent amount into the tooltip, mirroring the in-page widget
 * footer. The cap comparison/tone is skipped since there's no real
 * spend to track against it.
 *
 * Caller already gates rendering on `cost > 0` — we never render `$0`.
 */
export function CostChip({
  cost,
  cap,
  prefix = '',
  size = 'sm',
  apiKeySource,
}: {
  cost: number;
  cap: number | null | undefined;
  prefix?: string;
  size?: 'sm' | 'md';
  apiKeySource?: string | null;
}) {
  const sizeClass = size === 'sm' ? 'text-[10px]' : 'text-[10.5px]';
  if (isNotionalCost(apiKeySource)) {
    return (
      <span
        className={cn('tabular-nums', sizeClass, 'text-muted-foreground')}
        title={`≈ $${cost.toFixed(4)} API-equivalent (not billed — Claude subscription)`}
      >
        {prefix}
        subscription
      </span>
    );
  }
  const badge = formatCostBadge(cost, cap ?? undefined);
  return (
    <span
      className={cn('tabular-nums', sizeClass, toneToClass(badge.tone))}
      title={
        cap
          ? `Running SDK cost — per-conversation cap is ${formatCostBadge(cap, undefined).label}`
          : 'Running SDK cost for this conversation'
      }
    >
      {prefix}
      {badge.label}
    </span>
  );
}

function toneToClass(tone: CostBadgeTone): string {
  switch (tone) {
    case 'over':
      return 'text-status-error-fg font-medium';
    case 'warn':
      return 'text-status-awaiting-fg font-medium';
    default:
      return 'text-muted-foreground';
  }
}
