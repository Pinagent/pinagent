import { createRequire } from 'node:module';

// biome-ignore lint/suspicious/noExplicitAny: NextConfig isn't easily importable as a type-only dep
type NextConfig = any;

export interface PinpointOptions {
  /**
   * When a feedback is submitted, automatically spawn an isolated `claude -p`
   * agent to address it.
   *
   * - `'inline'` (default): each submit runs a Claude Agent SDK query in the
   *   main project directory, streaming events back to the widget. Cheaper
   *   than worktree mode; parallel agents may race on the same files.
   * - `'worktree'`: each submit creates a fresh git worktree at
   *   `.pinpoint/worktrees/<id>` on a `pinpoint/<id>` branch, then runs the
   *   SDK with `cwd` set to that worktree. True parallel agents, no edit
   *   races. Review each branch like a PR. Requires a git repo.
   * - `false` (or `'off'`): no spawn. Use this for channel mode
   *   (`claude --dangerously-load-development-channels`) or pull mode (you
   *   ask your agent yourself) — the comment lands on disk and nothing else
   *   happens automatically.
   *
   * Communicated to the route handler via PINPOINT_SPAWN_AGENT env var.
   * Set PINPOINT_AGENT_PERMISSION_MODE to override the default `acceptEdits`.
   */
  spawnAgent?: 'worktree' | 'inline' | 'off' | false;
}

const loaderPath = (() => {
  // Next.js 16 loads next.config.ts in a way that can leave import.meta.url
  // undefined for imported modules. Fall back to a cwd-anchored URL so
  // createRequire still produces a usable resolver.
  const baseUrl =
    import.meta.url ?? `file://${process.cwd()}/__pinpoint_config__.js`;
  const req = createRequire(baseUrl);
  try {
    return req.resolve('@pinpoint/next/loader');
  } catch {
    return req.resolve('./loader.cjs');
  }
})();

const PINPOINT_REWRITE = {
  source: '/__pinpoint/:path*',
  destination: '/pinpoint/:path*',
};

/**
 * Wrap your Next.js config to enable Pinpoint in development.
 *
 * In dev mode this:
 *  - Adds a webpack/Turbopack loader that tags every JSX opening element with
 *    `data-pp-loc`.
 *  - Rewrites `/__pinpoint/*` to `/pinpoint/*` so the widget's hardcoded URLs
 *    hit your route handler. We can't use `app/__pinpoint/...` directly because
 *    Next.js treats folders starting with `_` as private (not routable).
 *
 * Prod builds are completely untouched.
 *
 * You still need two more files:
 *
 *   // app/layout.tsx — somewhere inside <body>
 *   import { Pinpoint } from '@pinpoint/next';
 *   ...
 *   <Pinpoint />
 *
 *   // app/pinpoint/[[...slug]]/route.ts — exactly this content:
 *   export const dynamic = 'force-dynamic';
 *   export const runtime = 'nodejs';
 *   export { GET, POST, PATCH } from '@pinpoint/next/route';
 *
 * Note: `dynamic` and `runtime` must be declared inline. Next 16 statically
 * parses route-segment config and rejects re-exports of those fields.
 */
export default function pinpoint(
  config: NextConfig = {},
  options: PinpointOptions = {},
): NextConfig {
  const userWebpack = config.webpack;
  const userRewrites = config.rewrites;
  const isDev = process.env.NODE_ENV !== 'production';

  // Communicate spawn-agent preference to the route handler via env var.
  // The route reads it on each POST. Set at config-load time (dev startup).
  //
  // Default is 'inline' so the V2 streaming-into-widget flow kicks in
  // without ceremony. Users can opt into 'worktree' for parallel isolated
  // branches, or 'off' / `false` to disable the SDK spawn entirely (for
  // channel-mode or pull-mode workflows).
  if (isDev) {
    const effective =
      options.spawnAgent === undefined
        ? 'inline'
        : options.spawnAgent === false
          ? 'off'
          : options.spawnAgent;
    process.env.PINPOINT_SPAWN_AGENT = effective;
  }

  const next: NextConfig = {
    ...config,
    webpack(webpackConfig: any, options: any) {
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
    async rewrites() {
      const existing = await (typeof userRewrites === 'function'
        ? userRewrites()
        : Promise.resolve(userRewrites ?? []));

      if (!isDev) return existing as any;

      if (Array.isArray(existing)) {
        return [PINPOINT_REWRITE, ...existing];
      }
      // Existing is an object with beforeFiles/afterFiles/fallback.
      const obj = existing as {
        beforeFiles?: any[];
        afterFiles?: any[];
        fallback?: any[];
      };
      return {
        beforeFiles: [PINPOINT_REWRITE, ...(obj.beforeFiles ?? [])],
        afterFiles: obj.afterFiles ?? [],
        fallback: obj.fallback ?? [],
      };
    },
  };

  if (isDev) {
    next.turbopack = {
      ...(config.turbopack ?? {}),
      rules: {
        ...(config.turbopack?.rules ?? {}),
        '*.{ts,tsx,js,jsx}': {
          loaders: [loaderPath],
        },
      },
    };
  }

  return next;
}

export { pinpoint };
