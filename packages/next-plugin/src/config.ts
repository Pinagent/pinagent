// SPDX-License-Identifier: Apache-2.0
import { createRequire } from 'node:module';
import type { NextConfig } from 'next';

type WebpackFn = NonNullable<NextConfig['webpack']>;
type RewritesFn = NonNullable<NextConfig['rewrites']>;
type RewritesReturn = Awaited<ReturnType<RewritesFn>>;

export interface PinagentOptions {
  /**
   * When a feedback is submitted, automatically spawn an isolated Claude
   * Agent SDK run to address it.
   *
   * - `'inline'` (default): each submit runs a Claude Agent SDK query in the
   *   main project directory, streaming events back to the widget. Cheaper
   *   than worktree mode; parallel agents may race on the same files.
   * - `'worktree'`: each submit creates a fresh git worktree at
   *   `.pinagent/worktrees/<id>` on a `pinagent/<id>` branch, then runs the
   *   SDK with `cwd` set to that worktree. True parallel agents, no edit
   *   races. Review each branch like a PR. Requires a git repo.
   * - `false` (or `'off'`): no spawn. Use this for channel mode
   *   (`claude --dangerously-load-development-channels`) or pull mode (you
   *   ask your agent yourself) — the comment lands on disk and nothing else
   *   happens automatically.
   *
   * Communicated to the route handler via PINAGENT_SPAWN_AGENT env var.
   * Set PINAGENT_AGENT_PERMISSION_MODE to override the default `acceptEdits`.
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
   * `pinagent(config, { apiKey: process.env.MY_PINAGENT_KEY })`. For the default
   * Claude provider it's passed as the Anthropic key; for the bring-your-own
   * CLI provider it's supplied to the wrapped CLI as both `ANTHROPIC_API_KEY`
   * and `OPENAI_API_KEY`. Bridged to the route handler via the
   * `PINAGENT_AGENT_API_KEY` env var. A key saved at runtime via the dock's
   * Connections route takes precedence over this option.
   */
  apiKey?: string;
  /**
   * Mount the project-management dock surface alongside the per-element
   * widget. Default: false — the widget ships universally, the dock is
   * opt-in because not every project wants a second floating surface on
   * every page.
   *
   * When true, the config sets `NEXT_PUBLIC_PINAGENT_DOCK=1` so the
   * `<Pinagent />` component injects the dock iframe alongside the
   * widget script tag (the env var is inlined into the client bundle at
   * build time by Next's standard NEXT_PUBLIC_ handling). The route
   * handler serves the dock's static assets from `/__pinagent/dock/*`
   * regardless — flipping this flag just controls whether the host
   * page mounts the iframe.
   */
  dock?: boolean;
  /**
   * Command used to launch an on-demand dev server for a worktree when
   * the dock's "Open app" action is clicked (worktree mode only).
   *
   * By default the command is inferred from the worktree's `package.json`.
   * Set this to override the inference for non-standard setups. A `{port}`
   * placeholder is substituted with pinagent's chosen port; if omitted,
   * ` --port <port>` is appended. Example: `'pnpm dev --port {port}'`.
   *
   * Communicated to the route handler via PINAGENT_WORKTREE_SERVE_COMMAND.
   */
  worktreeServeCommand?: string;
}

const loaderPath = (() => {
  // Next.js 16 loads next.config.ts in a way that can leave import.meta.url
  // undefined for imported modules. Fall back to a cwd-anchored URL so
  // createRequire still produces a usable resolver.
  const baseUrl = import.meta.url ?? `file://${process.cwd()}/__pinagent_config__.js`;
  const req = createRequire(baseUrl);
  try {
    return req.resolve('@pinagent/next-plugin/loader');
  } catch {
    return req.resolve('./loader.cjs');
  }
})();

const PINAGENT_REWRITE = {
  source: '/__pinagent/:path*',
  destination: '/pinagent/:path*',
};

/**
 * Wrap your Next.js config to enable Pinagent in development.
 *
 * In dev mode this:
 *  - Adds a webpack/Turbopack loader that tags every JSX opening element with
 *    `data-pa-loc`.
 *  - Rewrites `/__pinagent/*` to `/pinagent/*` so the widget's hardcoded URLs
 *    hit your route handler. We can't use `app/__pinagent/...` directly because
 *    Next.js treats folders starting with `_` as private (not routable).
 *
 * Prod builds are completely untouched.
 *
 * You still need two more files:
 *
 *   // app/layout.tsx — somewhere inside <body>
 *   import { Pinagent } from '@pinagent/next-plugin';
 *   ...
 *   <Pinagent />
 *
 *   // app/pinagent/[[...slug]]/route.ts — exactly this content:
 *   export const dynamic = 'force-dynamic';
 *   export const runtime = 'nodejs';
 *   export * from '@pinagent/next-plugin/route';
 *
 * Note: `dynamic` and `runtime` must be declared inline. Next 16 statically
 * parses route-segment config and rejects re-exports of those fields.
 */
