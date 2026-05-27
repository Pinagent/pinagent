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
  /**
   * Mount the project-management dock surface alongside the per-element
   * widget. Default: false — the widget ships universally, the dock is
   * opt-in because not every project wants a second floating surface on
   * every page.
   *
   * When true, the plugin:
   *   - serves @pinagent/widget-dock's static assets from
   *     `/__pinagent/dock/*`
   *   - injects a fixed, full-viewport, pointer-events:none iframe
   *     pointing at `/__pinagent/dock/embedded.html`
   *
   * The iframe captures clicks only on its own FAB and panel; the host
   * page underneath stays interactive everywhere else.
   */
  dock?: boolean;
}

const SCRIPT_TAG = '<script type="module" src="/__pinagent/widget.js"></script>';
/**
 * Iframe loader for the dock surface. Full-viewport so the dock FAB and
 * panel can position themselves anywhere; pointer-events:none on the
 * iframe so unrelated host-page clicks pass through. The dock's body
 * restores pointer-events on its descendants (see widget-dock's
 * globals.css). z-index sits just under the widget FAB's 2147483647
 * so neither surface visually steals from the other.
 *
 * `embedded.html` is the production embedded entry — assumes embedded
 * mode without a query flag. The matching `standalone.html` entry is
 * for the future hosted dashboard, not iframed.
 */
const DOCK_IFRAME_TAG =
  '<iframe id="__pinagent-dock" src="/__pinagent/dock/embedded.html" ' +
  'title="Pinagent dock" ' +
  'style="position:fixed;inset:0;width:100vw;height:100vh;border:0;background:transparent;pointer-events:none;z-index:2147483646;color-scheme:light"></iframe>';

/**
 * Tiny host-side bridge:
 *
 *  - `Cmd/Ctrl + Shift + P` toggles the dock from anywhere on the
 *    page — the iframe's own keydown listener only sees events while
 *    focus is inside the dock. The dock listens for
 *    `{ source: 'pinagent-host', type: 'toggle-dock' }` and routes it
 *    to the same toggle the FAB click uses.
 *
 *  - Pointer-events passthrough. The dock iframe is full-viewport, so
 *    leaving it permanently `pointer-events: auto` would block host
 *    clicks, and permanently `none` would make the FAB unreachable.
 *    The dock broadcasts its interactive rects via
 *    `{ source: 'pinagent-dock', type: 'layout', rects }`; we toggle
 *    the iframe's `pointer-events` on every host mousemove based on
 *    whether the cursor sits over any of those rects.
 *
 * Inline rather than a separate file so there's no extra request and
 * no race with the iframe load.
 */
const DOCK_HOST_BRIDGE_TAG =
  '<script>(function(){' +
  'var f=null,rects=[];' +
  'function getF(){if(!f)f=document.getElementById("__pinagent-dock");return f;}' +
  'function over(x,y){for(var i=0;i<rects.length;i++){var r=rects[i];' +
  'if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)return true;}return false;}' +
  'function toggle(x,y){var el=getF();if(el)el.style.pointerEvents=over(x,y)?"auto":"none";}' +
  'window.addEventListener("message",function(e){' +
  'var d=e.data;if(!d||d.source!=="pinagent-dock")return;' +
  'if(d.type==="layout"){rects=Array.isArray(d.rects)?d.rects:[];}' +
  'else if(d.type==="pointer-move"){toggle(d.x,d.y);}' +
  '});' +
  'document.addEventListener("mousemove",function(e){toggle(e.clientX,e.clientY);},true);' +
  'document.addEventListener("keydown",function(e){' +
  'if((e.metaKey||e.ctrlKey)&&e.shiftKey&&(e.key==="p"||e.key==="P")){' +
  'e.preventDefault();var el=getF();' +
  'if(el&&el.contentWindow){el.contentWindow.postMessage({source:"pinagent-host",type:"toggle-dock"},"*");}' +
  '}});' +
  '})();</script>';
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
          const handle = await startWsServer();
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

      const dockEnabled = options.dock === true;
      server.middlewares.use(createMiddleware({ storage, spawnMode, wsPort, dock: dockEnabled }));

      const dockHint = dockEnabled ? ', dock: on' : '';
      server.config.logger.info(
        `[pinagent] ready — widget at /__pinagent/widget.js (spawnAgent: ${effective}${dockHint})`,
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
        const widgetAlready = html.includes('/__pinagent/widget.js');
        const dockEnabled = options.dock === true;
        const dockAlready = html.includes('/__pinagent/dock/');
        const tags = [
          widgetAlready ? '' : SCRIPT_TAG,
          dockEnabled && !dockAlready ? DOCK_IFRAME_TAG : '',
          dockEnabled && !dockAlready ? DOCK_HOST_BRIDGE_TAG : '',
        ]
          .filter(Boolean)
          .join('\n');
        if (!tags) return html;
        if (html.includes('</body>')) {
          return html.replace('</body>', `${tags}\n</body>`);
        }
        return `${html}\n${tags}`;
      },
    },
  };
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}
