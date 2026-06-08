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
import { transformSvelte } from '@pinagent/svelte-plugin';
import { transformVue } from '@pinagent/vue-plugin';
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
   * Explicit API key for the agent that addresses feedback. Optional and
   * opt-in by design.
   *
   * Pinagent never reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` from the
   * environment on its own — a key exported in your shell for other tools must
   * not get billed (or, if stale, fail the run with "Invalid API key") just
   * because pinagent happened to inherit it. When you leave this unset, runs
   * authenticate against your agentic subscription (Claude Code, or Codex's
   * ChatGPT login when using the CLI provider).
   *
   * Set it only when you deliberately want a raw key used, e.g.
   * `pinagent({ apiKey: process.env.MY_PINAGENT_KEY })`. For the default Claude
   * provider it's passed as the Anthropic key; for the bring-your-own CLI
   * provider it's supplied to the wrapped CLI as both `ANTHROPIC_API_KEY` and
   * `OPENAI_API_KEY`. Bridged to the runner via the `PINAGENT_AGENT_API_KEY`
   * env var. A key saved at runtime via the dock's Connections route takes
   * precedence over this option.
   */
  apiKey?: string;
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
  /**
   * Command used to launch an on-demand dev server for a worktree when
   * the dock's "Open app" action is clicked (worktree mode only).
   *
   * By default the command is inferred from the worktree's `package.json`
   * (detects the package manager from the lockfile and the framework from
   * dependencies, then runs the `dev`/`start` script with the right port
   * flag). Set this to override that inference for non-standard setups.
   *
   * A `{port}` placeholder is substituted with the port pinagent picked
   * for the worktree's server; if omitted, ` --port <port>` is appended.
   * Example: `'pnpm dev --port {port}'`.
   *
   * Communicated to the middleware via the `PINAGENT_WORKTREE_SERVE_COMMAND`
   * env var so `agent-runner` stays framework-agnostic.
   */
  worktreeServeCommand?: string;
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
 * `embedded.html` is the production embedded entry. We forward an
 * allowlist of dock query params (`fixtures`, `state`) from the parent
 * URL into the iframe `src` — without this the iframe sees only its
 * own location (the static path below) and flags like `?fixtures=on`
 * silently no-op for every embedded consumer. Inline script so the
 * iframe is built with the right src on first paint.
 *
 * The matching `standalone.html` entry is for the future hosted
 * dashboard, not iframed.
 */
/**
 * Inner JS of the dock iframe loader (the IIFE, no `<script>` wrapper).
 * Exported so non-Vite hosts can inject it their own way — e.g.
 * `@pinagent/nuxt-plugin` adds it to the Nuxt app head, since Vite's
 * `transformIndexHtml` doesn't run for SSR'd documents. `DOCK_IFRAME_TAG`
 * below wraps it for this plugin's own HTML injection.
 */
export const DOCK_IFRAME_SCRIPT =
  '(function(){' +
  'var p=new URLSearchParams(window.location.search);' +
  // When loaded inside the dock worktree-preview iframe, suppress this
  // nested dock so the preview does not stack a second dock on top of
  // the worktree app. (Comment kept apostrophe-free: the script-body
  // extractor in dock-iframe-forwarding.test.ts scans single quotes.)
  'if(p.get("pinagent_dock")==="off")return;' +
  'var allow=["fixtures","state"];' +
  'var kept=new URLSearchParams();' +
  'allow.forEach(function(k){var v=p.get(k);if(v!==null)kept.set(k,v);});' +
  'var qs=kept.toString();' +
  'var src="/__pinagent/dock/embedded.html"+(qs?"?"+qs:"");' +
  'var f=document.createElement("iframe");' +
  'f.id="__pinagent-dock";f.src=src;f.title="Pinagent dock";' +
  'f.style.cssText="position:fixed;inset:0;width:100vw;height:100vh;border:0;' +
  'background:transparent;pointer-events:none;z-index:2147483646;color-scheme:light";' +
  'document.body.appendChild(f);' +
  '})();';
const DOCK_IFRAME_TAG = `<script>${DOCK_IFRAME_SCRIPT}</script>`;

/**
 * Tiny host-side bridge:
 *
 *  - `Cmd/Ctrl + Shift + P` toggles the dock from anywhere on the
 *    page — the iframe's own keydown listener only sees events while
 *    focus is inside the dock. The dock listens for
 *    `{ source: 'pinagent-host', type: 'toggle-dock' }` and routes it
 *    to the same toggle the FAB click uses.
 *
 *  - `Escape` closes the dock from anywhere on the page (same reason:
 *    the iframe can't see the key unless it's focused). Posts
 *    `{ source: 'pinagent-host', type: 'close-dock' }`; the dock
 *    honours it under the same panel-mode rule as its own Escape
 *    handler. We don't `preventDefault` so the host page's own Escape
 *    handling (closing its modals, etc.) still runs.
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
/**
 * Inner JS of the dock host-bridge (the IIFE, no `<script>` wrapper).
 * Exported for the same reason as {@link DOCK_IFRAME_SCRIPT}.
 * `DOCK_HOST_BRIDGE_TAG` below wraps it for this plugin's HTML injection.
 */
export const DOCK_HOST_BRIDGE_SCRIPT =
  '(function(){' +
  // No dock here when suppressed (worktree-preview iframe), so skip the
  // bridge too — it would otherwise wait on an iframe that never mounts.
  'if(new URLSearchParams(window.location.search).get("pinagent_dock")==="off")return;' +
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
  '}else if(e.key==="Escape"){var ec=getF();' +
  'if(ec&&ec.contentWindow){ec.contentWindow.postMessage({source:"pinagent-host",type:"close-dock"},"*");}' +
  '}});' +
  '})();';
const DOCK_HOST_BRIDGE_TAG = `<script>${DOCK_HOST_BRIDGE_SCRIPT}</script>`;
const DEFAULT_WS_PORT = 53636;

/**
 * Lower-level export of the dev-server middleware factory the plugin
 * itself uses. Exposed for tests + alternative hosts that want to mount
 * `/__pinagent/*` on their own Connect-style server without going
 * through `vite.configureServer`.
 */
