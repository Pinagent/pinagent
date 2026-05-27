// SPDX-License-Identifier: Apache-2.0
import { relative, sep } from 'node:path';
import {
  isInGitignore,
  resolveAgentMode,
  type SpawnAgentMode,
  Storage,
  startWsServer,
} from '@pinagent/agent-runner';
import { transformJsx } from '@pinagent/babel-plugin';
import type { Plugin } from 'vite';
import { createMiddleware } from './middleware';

export interface PinagentOptions {
  /**
   * Override the project root. Defaults to Vite's `server.config.root`.
   */
  root?: string;
  /**
   * When a comment is submitted, spawn a Claude Agent SDK run to address it.
   *
   * - `'inline'` (default): each submit runs an SDK query against the project
   *   root, streaming events back to the widget over WebSocket. Cheaper than
   *   worktree mode; parallel agents may race on the same files.
   * - `'worktree'`: each submit creates a fresh git worktree at
   *   `.pinagent/worktrees/<id>` on a `pinagent/<id>` branch, then runs the
   *   SDK there. True parallel agents with no edit races; review each
   *   branch like a PR. Requires a git repo.
   * - `'off'` (or `false`): no spawn. Comments still land in `.pinagent/`,
   *   but no agent is started — use this with channel-mode or pull-mode
   *   workflows where another agent (e.g. `@pinagent/cli mcp`) drives.
   *
   * Communicated to the middleware via the `PINAGENT_SPAWN_AGENT` env var so
   * `agent-runner`'s `resolveAgentMode` can stay framework-agnostic.
   * Override the default `acceptEdits` permission with
   * `PINAGENT_AGENT_PERMISSION_MODE`.
   */
  spawnAgent?: 'worktree' | 'inline' | 'off' | false;
}

const SCRIPT_TAG = '<script type="module" src="/__pinagent/widget.js"></script>';
const DEFAULT_WS_PORT = 53636;

export default function pinagent(options: PinagentOptions = {}): Plugin {
  let isServe = false;
  let resolvedRoot = process.cwd();

  // Resolve the spawn mode at plugin construction so `configureServer` can
  // boot the WS server before any widget bytes go out the door. Matches the
  // `withPinagent(...)` shape in `@pinagent/next-plugin/config`.
  const effective: 'worktree' | 'inline' | 'off' =
    options.spawnAgent === undefined
      ? 'inline'
      : options.spawnAgent === false
        ? 'off'
        : options.spawnAgent;
  process.env.PINAGENT_SPAWN_AGENT = effective;
  if (effective !== 'off' && !process.env.PINAGENT_WS_PORT) {
    process.env.PINAGENT_WS_PORT = String(DEFAULT_WS_PORT);
  }

  return {
    name: 'pinagent',
    apply: 'serve',
    enforce: 'pre',

    config() {
      isServe = true;
    },

    configResolved(cfg) {
      resolvedRoot = options.root ?? cfg.root;
    },

    async configureServer(server) {
      const root = options.root ?? server.config.root;
      resolvedRoot = root;

      // Storage's drizzle migrate() runs on first DB connect; make sure
      // PINAGENT_PROJECT_ROOT points at the same root Vite is serving so
      // a turborepo target works.
      if (!process.env.PINAGENT_PROJECT_ROOT) {
        process.env.PINAGENT_PROJECT_ROOT = root;
      }

      const storage = new Storage(root);

      const inGi = await isInGitignore(root);
      if (!inGi) {
        server.config.logger.warn(
          '[pinagent] .pinagent/ is not in .gitignore — feedback files and screenshots may be committed.',
        );
      }

      const spawnMode: SpawnAgentMode = resolveAgentMode(process.env);
      let wsPort: number | null = null;

      // Start the WebSocket server in this process — same process as
      // `spawnAgent` and the event bus. Singleton-guarded inside
      // `startWsServer` so re-invocations on Vite restart don't fight
      // for the port.
      if (spawnMode !== false) {
        try {
          const handle = startWsServer();
          wsPort = handle.port;
          server.config.logger.info(
            `[pinagent] WebSocket server on ws://127.0.0.1:${wsPort}/__pinagent/ws`,
          );
        } catch (err) {
          server.config.logger.error(
            `[pinagent] failed to start WebSocket server: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      server.middlewares.use(createMiddleware({ storage, spawnMode, wsPort }));

      server.config.logger.info(
        `[pinagent] ready — widget at /__pinagent/widget.js (spawnAgent: ${effective})`,
      );
    },

    transform(code, id) {
      if (!isServe) return null;
      // Strip query strings (Vite adds e.g. ?v=hash, ?t=ts).
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.(t|j)sx$/.test(cleanId)) return null;
      // Skip node_modules.
      if (cleanId.includes(`${sep}node_modules${sep}`) || cleanId.includes('/node_modules/')) {
        return null;
      }

      const rel = toPosix(relative(resolvedRoot, cleanId)) || cleanId;
      const ts = /\.tsx$/.test(cleanId);
      const transformed = transformJsx(code, { relPath: rel, ts });
      if (!transformed) return null;
      // `map: null` lets Vite generate a fresh map from the diff. Safe here
      // because we only insert attributes inline; original line numbers
      // are preserved.
      return { code: transformed, map: null };
    },

    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!isServe) return html;
        if (html.includes('/__pinagent/widget.js')) return html;
        if (html.includes('</body>')) {
          return html.replace('</body>', `${SCRIPT_TAG}\n</body>`);
        }
        return `${html}\n${SCRIPT_TAG}`;
      },
    },
  };
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}
