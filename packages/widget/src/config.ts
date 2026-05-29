// SPDX-License-Identifier: Apache-2.0
import { WidgetWsClient } from './ws-client';

export function createWsClient(): WidgetWsClient {
  const cfg = (window as unknown as { __pinagentConfig?: { wsUrl?: string | null } })
    .__pinagentConfig;
  const url = cfg?.wsUrl ?? `ws://${window.location.hostname || '127.0.0.1'}:53636/__pinagent/ws`;
  return new WidgetWsClient(url);
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
