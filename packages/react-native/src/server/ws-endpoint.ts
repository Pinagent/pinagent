// SPDX-License-Identifier: Apache-2.0
/**
 * Metro WebSocket endpoint for Pinagent — live agent streaming on RN.
 *
 * The web plugins run a dedicated WS server on a separate port (53636) and
 * tell the browser widget that port via an injected config. A phone can't
 * discover a second port, so RN streams over the *same* host:port the widget
 * already uses for `POST /__pinagent/feedback` — no second port, no discovery.
 *
 * There are two ways the Metro-family dev servers expose a custom WS path, and
 * they are NOT interchangeable:
 *
 *   - **Bare Metro** (`metro/src/index` `runServer`) honors
 *     `config.server.websocketEndpoints` — a `{ [path]: ws.Server }` map it
 *     folds into its own `upgrade` dispatch. `pinagentWebsocketEndpoints`
 *     produces that map.
 *   - **Expo** (`@expo/cli`'s forked `runServer`) does NOT. It builds its own
 *     endpoint map (`/hot`, devtools, debugger) and `socket.destroy()`s any
 *     upgrade path it doesn't recognise, so a user `websocketEndpoints` entry
 *     is silently dropped and `/__pinagent/ws` connections reconnect forever
 *     ("Connecting…" in the stream sheet). Expo *does* honor `enhanceMiddleware`
 *     though — which is why the feedback POST and the agent run still work.
 *
 * To cover both, `pinagentMiddleware` self-installs the `/__pinagent/ws` handler
 * on the live HTTP server (via {@link ensurePinagentUpgrade}) the first time a
 * request flows through it — see `metro-middleware.ts`. That path works under
 * Expo and bare Metro alike, so `websocketEndpoints` wiring is now optional and
 * kept only for explicit bare-Metro setups.
 *
 * Wire it in `metro.config.js` alongside the feedback middleware:
 *
 *   const { pinagentMiddleware } = require('@pinagent/react-native/server');
 *
 *   config.server = {
 *     ...config.server,
 *     enhanceMiddleware: (mw, server) =>
 *       pinagentMiddleware({ projectRoot: __dirname }).chain(mw),
 *   };
 *
 * The accepted socket is wired to the exact `attachConnection` the web widget
 * talks to, so the wire protocol (subscribe / event / done / user_message /
 * ask_response / interrupt / worktree controls) is identical.
 */
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { createPinagentWsEndpoint } from '@pinagent/agent-runner';

export interface PinagentWsEndpointsOpts {
  /**
   * Project root — where `.pinagent/` lives. Pass `__dirname`, the same value
   * given to `pinagentMiddleware`. The agent run records events keyed on this
   * root; the WS server's bus subscription otherwise resolves the root from
   * `PINAGENT_PROJECT_ROOT` (falling back to `process.cwd()`). Metro's cwd is
   * usually the project dir, but we pin the env var so streaming always reads
   * the same `.pinagent/db.sqlite` the feedback middleware writes to.
   */
  projectRoot: string;
}

/**
 * Returns the `{ [path]: ws.Server }` map to spread into Metro's
 * `config.server.websocketEndpoints`. Mounts the Pinagent stream at
 * `/__pinagent/ws`.
 */
export function pinagentWebsocketEndpoints(
  opts: PinagentWsEndpointsOpts,
): Record<string, ReturnType<typeof createPinagentWsEndpoint>> {
  if (!process.env.PINAGENT_PROJECT_ROOT) {
    process.env.PINAGENT_PROJECT_ROOT = opts.projectRoot;
  }
  return { '/__pinagent/ws': createPinagentWsEndpoint() };
}

/** Per-server guard so we only take over the `upgrade` event once. */
const UPGRADE_HOOKED = Symbol.for('pinagent.rn.upgradeHooked');

type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

/**
 * Idempotently mount `/__pinagent/ws` on a live HTTP server, regardless of
 * whether the host honors `config.server.websocketEndpoints`.
 *
 * Expo's dev server registers a single `upgrade` listener that destroys any
 * path it doesn't know, so simply *adding* a second listener races with that
 * destroy. Instead we take the listener over: capture whatever `upgrade`
 * listeners are already attached (Metro's `/hot`, Expo's devtools/debugger
 * sockets, …), remove them, and install one router that handles
 * `/__pinagent/ws` itself and delegates every other path back to the captured
 * listeners untouched. HMR and the rest keep working; our path no longer gets
 * destroyed out from under us.
 *
 * Called lazily from `pinagentMiddleware` with `req.socket.server` — by the
 * time any HTTP request reaches the middleware the dev server is listening and
 * its own `upgrade` listener is already registered, so the capture is complete.
 */
export function ensurePinagentUpgrade(server: Server): void {
  const flagged = server as Server & { [UPGRADE_HOOKED]?: boolean };
  if (flagged[UPGRADE_HOOKED]) return;
  flagged[UPGRADE_HOOKED] = true;

  const wss = createPinagentWsEndpoint();
  const prior = server.listeners('upgrade') as UpgradeListener[];
  server.removeAllListeners('upgrade');

  server.on('upgrade', (req, socket: Duplex, head: Buffer) => {
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '', 'http://localhost').pathname;
    } catch {
      pathname = (req.url ?? '').split('?')[0] ?? '';
    }
    if (pathname === '/__pinagent/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      return;
    }
    for (const fn of prior) fn.call(server, req, socket, head);
  });
}
