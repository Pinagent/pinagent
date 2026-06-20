// SPDX-License-Identifier: Apache-2.0
/**
 * Pure run-state model for the RN widget's live agent runs.
 *
 * The minimized agent UI used to derive its status ad-hoc inside `StreamSheet`
 * from a tangle of booleans (`running`/`done`/`transportError`/`askOpen`),
 * encoded purely by dot color. This module replaces that with one explicit,
 * unit-testable state machine: a {@link RunState} per run, a presentation map
 * (glyph + tone + label, not color-alone), and the aggregation
 * ({@link dockModel}) the compact bottom-left dock renders.
 *
 * It's deliberately dependency-free (only the sibling `transcript` reducer) so
 * it's testable without React Native — the device UI (`AgentDock`, the expanded
 * `StreamSheet`) stays a thin renderer over these pure functions, the same way
 * `transcript.ts` / `restore.ts` keep their logic out of the un-testable
 * RN-runtime layer.
 */

import { type AgentEvent, pendingAsk } from './transcript';

/**
 * The lifecycle state of one streamed agent run.
 *
 * - `connecting` — socket up, transcript not replayed yet (no events). The
 *   brief window after spawn/restore and again right after a reconnect.
 * - `working`    — events are flowing and the run hasn't ended.
 * - `awaiting`   — blocked on an `ask_user` the developer hasn't answered. The
 *   one state that needs the developer's attention; it pulses.
 * - `done`       — ended cleanly (success result, or the bus simply closed).
 * - `failed`     — ended on an error (server error frame, transport error, or a
 *   non-success result subtype).
 */
export type RunState = 'connecting' | 'working' | 'awaiting' | 'done' | 'failed';

export interface RunStateInput {
  /** The folded agent event stream (same array `StreamSheet` accumulates). */
  events: AgentEvent[];
  /** Set once the run reached a terminal `result`/`done`. */
  done: boolean;
  /** Non-null when a server `error` frame (or "no dev server") arrived. */
  transportError: string | null;
  /** `askId` → answer, so an answered question no longer reads as `awaiting`. */
  answered: Record<string, string>;
}

/** Did the run's last terminal event signal failure rather than success? */
function endedInFailure(events: AgentEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'error') return true;
    if (e.type === 'result') return e.subtype !== 'success';
  }
  return false;
}

/**
 * Collapse the raw run booleans into a single {@link RunState}. Pure and
 * order-sensitive: a transport error wins over everything (you can't answer or
 * keep working over a dead socket), then an unanswered question, then terminal
 * done/failure, else working-vs-connecting by whether any event has arrived.
 */
export function deriveRunState({
  events,
  done,
  transportError,
  answered,
}: RunStateInput): RunState {
  if (transportError) return 'failed';
  const ask = pendingAsk(events);
  if (ask && !answered[ask.askId]) return 'awaiting';
  if (done) return endedInFailure(events) ? 'failed' : 'done';
  return events.length > 0 ? 'working' : 'connecting';
}

/** Semantic color bucket; mapped to concrete colors in the component layer. */
export type RunTone = 'neutral' | 'active' | 'attention' | 'success' | 'danger';

export interface RunPresentation {
  /** Short status word for labels / accessibility. */
  label: string;
  /** Monochrome glyph so state never rides on color alone. */
  glyph: string;
  /** Semantic tone the renderer maps to a palette entry. */
  tone: RunTone;
  /** Whether the chip should pulse to pull the developer back. */
  pulse: boolean;
  /** Non-terminal (connecting/working/awaiting) — i.e. still an active run. */
  active: boolean;
}

const PRESENTATION: Record<RunState, RunPresentation> = {
  connecting: { label: 'Connecting', glyph: '◌', tone: 'neutral', pulse: false, active: true },
  working: { label: 'Working', glyph: '◐', tone: 'active', pulse: false, active: true },
  awaiting: { label: 'Needs you', glyph: '!', tone: 'attention', pulse: true, active: true },
  done: { label: 'Done', glyph: '✓', tone: 'success', pulse: false, active: false },
  failed: { label: 'Failed', glyph: '✕', tone: 'danger', pulse: false, active: false },
};

