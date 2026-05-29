// SPDX-License-Identifier: Apache-2.0
/**
 * Compact USD formatter for the per-conversation cost chip, with a
 * tone signal so the caller can color-shift as spending approaches
 * the user's per-conversation cap.
 *
 * When `cap` is provided, the chip shows `$0.12 / $5.00` so the user
 * sees both the running total and where the ceiling is. When the cap
 * is null/undefined/0 (no enforcement), only the running total shows.
 *
 * Tone thresholds key off the percentage of cap:
 *   - <80%       → normal (default muted text)
 *   - 80%–<100%  → warn   (yellow-ish; "you're close")
 *   - >=100%     → over   (red; the next turn will be refused)
 *
 * The USD number→string formatting is shared with the in-page widget
 * tray via `formatCompactUsd` (@pinagent/shared) so the two surfaces
 * can't drift; this module adds the cap-relative tone on top.
 */
import { formatCompactUsd } from '@pinagent/shared';

export type CostBadgeTone = 'normal' | 'warn' | 'over';

export interface CostBadge {
  label: string;
  tone: CostBadgeTone;
}

const WARN_THRESHOLD = 0.8;
// Float-precision slop so $0.08 / $0.10 (which is 0.7999999… in IEEE
// 754) still trips the warn threshold instead of staying "normal".
const RATIO_EPSILON = 1e-9;

export function formatCostBadge(cost: number, cap?: number | null): CostBadge {
  const haveCap = typeof cap === 'number' && Number.isFinite(cap) && cap > 0;
  const label = haveCap
    ? `${formatCompactUsd(cost)} / ${formatCompactUsd(cap as number)}`
    : formatCompactUsd(cost);
  let tone: CostBadgeTone = 'normal';
  if (haveCap) {
    const ratio = cost / (cap as number);
    if (ratio + RATIO_EPSILON >= 1) tone = 'over';
    else if (ratio + RATIO_EPSILON >= WARN_THRESHOLD) tone = 'warn';
  }
  return { label, tone };
}
