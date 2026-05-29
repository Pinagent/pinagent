// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * `resolveWsUrl` decides which WS server the dock connects to. The
 * regression these guard: when the dev-server falls back off the default
 * port (because a stale/other dev-server holds 53636), it injects the
 * actually-bound port into the dock's embedded.html as
 * `window.__pinagentConfig`. The dock must TRUST that injected value —
 * including an explicit `null` — and only guess the default port when no
 * config was injected at all. Guessing while a config is present is what
 * let the dock silently connect to the stranger on 53636.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWsUrl } from '../src/lib/ws-url';

type Cfg = { wsUrl?: string | null } | undefined;
function setConfig(cfg: Cfg): void {
  if (cfg === undefined) {
    (window as { __pinagentConfig?: unknown }).__pinagentConfig = undefined;
  } else {
    (window as { __pinagentConfig?: unknown }).__pinagentConfig = cfg;
  }
}

afterEach(() => setConfig(undefined));

describe('resolveWsUrl', () => {
  it('uses the injected wsUrl verbatim (the fallback-port case)', () => {
    setConfig({ wsUrl: 'ws://127.0.0.1:53637/__pinagent/ws' });
    expect(resolveWsUrl()).toBe('ws://127.0.0.1:53637/__pinagent/ws');
  });

  it('returns null when config is injected with wsUrl: null (no WS here)', () => {
    // The server told us it has no agent WS — must NOT guess 53636 and
    // reach a stranger.
    setConfig({ wsUrl: null });
    expect(resolveWsUrl()).toBeNull();
  });

  it('returns null when config is injected without a wsUrl field', () => {
    setConfig({});
    expect(resolveWsUrl()).toBeNull();
  });

  it('guesses the default port only when no config was injected at all', () => {
    setConfig(undefined);
    expect(resolveWsUrl()).toBe(`ws://${window.location.hostname}:53636/__pinagent/ws`);
  });
});
