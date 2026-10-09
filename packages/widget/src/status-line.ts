// SPDX-License-Identifier: Apache-2.0
import { type AwaitingKind, cardAwaitingLabel } from './awaiting';

/**
 * The card's one-line status, mirrored onto both surfaces that show it: the
 * expanded stream header and the minimized bar's `#pa-mini-label`.
 *
 * An open ask is an *overlay* on top of the run status, not a replacement:
 * while it is open both surfaces read "Approve? · auto-deny in 4:05" (ticking
 * once a second), and when it settles — answered, expired, or wiped by a
 * reconnect — they go back to whatever the run status is by then. Without the
 * overlay the label either never said "Needs your input" (an ask that arrived
 * while expanded, then minimized) or kept saying it for the rest of the turn
 * after the developer had answered.
 */
export interface StatusLine {
  /** Set the run status ("Working · model", "Done", …). */
  set(text: string): void;
  /** Show an open ask over the run status until `clearAwaiting`. */
  setAwaiting(ask: { kind: AwaitingKind; expiresAt: number | null }): void;
  /** Drop the ask overlay and restore the run status. Idempotent. */
  clearAwaiting(): void;
}

export function createStatusLine(
  header: HTMLElement,
  miniLabel: HTMLElement | null,
  opts: { now?: () => number; tickMs?: number } = {},
): StatusLine {
  const now = opts.now ?? Date.now;
  const tickMs = opts.tickMs ?? 1000;
  // Null until the first `set`: the submit path pre-fills the two surfaces
  // with different copy ("✓ Submitted — agent starting…" / "Starting…"), so
  // an ask that opens before any run status restores those exact texts.
  let base: string | null = null;
  let snapshot: { header: string; mini: string } | null = null;
  let ask: { kind: AwaitingKind; expiresAt: number | null } | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  function write(text: string) {
    header.textContent = text;
    if (miniLabel) miniLabel.textContent = text;
  }

  function render() {
    if (ask) {
      write(cardAwaitingLabel(ask, now()));
      return;
    }
    if (base !== null) write(base);
    else if (snapshot) {
      header.textContent = snapshot.header;
      if (miniLabel) miniLabel.textContent = snapshot.mini;
    }
  }

  function stopTicker() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    set(text) {
      base = text;
      render();
    },
    setAwaiting(next) {
      if (!ask && base === null) {
        snapshot = { header: header.textContent ?? '', mini: miniLabel?.textContent ?? '' };
      }
      ask = next;
      render();
      stopTicker();
      // Only a known, future expiry has a countdown worth ticking.
      if (next.expiresAt !== null && next.expiresAt > now()) {
        timer = setInterval(() => {
          render();
          if (!ask || ask.expiresAt === null || ask.expiresAt <= now()) stopTicker();
        }, tickMs);
      }
    },
    clearAwaiting() {
      stopTicker();
      if (!ask) return;
      ask = null;
      render();
      snapshot = null;
    },
  };
}
