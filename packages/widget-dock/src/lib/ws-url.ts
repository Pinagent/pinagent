// SPDX-License-Identifier: Apache-2.0
/**
 * Resolve the pinagent WS server URL. Mirrors the widget's logic in
 * `@pinagent/widget/src/widget.ts::createWsClient` so the dock connects
 * to the same server the widget does.
 *
 * Resolution order:
 *   1. `window.__pinagentConfig` present (the dev-server injected it into
 *      the dock's embedded.html, or the host page set it) — trust it
 *      absolutely, including an explicit `wsUrl: null` meaning "this
 *      server has no agent WS". We must NOT guess a port in that case:
 *      the whole point is that the server already told us the answer, and
 *      guessing the default port can connect the dock to a *different*
 *      (stale) dev-server squatting 53636 while this project's server
 *      bound a fallback port.
 *   2. No config injected at all (older dev-server that predates dock
 *      config injection, or a standalone build) — last-resort guess at
 *      `ws://<location.hostname>:53636/__pinagent/ws`.
 *
 * Returns null on the server (no window). Callers should treat null
 * as "skip subscribing".
 */
const DEFAULT_PORT = 53636;
const WS_PATH = '/__pinagent/ws';

interface PinagentGlobals {
  __pinagentConfig?: { wsUrl?: string | null };
}

export function resolveWsUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const cfg = (window as PinagentGlobals).__pinagentConfig;
  // Server-injected config is authoritative — `wsUrl: null` means "no WS
  // here", so return null rather than guessing a stranger's port.
  if (cfg) return cfg.wsUrl ?? null;
  const host = window.location.hostname || '127.0.0.1';
  return `ws://${host}:${DEFAULT_PORT}${WS_PATH}`;
}
