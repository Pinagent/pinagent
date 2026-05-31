// SPDX-License-Identifier: Elastic-2.0

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse an ISO string to a Date, or `null` if it isn't a valid date. */
function toDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Friendly UTC date, e.g. `2026-05-01T…` → `1 May 2026`. Formatted manually in
 * UTC (not `Intl`) so output is deterministic across runtimes/locales. Returns
 * the raw input unchanged when it isn't a parseable date.
 */
export function formatDate(iso: string): string {
  const d = toDate(iso);
  if (!d) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Friendly UTC date + time, e.g. `30 May 2026, 12:00 UTC`. */
export function formatDateTime(iso: string): string {
  const d = toDate(iso);
  if (!d) return iso;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(iso)}, ${hh}:${mm} UTC`;
}

/** Human-readable duration from seconds, e.g. `90061` → `25h 1m`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s && !h) parts.push(`${s}s`); // drop seconds once we're into hours
  return parts.join(' ') || '0s';
}
