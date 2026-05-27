// SPDX-License-Identifier: Apache-2.0
/**
 * Resolve the pinagent WS server URL. Mirrors the widget's logic in
 * `@pinagent/widget/src/widget.ts::createWsClient` so the dock connects
 * to the same server the widget does.
 *
 * Resolution order:
 *   1. `window.__pinagentConfig.wsUrl` — explicit override (set either
 *      by the consumer host page or by the widget IIFE prelude served
 *      via /__pinagent/widget.js).
 *   2. `ws://<location.hostname>:53636/__pinagent/ws` — the default WS
 *      server port.
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
  if (cfg?.wsUrl) return cfg.wsUrl;
  const host = window.location.hostname || '127.0.0.1';
  return `ws://${host}:${DEFAULT_PORT}${WS_PATH}`;
}
