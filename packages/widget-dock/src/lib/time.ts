// SPDX-License-Identifier: Apache-2.0
/**
 * Tiny relative-time helper. Avoids pulling date-fns into the bundle
 * just for "3m ago" formatting in list rows.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - Date.parse(iso);
  if (Number.isNaN(diff)) return '—';
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  const days = Math.floor(diff / DAY);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/** Fixed "now" the fixtures were generated against (2026-05-26 22:30 UTC). */
export const FIXTURE_NOW = Date.parse('2026-05-26T22:30:00Z');
