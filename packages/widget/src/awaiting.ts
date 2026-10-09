// SPDX-License-Identifier: Apache-2.0
/**
 * Labels for an agent that is blocked on the developer: an open `ask_user`
 * question or a tool-permission prompt. A permission prompt is denied when
 * its TTL lapses, so a wait the developer doesn't notice costs them the
 * tool call. These helpers make the wait visible: a headline ("Approve?"),
 * how long it has been waiting, and how long until it closes.
 *
 * Pure, so the card (stream-handler / status-line) and the running-agents
 * tray (fab-tray) word it identically and the strings are unit-testable.
 */

export type AwaitingKind = 'permission' | 'question';

/** An open ask as the widget tracks it. Times are epoch ms; null = unknown. */
export interface AwaitingAsk {
  askId: string;
  kind: AwaitingKind;
  /** When the ask was shown. */
  since: number | null;
  /** When it closes unanswered (a permission prompt is then denied). */
  expiresAt: number | null;
}

/** Short call to action: "Approve?" for a permission prompt, else a question. */
export function awaitingHeadline(kind: AwaitingKind): string {
  return kind === 'permission' ? 'Approve?' : 'Needs your input';
}

/** Coarse elapsed time: "40s", "3m", "1h 5m". Negative input clamps to 0s. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/**
 * Coarse time *remaining*: rounds up, so 1m59s left reads "2m" (never
 * understating how long the developer has). "45s" under a minute.
 */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  return formatElapsed(m * 60_000);
}

/** Clock-style countdown: "4:05". Negative input clamps to "0:00". */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The minimized card's status line while an ask is open, e.g.
 * "Approve? · auto-deny in 4:05" or "Needs your input · closes in 9:12".
 * Drops the countdown once it has run out or when the expiry is unknown
 * (a replayed ask from an older transcript).
 */
export function cardAwaitingLabel(
  ask: Pick<AwaitingAsk, 'kind' | 'expiresAt'>,
  now: number,
): string {
  const head = awaitingHeadline(ask.kind);
  if (ask.expiresAt === null) return head;
  const left = ask.expiresAt - now;
  if (left <= 0) return head;
  const verb = ask.kind === 'permission' ? 'auto-deny in' : 'closes in';
  return `${head} · ${verb} ${formatCountdown(left)}`;
}

/** The tray row's meta line while an ask is open: "Approve? · waiting 3m". */
export function trayAwaitingMeta(ask: AwaitingAsk, now: number): string {
  const head = awaitingHeadline(ask.kind);
  return ask.since === null ? head : `${head} · waiting ${formatElapsed(now - ask.since)}`;
}

/** Tooltip for a tray row with an open ask: adds the time left, if known. */
export function trayAwaitingTitle(ask: AwaitingAsk, now: number): string {
  const parts = [
    ask.kind === 'permission'
      ? 'The agent is waiting for you to approve a tool call'
      : 'The agent is waiting for your answer',
  ];
  if (ask.expiresAt !== null && ask.expiresAt > now) {
    const left = formatRemaining(ask.expiresAt - now);
    parts.push(ask.kind === 'permission' ? `auto-denies in ${left}` : `closes in ${left}`);
  }
  return parts.join(' · ');
}

/** Parse an ISO timestamp to epoch ms; null for missing/invalid input. */
export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}