export { createMiddleware } from './middleware';

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
  // Bridge an explicitly-configured agent API key to the runner. Pinagent only
  // ever uses a key handed to it on purpose — see `apiKey` above and
  // agent-auth.ts. No-op (subscription fallback) when the consumer omits it.
  if (options.apiKey) {
    process.env.PINAGENT_AGENT_API_KEY = options.apiKey;
  }
  // Propagate the worktree-serve override (if any) to the middleware,
  // which reads it via `serveBranch` → `serveWorktree`. Mirrors the
  // env-var hand-off used for spawn mode + WS port above.
  if (options.worktreeServeCommand) {
    process.env.PINAGENT_WORKTREE_SERVE_COMMAND = options.worktreeServeCommand;
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
      // Strip query strings (Vite adds e.g. ?v=hash, ?t=ts, and — for SFCs —
      // ?vue&type=template on the compiled sub-modules).
      const cleanId = id.split('?')[0] ?? id;
      const isVue = cleanId.endsWith('.vue');
      const isSvelte = cleanId.endsWith('.svelte');
      const isJsx = /\.(t|j)sx$/.test(cleanId);
      if (!isVue && !isSvelte && !isJsx) return null;
      // Skip node_modules.
      if (cleanId.includes(`${sep}node_modules${sep}`) || cleanId.includes('/node_modules/')) {
        return null;
      }

      const rel = toPosix(relative(resolvedRoot, cleanId)) || cleanId;
      // Dispatch on extension. Vue SFCs and Svelte components aren't JSX, so
      // they go through their own transforms. `enforce: 'pre'` (above) means we
      // rewrite the raw source before @vitejs/plugin-vue or
      // @sveltejs/vite-plugin-svelte compiles it, so the attributes flow through
      // to the compiled output; on the compiled `?vue`/`?svelte` sub-modules the
      // transform is a no-op (it bails when there's no parseable component).
      const transformed = isVue
        ? transformVue(code, { relPath: rel })
        : isSvelte
          ? transformSvelte(code, { relPath: rel })
          : transformJsx(code, { relPath: rel, ts: /\.tsx$/.test(cleanId) });
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
