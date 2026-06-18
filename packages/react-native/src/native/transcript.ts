// SPDX-License-Identifier: Apache-2.0
/**
 * Transcript reducer + wire types for the RN widget.
 *
 * Deliberate, dependency-free mirror of `@pinagent/shared`'s `AgentEvent`
 * union (event-bus.ts), `ServerMessage` (ws-protocol.ts), and the canonical
 * `renderTranscript` (render-transcript.ts). We DON'T import the package: the
 * native client ships as **source** and is bundled onto the device by the
 * consumer's Metro, but `@pinagent/shared` is `private` (unpublished) and
 * built for Node — importing it into device code would break a real
 * `npm install @pinagent/react-native`, the same way bundling any unpublished
 * `@pinagent/*` dep does. The package's `./server` entry CAN depend on shared
 * (tsdown bundles it into dist); device source cannot.
 *
 * Keep in sync with those three files. The shapes are stable and the reducer
 * mirrors the shared one, extended with the streaming-only kinds (ask/status)
 * the interactive RN sheet renders.
 */

/** Flat AgentEvent union — mirror of `@pinagent/shared`'s `event-bus.ts`. */
export type AgentEvent =
  | { type: 'init'; sessionId: string; model: string; permissionMode: string; apiKeySource: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; summary: string }
  | { type: 'tool_result'; ok: boolean }
  | { type: 'progress'; turn: number }
  | { type: 'ask_user'; askId: string; question: string; context?: string; options?: string[] }
  | { type: 'error'; message: string }
  | { type: 'result'; subtype: string; numTurns: number; totalCostUsd: number; durationMs: number }
  | {
      type: 'status_changed';
      status: 'pending' | 'fixed' | 'wontfix' | 'deferred';
      note: string | null;
      commitSha: string | null;
      resolvedAt: string | null;
    };

/**
 * Server → client frames the RN client acts on (subset of the web protocol).
 *
 * Only the frames the widget handles are modeled. Other frames (project /
 * extension fan-out, pong) still arrive on the wire — `StreamClient.onMessage`
 * casts the parsed JSON to this type and its `switch` ignores any `type` it
 * doesn't handle. We deliberately avoid an open
 * `{ type: string; [k: string]: unknown }` member: it overlaps every
 * discriminant, collapsing `event`/`message` to `{}` at the use sites and
 * defeating narrowing.
 */
export type ServerMessage =
  | { type: 'event'; feedbackId: string; event: AgentEvent }
  | { type: 'done'; feedbackId: string }
  | { type: 'error'; feedbackId?: string; message: string }
  | { type: 'worktree_state'; feedbackId: string; state: string; commitSha?: string };

export type TranscriptKind = 'text' | 'tool' | 'error' | 'result' | 'ask' | 'status';

export interface TranscriptRow {
  /** Stable key for React lists; derived from event index. */
  id: string;
  kind: TranscriptKind;
  /** Primary text. For tools, the tool name. */
  text: string;
  /** Tool argument summary / ask options, when present. */
  detail?: string;
  /** tool_result success flag → ✓/✗ marker. */
  ok?: boolean;
}

/**
 * Fold AgentEvents into render-ready rows. Pure and deterministic — mirrors
 * the shared `renderTranscript`, plus `ask_user` / `status_changed` rows the
 * interactive RN sheet shows. `init`, `progress`, `tool_result` produce no row
 * of their own (`tool_result` annotates the preceding tool row with ✓/✗).
 */
export function renderTranscript(events: AgentEvent[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  events.forEach((event, i) => {
    switch (event.type) {
      case 'text': {
        const text = event.text.trim();
        if (text) rows.push({ id: `e${i}`, kind: 'text', text });
        break;
      }
      case 'tool_use':
        rows.push({
          id: `e${i}`,
          kind: 'tool',
          text: event.name,
          ...(event.summary ? { detail: event.summary } : {}),
        });
        break;
      case 'tool_result':
        for (let j = rows.length - 1; j >= 0; j--) {
          const row = rows[j];
          if (row?.kind === 'tool') {
            row.ok = event.ok;
            break;
          }
        }
        break;
      case 'ask_user':
        rows.push({
          id: `e${i}`,
          kind: 'ask',
          text: event.question,
          ...(event.options?.length ? { detail: event.options.join(' · ') } : {}),
        });
        break;
      case 'error':
        rows.push({ id: `e${i}`, kind: 'error', text: event.message });
        break;
      case 'status_changed':
        rows.push({
          id: `e${i}`,
          kind: 'status',
          text: event.note
            ? `Resolved (${event.status}): ${event.note}`
            : `Resolved (${event.status})`,
        });
        break;
      case 'result': {
        const ok = event.subtype === 'success';
        const cost = event.totalCostUsd > 0 ? ` · $${event.totalCostUsd.toFixed(4)}` : '';
        const turns = `${event.numTurns} turn${event.numTurns === 1 ? '' : 's'}`;
        rows.push({
          id: `e${i}`,
          kind: 'result',
          text: ok ? `Done · ${turns}${cost}` : `Ended: ${event.subtype} · ${turns}${cost}`,
          ok,
        });
        break;
      }
      // init, progress: no transcript row.
    }
  });
  return rows;
}

/** The latest unanswered ask_user, if the run is currently blocked on one. */
export function pendingAsk(
  events: AgentEvent[],
): { askId: string; question: string; options: string[] } | null {
  let ask: { askId: string; question: string; options: string[] } | null = null;
  for (const event of events) {
    if (event.type === 'ask_user') {
      ask = { askId: event.askId, question: event.question, options: event.options ?? [] };
    }
    // A terminal result/error clears any pending question.
    if (event.type === 'result' || event.type === 'error') ask = null;
  }
  return ask;
}
