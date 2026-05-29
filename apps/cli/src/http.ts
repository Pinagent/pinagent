// SPDX-License-Identifier: Apache-2.0
/**
 * Shared HTTP helpers for the CLI subcommands that talk to a running
 * pinagent dev-server (`list`, `resolve`). Kept tiny and dependency-free
 * so each subcommand module stays a thin, unit-testable transform around
 * one fetch call. `transcript.ts` predates this and keeps its own
 * `TranscriptHttpError` for backwards-compatible exit-code mapping; new
 * commands share the helpers here.
 */

/** Default dev-server URL — Next's port. Vite users pass `--server`. */
export const DEFAULT_SERVER_URL = 'http://localhost:3000';

/** Conversation id shape, mirrored from `@pinagent/mcp`'s `ID_RE`. */
export const ID_RE = /^[A-Za-z0-9_-]{8,16}$/;

export class HttpError extends Error {
  constructor(
    message: string,
    /** HTTP status the server returned; -1 for transport errors. */
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Resolve the dev-server base URL with the precedence the whole CLI
 * uses: explicit `--server` > `PINAGENT_SERVER_URL` env > default.
 */
export function resolveServerUrl(
  explicit: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return explicit ?? env.PINAGENT_SERVER_URL ?? DEFAULT_SERVER_URL;
}

/** Strip trailing slashes so `${base}${path}` never doubles up. */
export function baseUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

/**
 * Best-effort extraction of the server's `{ error }` body so a 400/404
 * surfaces the underlying reason instead of a bare status line.
 */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    // Non-JSON or empty body — fall through to the status line.
  }
  return `${response.status} ${response.statusText}`;
}

/**
 * Issue a JSON request and return the parsed body, throwing a typed
 * `HttpError` for transport failures and non-2xx responses. Callers map
 * `err.status` to an exit code.
 */
export async function requestJson(
  url: string,
  init?: RequestInit & { body?: string },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
    });
  } catch (err) {
    throw new HttpError(
      `network error reaching ${url}: ${err instanceof Error ? err.message : String(err)}`,
      -1,
    );
  }
  if (!response.ok) {
    throw new HttpError(`${await errorDetail(response)} (${url})`, response.status);
  }
  return response.json();
}
