// SPDX-License-Identifier: Elastic-2.0

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
