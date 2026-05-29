// SPDX-License-Identifier: Apache-2.0
import { WidgetWsClient } from './ws-client';

const DEFAULT_PORT = 53636;

/**
 * Resolve the WS server URL the widget should connect to.
 *
 *   1. `__pinagentConfig` present (injected into the widget bundle by the
 *      dev-server) — trust it absolutely, including an explicit
 *      `wsUrl: null` meaning "this server has no agent WS". We must NOT
 *      guess a port then: the server already told us the answer, and
 *      guessing the default port can connect the widget to a *different*
 *      (stale) dev-server squatting it while this project's server bound a
 *      fallback port. A null return leaves the client inert.
 *   2. No config injected at all (a host page that mounts the widget
 *      without the plugin prelude) — last-resort guess at the default
 *      port on this host.
 *
 * Mirrors the dock's `resolveWsUrl` in `@pinagent/widget-dock`.
 */
export function resolveWsUrl(): string | null {
  const cfg = (window as unknown as { __pinagentConfig?: { wsUrl?: string | null } })
    .__pinagentConfig;
  if (cfg) return cfg.wsUrl ?? null;
  return `ws://${window.location.hostname || '127.0.0.1'}:${DEFAULT_PORT}/__pinagent/ws`;
}

export function createWsClient(): WidgetWsClient {
  return new WidgetWsClient(resolveWsUrl());
}

export function resolveHotkey(): string | null {
  const w = window as unknown as { __pinagentHotkey?: string | false | null };
  if (w.__pinagentHotkey === false || w.__pinagentHotkey === null) return null;
  const k = w.__pinagentHotkey;
  if (typeof k === 'string' && k.length === 1) return k.toLowerCase();
  return 'c';
}

/**
 * Whether the host page also mounts the dock iframe. Set by the plugin's
 * widget-bundle prelude (see vite-plugin/middleware.ts +
 * next-plugin/route.ts). When true the FAB shows a small shortcut chip
 * teaching ⌘/Ctrl+Shift+P — the only way to open the dock now that it no
 * longer ships its own FAB.
 */
export function resolveDockEnabled(): boolean {
  const cfg = (window as unknown as { __pinagentConfig?: { dock?: boolean } }).__pinagentConfig;
  return cfg?.dock === true;
}