/**
 * Does an "interrupting" overlay actually apply right now?
 *
 * Stop is purely a client-side affordance over the existing `interrupt` frame
 * (ticket 015): tapping it sets a local flag, and we keep showing "Stopping…"
 * until the server lands a terminal event. The overlay therefore applies only
 * while the run is still {@link RunPresentation.active active} — once it reaches
 * a terminal `done`/`failed` state the interrupt resolved, so the overlay drops
 * even if the caller's flag hasn't been cleared yet. Modeling it as an overlay
 * (rather than a sixth {@link RunState}) keeps the state machine — and the dock
 * aggregation — unchanged and unit-testable.
 */
export function interruptOverlayActive(state: RunState, interrupting: boolean): boolean {
  return interrupting && PRESENTATION[state].active;
}

/**
 * Presentation for a run, optionally overlaid with an interrupting affordance.
 *
 * With `interrupting` true on a still-active run we relabel to "Stopping…" and
 * stop any pulse (the developer asked it to halt — pulsing for attention is the
 * wrong signal), keeping the underlying state's glyph/tone/active so the dock
 * partitioning is undisturbed. Terminal states ignore the flag (see
 * {@link interruptOverlayActive}).
 */
export function runPresentation(state: RunState, interrupting = false): RunPresentation {
  const base = PRESENTATION[state];
  if (!interruptOverlayActive(state, interrupting)) return base;
  return { ...base, label: 'Stopping…', pulse: false };
}

/** A run as the dock sees it: identity, header label, and derived state. */
export interface DockRun {
  id: string;
  /** Header label — `file:line` if anchored, else the component name. */
  target: string;
  state: RunState;
  /**
   * The developer tapped Stop and we're awaiting the run's terminal event
   * (ticket 015). An overlay over `state`, not a state — the chip relabels to
   * "Stopping…" while it's still active. Ignored once terminal.
   */
  interrupting?: boolean;
}

export interface DockModel {
  /** connecting/working/awaiting, sorted attention-first (stable within tone). */
  active: DockRun[];
  /** done/failed, in input order. */
  finished: DockRun[];
  /** Collapse the active runs into a single count bar (true at ≥2 active). */
  collapseActive: boolean;
  /** How many active runs are blocked on input. */
  awaitingCount: number;
  /** State driving the collapsed bar's glyph/tone (most attention-worthy). */
  summaryState: RunState;
  /** Bar text, e.g. `3 agents · 1 needs you`. */
  activeHeadline: string;
  /** True when any finished run failed (lets the summary flag failures). */
  finishedHasFailure: boolean;
}

/** Attention priority for ordering/summarizing active runs (higher = first). */
const ACTIVE_PRIORITY: Record<RunState, number> = {
  awaiting: 3,
  working: 2,
  connecting: 1,
  done: 0,
  failed: 0,
};

/**
 * Aggregate runs into what the dock draws. Active runs surface attention-first
 * (a blocked run jumps above a busy one); ≥2 of them collapse into one count
 * bar. Finished runs always roll into a `▸ N finished` summary. Pure so the
 * hybrid + done-summary behavior is covered without rendering anything.
 */
export function dockModel(runs: readonly DockRun[]): DockModel {
  // Stable attention-first sort for active runs: decorate with the input index
  // so equal-tone runs keep their arrival order.
  const active = runs
    .filter((r) => runPresentation(r.state).active)
    .map((run, i) => ({ run, i }))
    .sort((a, b) => ACTIVE_PRIORITY[b.run.state] - ACTIVE_PRIORITY[a.run.state] || a.i - b.i)
    .map(({ run }) => run);
  const finished = runs.filter((r) => !runPresentation(r.state).active);

  const awaitingCount = active.filter((r) => r.state === 'awaiting').length;
  const summaryState = active[0]?.state ?? 'working';
  const noun = active.length === 1 ? 'agent' : 'agents';
  const activeHeadline =
    awaitingCount > 0
      ? `${active.length} ${noun} · ${awaitingCount} needs you`
      : `${active.length} ${noun}`;

  return {
    active,
    finished,
    collapseActive: active.length >= 2,
    awaitingCount,
    summaryState,
    activeHeadline,
    finishedHasFailure: finished.some((r) => r.state === 'failed'),
  };
}
