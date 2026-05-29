// SPDX-License-Identifier: Apache-2.0
/**
 * Plain-text renderer for an `AgentEvent[]` transcript.
 *
 * Shared so both `pinagent transcript` (CLI subcommand) and the MCP
 * server's `get_conversation_transcript` tool produce identical
 * output — agents and humans see the same string regardless of which
 * surface they read through, and there's exactly one place to evolve
 * the format.
 *
 * Output is terminal-friendly but deliberately ANSI-free. Pipe through
 * `bat` or `less -R` if you want highlights.
 */
import { type AgentEvent, isNotionalCost, isUntrackedCost } from './event-bus';

/**
 * Render a transcript as plain text. One block per event, ordered by
 * the array. Returns "(no events recorded)\n" for an empty input so
 * the caller can write the result unconditionally to stdout.
 */
export function renderTranscript(events: AgentEvent[]): string {
  // `progress` events are a transient live-turn signal (delivered via the
  // bus so they hit the messages table), not transcript content — drop
  // them so the rendered log stays clean.
  const rendered = events.filter((e) => e.type !== 'progress');
  if (rendered.length === 0) return '(no events recorded)\n';
  // The run's credential source lives on the `init` event; capture it so
  // the result line can relabel notional (subscription) cost instead of
  // printing a bare `$` that reads as a real charge.
  const init = rendered.find((e) => e.type === 'init');
  const apiKeySource = init?.type === 'init' ? init.apiKeySource : null;
  return `${rendered.map((event) => renderEvent(event, apiKeySource)).join('\n\n')}\n`;
}

function renderEvent(event: AgentEvent, apiKeySource: string | null): string {
  switch (event.type) {
    case 'init':
      return `[init] ${event.sessionId} · ${event.model} · ${event.permissionMode} (${event.apiKeySource})`;
    case 'text':
      return event.text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'tool_use':
      return `[tool_use] ${event.name}${event.summary ? ` · ${event.summary}` : ''}`;
    case 'tool_result':
      return `[tool_result] ${event.ok ? 'ok' : 'error'}`;
    case 'progress':
      // Filtered out in renderTranscript; handled here for exhaustiveness.
      return '';
    case 'ask_user': {
      const opts = event.options?.length ? ` · options: ${event.options.join(' | ')}` : '';
      const ctx = event.context ? `\n  ${event.context}` : '';
      return `[ask_user] ${event.question}${opts}${ctx}`;
    }
    case 'error':
      return `[error] ${event.message}`;
    case 'result': {
      const cost = isUntrackedCost(apiKeySource)
        ? 'cost not tracked'
        : isNotionalCost(apiKeySource)
          ? `≈$${event.totalCostUsd.toFixed(4)} API-equivalent (subscription)`
          : `$${event.totalCostUsd.toFixed(4)}`;
      const dur = `${(event.durationMs / 1000).toFixed(2)}s`;
      const errs = event.errors?.length ? ` · errors: ${event.errors.join(', ')}` : '';
      return `[result] ${event.subtype} · ${event.numTurns} turn(s) · ${cost} · ${dur}${errs}`;
    }
    case 'status_changed': {
      const note = event.note ? ` · ${event.note}` : '';
      const sha = event.commitSha ? ` (${event.commitSha.slice(0, 8)})` : '';
      return `[status_changed] ${event.status}${sha}${note}`;
    }
  }
}
