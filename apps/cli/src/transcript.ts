// SPDX-License-Identifier: Apache-2.0
/**
 * `pinagent transcript` — print the persisted agent transcript for one
 * conversation, fetched from a running pinagent dev-server's HTTP
 * endpoint (`GET /__pinagent/feedback/:id/messages`, added by the
 * dock's message-count / transcript-API PR).
 *
 * Rendering is intentionally plain-text and side-effect free:
 * `renderTranscript(events)` is the pure transform, `printTranscript`
 * is the thin wrapper that runs the fetch + writes to a stream. The
 * split lets the unit test pin event-shape coverage without standing
 * up an HTTP server.
 */
import type { AgentEvent } from '@pinagent/shared';
import { AgentEventSchema } from '@pinagent/shared';
import { z } from 'zod';

export interface FetchOpts {
  /** Base URL of the dev-server, e.g. `http://localhost:3000`. */
  serverUrl: string;
  /** Conversation id (`cv_...` or whatever the host project uses). */
  id: string;
}

export class TranscriptHttpError extends Error {
  constructor(
    message: string,
    /** HTTP status the server returned; -1 for transport errors. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'TranscriptHttpError';
  }
}

const ResponseSchema = z.object({ messages: z.array(AgentEventSchema) });

export async function fetchTranscript(opts: FetchOpts): Promise<AgentEvent[]> {
  const url = `${opts.serverUrl.replace(/\/+$/, '')}/__pinagent/feedback/${encodeURIComponent(opts.id)}/messages`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new TranscriptHttpError(
      `network error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`,
      -1,
    );
  }
  if (!response.ok) {
    throw new TranscriptHttpError(
      `${response.status} ${response.statusText} from ${url}`,
      response.status,
    );
  }
  const body = await response.json();
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new TranscriptHttpError(
      `response from ${url} did not match the expected shape: ${parsed.error.message}`,
      response.status,
    );
  }
  return parsed.data.messages;
}

/**
 * Render a transcript as plain text. One block per event, ordered by
 * the array. Output is terminal-friendly but does no ANSI color —
 * pipe through `less -R` or `bat` if you want highlights.
 */
export function renderTranscript(events: AgentEvent[]): string {
  if (events.length === 0) return '(no events recorded)\n';
  return events.map(renderEvent).join('\n\n') + '\n';
}

export const DEFAULT_SERVER_URL = 'http://localhost:3000';

export interface TranscriptArgs {
  id: string;
  serverUrl: string;
  json: boolean;
}

/**
 * Parse argv for `pinagent transcript`. Pure function so the
 * subcommand's argv handling can be unit-tested without invoking the
 * CLI entry point (which would run `main()` at module load).
 *
 * Precedence for `serverUrl`: explicit `--server`/`-s` > env > default.
 */
export function parseTranscriptArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): TranscriptArgs | { error: string } {
  let id: string | null = null;
  let serverUrl: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--server' || arg === '-s') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return { error: `${arg} requires a value` };
      serverUrl = next;
      i++;
    } else if (arg && !arg.startsWith('-') && id === null) {
      id = arg;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  if (!id) return { error: 'missing required <id> argument' };
  return {
    id,
    serverUrl: serverUrl ?? env.PINAGENT_SERVER_URL ?? DEFAULT_SERVER_URL,
    json,
  };
}

function renderEvent(event: AgentEvent): string {
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
    case 'ask_user': {
      const opts = event.options?.length ? ` · options: ${event.options.join(' | ')}` : '';
      const ctx = event.context ? `\n  ${event.context}` : '';
      return `[ask_user] ${event.question}${opts}${ctx}`;
    }
    case 'error':
      return `[error] ${event.message}`;
    case 'result': {
      const cost = `$${event.totalCostUsd.toFixed(4)}`;
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
