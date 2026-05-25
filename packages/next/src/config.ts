import { createRequire } from 'node:module';

// biome-ignore lint/suspicious/noExplicitAny: NextConfig isn't easily importable as a type-only dep
type NextConfig = any;

const loaderPath = (() => {
  const req = createRequire(import.meta.url);
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
export default function pinpoint(config: NextConfig = {}): NextConfig {
  const userWebpack = config.webpack;
  const userRewrites = config.rewrites;
  const isDev = process.env.NODE_ENV !== 'production';

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
