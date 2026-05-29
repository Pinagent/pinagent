// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * `resolveWsUrl` decides which WS server the in-page widget connects to.
 * The regression this guards: when the dev-server falls back off the
 * default port (because a stale/other dev-server holds 53636), it injects
 * the actually-bound port into the widget bundle as `window.__pinagentConfig`.
 * The widget must TRUST that — including an explicit `null` ("no WS here")
 * — and only guess the default port when no config was injected at all.
 * Guessing while a config is present can connect the widget to a stranger
 * on 53636.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWsUrl } from '../src/config';

type Cfg = { wsUrl?: string | null } | undefined;
function setConfig(cfg: Cfg): void {
  (window as { __pinagentConfig?: unknown }).__pinagentConfig = cfg;
}

afterEach(() => setConfig(undefined));

describe('resolveWsUrl', () => {
  it('uses the injected wsUrl verbatim (the fallback-port case)', () => {
    setConfig({ wsUrl: 'ws://127.0.0.1:53637/__pinagent/ws' });
    expect(resolveWsUrl()).toBe('ws://127.0.0.1:53637/__pinagent/ws');
  });

  it('returns null when config is injected with wsUrl: null (no WS here)', () => {
    setConfig({ wsUrl: null });
    expect(resolveWsUrl()).toBeNull();
  });

  it('returns null when config is injected without a wsUrl field', () => {
    setConfig({});
    expect(resolveWsUrl()).toBeNull();
  });

  it('guesses the default port only when no config was injected at all', () => {
    setConfig(undefined);
    expect(resolveWsUrl()).toBe(
      `ws://${window.location.hostname || '127.0.0.1'}:53636/__pinagent/ws`,
    );
  });
});
