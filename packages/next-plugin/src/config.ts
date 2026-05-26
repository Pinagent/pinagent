// SPDX-License-Identifier: Apache-2.0
import { createRequire } from 'node:module';
import type { NextConfig } from 'next';

type WebpackFn = NonNullable<NextConfig['webpack']>;
type RewritesFn = NonNullable<NextConfig['rewrites']>;
type RewritesReturn = Awaited<ReturnType<RewritesFn>>;

export interface PinagentOptions {
  /**
   * When a feedback is submitted, automatically spawn an isolated `claude -p`
   * agent to address it.
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
 *   export { GET, POST, PATCH } from '@pinagent/next-plugin/route';
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
      // Pass the loader as a package specifier (not the absolute path used
      // for webpack). Turbopack resolves loader strings from the project
      // root; an absolute path that lives outside the root (e.g. in a pnpm
      // workspace's `packages/`) breaks `get_next_server_import_map` with
      // "Next.js package not found" because Turbopack walks `node_modules`
      // from the loader file's directory, not the project root.
      '*.{ts,tsx,js,jsx}': {
        loaders: ['@pinagent/next-plugin/loader'],
      },
    },
  };

  return next;
}