export default function pinagent(
  config: NextConfig = {},
  options: PinagentOptions = {},
): NextConfig {
  // Short-circuit in production: return the user's config object unchanged
  // so neither the webpack wrapper, the rewrites wrapper, nor any turbopack
  // rule appears on the returned config. Anything downstream (Sentry's
  // withSentryConfig, Vercel's build output tracing) sees exactly what the
  // user wrote.
  //
  // The package.json `exports` map also resolves this module to a noop in
  // production. Either path alone is sufficient; both together guarantee
  // pinagent cannot perturb prod builds even if a bundler ignores
  // condition-based resolution.
  if (process.env.NODE_ENV === 'production') {
    return config;
  }

  const userWebpack = config.webpack;
  const userRewrites = config.rewrites;

  // Communicate spawn-agent preference to the route handler via env var.
  // The route reads it on each POST. Set at config-load time (dev startup).
  //
  // Default is 'inline' so the V2 streaming-into-widget flow kicks in
  // without ceremony. Users can opt into 'worktree' for parallel isolated
  // branches, or 'off' / `false` to disable the SDK spawn entirely (for
  // channel-mode or pull-mode workflows).
  const effective =
    options.spawnAgent === undefined
      ? 'inline'
      : options.spawnAgent === false
        ? 'off'
        : options.spawnAgent;
  process.env.PINAGENT_SPAWN_AGENT = effective;

  // Bridge an explicitly-configured agent API key to the route handler (which
  // inherits this env in the dev server it's spawned into). Pinagent only ever
  // uses a key handed to it on purpose — see `apiKey` above and agent-auth.ts.
  // No-op (subscription fallback) when the consumer omits it.
  if (options.apiKey) {
    process.env.PINAGENT_AGENT_API_KEY = options.apiKey;
  }

  // Pick a WS port at config-load time and propagate via env var. The
  // actual `ws.WebSocketServer` is started by the route module (see
  // `route.ts`), NOT here — Next 16 runs `next.config.ts` and route
  // handlers in separate processes, so a server started here would
  // never see the event bus that the route's spawnAgent publishes to.
  // Keeping the server in the route module keeps WS, bus, and agent
  // co-located in the same process.
  if (effective !== 'off' && !process.env.PINAGENT_WS_PORT) {
    process.env.PINAGENT_WS_PORT = '53636';
  }

  // Propagate the worktree-serve override (if any) to the route handler,
  // which reads it via `serveBranch` → `serveWorktree`. Mirrors the
  // spawn-mode / WS-port env-var hand-off above.
  if (options.worktreeServeCommand) {
    process.env.PINAGENT_WORKTREE_SERVE_COMMAND = options.worktreeServeCommand;
  }

  // Propagate the dock flag to the client bundle via NEXT_PUBLIC_*. Next
  // inlines these into client code at build time from process.env as it
  // exists when bundling kicks off — and next.config.ts runs before
  // bundling, so this set is visible to webpack/Turbopack's
  // DefinePlugin. The `<Pinagent />` component reads it to decide
  // whether to inject the dock iframe.
  if (options.dock === true) {
    process.env.NEXT_PUBLIC_PINAGENT_DOCK = '1';
  }

  const next: NextConfig = {
    ...config,
    webpack(...args: Parameters<WebpackFn>): ReturnType<WebpackFn> {
      const [webpackConfig, options] = args;
      if (options.dev && !options.isServer) {
        webpackConfig.module = webpackConfig.module ?? {};
        webpackConfig.module.rules = webpackConfig.module.rules ?? [];
        webpackConfig.module.rules.unshift({
          test: /\.(t|j)sx$/,
          exclude: /node_modules/,
          use: [{ loader: loaderPath }],
        });
      }
      return userWebpack ? userWebpack(webpackConfig, options) : webpackConfig;
    },
    async rewrites(): Promise<RewritesReturn> {
      const existing: RewritesReturn = await (typeof userRewrites === 'function'
        ? userRewrites()
        : Promise.resolve(userRewrites ?? []));

      if (Array.isArray(existing)) {
        return [PINAGENT_REWRITE, ...existing];
      }
      // Existing is the object form: { beforeFiles?, afterFiles?, fallback? }.
      return {
        beforeFiles: [PINAGENT_REWRITE, ...(existing.beforeFiles ?? [])],
        afterFiles: existing.afterFiles ?? [],
        fallback: existing.fallback ?? [],
      };
    },
  };

  next.turbopack = {
    ...(config.turbopack ?? {}),
    rules: {
      ...(config.turbopack?.rules ?? {}),
      // Scope to JSX files only — matches the webpack `test: /\.(t|j)sx$/`
      // above and the vite reference (`vite-plugin/src/index.ts`). The loader
      // bails internally on non-JSX, so a wider glob produces byte-identical
      // output but wastes work: every `.ts`/`.js` module would round-trip
      // through a JS loader for nothing. Narrowing keeps Turbopack's pipeline
      // symmetric with webpack's.
      //
      // Pass the loader as a package specifier (not the absolute path used
      // for webpack). Turbopack resolves loader strings from the project
      // root; an absolute path that lives outside the root (e.g. in a pnpm
      // workspace's `packages/`) breaks `get_next_server_import_map` with
      // "Next.js package not found" because Turbopack walks `node_modules`
      // from the loader file's directory, not the project root.
      '*.{tsx,jsx}': {
        loaders: ['@pinagent/next-plugin/loader'],
      },
    },
  };

  return next;
}
