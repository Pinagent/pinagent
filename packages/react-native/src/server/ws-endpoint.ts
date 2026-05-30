// SPDX-License-Identifier: Apache-2.0
/**
 * Metro WebSocket endpoint for Pinagent — live agent streaming on RN.
 *
 * The web plugins run a dedicated WS server on a separate port (53636) and
 * tell the browser widget that port via an injected config. A phone can't
 * discover a second port, so RN takes the other route Metro already offers:
 * `config.server.websocketEndpoints`. Metro owns its HTTP server, handles the
 * `upgrade` event, and dispatches by pathname to the `ws.Server({ noServer })`
 * we register here. Streaming therefore rides the *same* host:port the widget
 * already uses for `POST /__pinagent/feedback` — no second port, no discovery.
 *
 * Wire it in `metro.config.js` alongside the feedback middleware:
 *
 *   const { pinagentMiddleware, pinagentWebsocketEndpoints } =
 *     require('@pinagent/react-native/server');
 *
 *   config.server = {
 *     ...config.server,
 *     enhanceMiddleware: (mw, server) =>
 *       pinagentMiddleware({ projectRoot: __dirname }).chain(mw),
 *     websocketEndpoints: {
 *       ...config.server?.websocketEndpoints,
 *       ...pinagentWebsocketEndpoints({ projectRoot: __dirname }),
 *     },
 *   };
 *
 * The accepted socket is wired to the exact `attachConnection` the web widget
 * talks to, so the wire protocol (subscribe / event / done / user_message /
 * ask_response / interrupt / worktree controls) is identical.
 */
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
