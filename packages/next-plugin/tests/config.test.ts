// SPDX-License-Identifier: Apache-2.0
/**
 * `pinagent()` Next config wrapper (src/config.ts). Pure config-in →
 * config-out transformation, so it's testable with plain objects + env
 * assertions, no Next runtime. The contract: prod is untouched, dev wires
 * the JSX loader (webpack + turbopack) and the /__pinagent rewrite, and the
 * options propagate to the route handler via env vars.
 */
import type { NextConfig } from 'next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pinagent from '../src/config';

// Env keys pinagent() reads or writes — snapshot + restore around each test
// so cases don't leak into one another (or the rest of the suite).
const ENV_KEYS = [
  'NODE_ENV',
  'PINAGENT_SPAWN_AGENT',
  'PINAGENT_WS_PORT',
  'PINAGENT_WORKTREE_SERVE_COMMAND',
  'NEXT_PUBLIC_PINAGENT_DOCK',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  // Default to a dev-like env for the common path.
  process.env.NODE_ENV = 'development';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Resolve the (sync-or-async, array-or-object) rewrites() return to its value. */
async function callRewrites(config: NextConfig) {
  const fn = config.rewrites;
  if (typeof fn !== 'function') throw new Error('expected a rewrites function');
  return fn();
}

describe('pinagent() — production short-circuit', () => {
  it('returns the user config unchanged and adds no wrappers in production', () => {
    process.env.NODE_ENV = 'production';
    const userConfig: NextConfig = { reactStrictMode: true };
    const result = pinagent(userConfig, { dock: true, spawnAgent: 'worktree' });
    expect(result).toBe(userConfig);
    expect(result.turbopack).toBeUndefined();
    // None of the env-var side effects fire in prod.
    expect(process.env.PINAGENT_SPAWN_AGENT).toBeUndefined();
    expect(process.env.NEXT_PUBLIC_PINAGENT_DOCK).toBeUndefined();
  });
});

describe('pinagent() — env propagation', () => {
  it("defaults spawnAgent to 'inline' and picks the default WS port", () => {
    pinagent();
    expect(process.env.PINAGENT_SPAWN_AGENT).toBe('inline');
    expect(process.env.PINAGENT_WS_PORT).toBe('53636');
  });

  it("maps spawnAgent false to 'off' and skips the WS port", () => {
    pinagent({}, { spawnAgent: false });
    expect(process.env.PINAGENT_SPAWN_AGENT).toBe('off');
    expect(process.env.PINAGENT_WS_PORT).toBeUndefined();
  });

  it("passes through 'worktree' and 'off' spawn modes", () => {
    pinagent({}, { spawnAgent: 'worktree' });
    expect(process.env.PINAGENT_SPAWN_AGENT).toBe('worktree');
    delete process.env.PINAGENT_SPAWN_AGENT;
    delete process.env.PINAGENT_WS_PORT;
    pinagent({}, { spawnAgent: 'off' });
    expect(process.env.PINAGENT_SPAWN_AGENT).toBe('off');
  });

  it('does not overwrite a WS port that is already set', () => {
    process.env.PINAGENT_WS_PORT = '40000';
    pinagent();
    expect(process.env.PINAGENT_WS_PORT).toBe('40000');
  });

  it('propagates dock and worktreeServeCommand options', () => {
    pinagent({}, { dock: true, worktreeServeCommand: 'pnpm dev --port {port}' });
    expect(process.env.NEXT_PUBLIC_PINAGENT_DOCK).toBe('1');
    expect(process.env.PINAGENT_WORKTREE_SERVE_COMMAND).toBe('pnpm dev --port {port}');
  });

  it('leaves the dock env var unset when dock is not enabled', () => {
    pinagent({}, { dock: false });
    expect(process.env.NEXT_PUBLIC_PINAGENT_DOCK).toBeUndefined();
  });
});

describe('pinagent() — webpack loader injection', () => {
  type WebpackArgs = Parameters<NonNullable<NextConfig['webpack']>>;
  const runWebpack = (config: NextConfig, opts: { dev: boolean; isServer: boolean }) => {
    const base = { module: { rules: [] as unknown[] } };
    // biome-ignore lint/suspicious/noExplicitAny: minimal stand-in for webpack's config/context.
    return config.webpack?.(base as any, opts as any) as any;
  };

  it('unshifts the JSX loader rule for the dev client bundle', () => {
    const result = pinagent();
    const out = runWebpack(result, { dev: true, isServer: false });
    expect(out.module.rules).toHaveLength(1);
    const rule = out.module.rules[0];
    expect(rule.test.test('Foo.tsx')).toBe(true);
    expect(rule.use[0].loader).toBeTruthy();
  });

  it('adds no loader rule for the server bundle or for prod-mode builds', () => {
    const result = pinagent();
    expect(runWebpack(result, { dev: true, isServer: true }).module.rules).toHaveLength(0);
    expect(runWebpack(result, { dev: false, isServer: false }).module.rules).toHaveLength(0);
  });

  it("calls the user's webpack fn and returns its result", () => {
    const sentinel = { module: { rules: [] }, marker: 'user-config' };
    let called = false;
    const userConfig: NextConfig = {
      webpack: (() => {
        called = true;
        return sentinel;
        // biome-ignore lint/suspicious/noExplicitAny: test stub for webpack fn.
      }) as any,
    };
    const result = pinagent(userConfig);
    const out = (result.webpack as (...a: WebpackArgs) => unknown)(
      // biome-ignore lint/suspicious/noExplicitAny: minimal webpack config stand-in.
      { module: { rules: [] } } as any,
      // biome-ignore lint/suspicious/noExplicitAny: minimal webpack context stand-in.
      { dev: true, isServer: false } as any,
    );
    expect(called).toBe(true);
    expect(out).toBe(sentinel);
  });
});

describe('pinagent() — rewrites', () => {
  it('returns just the pinagent rewrite when the user has none', async () => {
    const rewrites = await callRewrites(pinagent());
    expect(rewrites).toEqual([{ source: '/__pinagent/:path*', destination: '/pinagent/:path*' }]);
  });

  it('prepends the pinagent rewrite to a user array', async () => {
    const userRule = { source: '/old', destination: '/new' };
    // biome-ignore lint/suspicious/noExplicitAny: user rewrites can be a plain array.
    const result = pinagent({ rewrites: (async () => [userRule]) as any });
    const rewrites = (await callRewrites(result)) as Array<{ source: string }>;
    expect(rewrites[0].source).toBe('/__pinagent/:path*');
    expect(rewrites[1]).toEqual(userRule);
  });

  it('merges into the object form, preserving afterFiles/fallback', async () => {
    const beforeRule = { source: '/b', destination: '/bb' };
    const afterRule = { source: '/a', destination: '/aa' };
    const result = pinagent({
      // biome-ignore lint/suspicious/noExplicitAny: object-form rewrites return.
      rewrites: (async () => ({ beforeFiles: [beforeRule], afterFiles: [afterRule] })) as any,
    });
    const rewrites = (await callRewrites(result)) as {
      beforeFiles: Array<{ source: string }>;
      afterFiles: unknown[];
      fallback: unknown[];
    };
    expect(rewrites.beforeFiles[0].source).toBe('/__pinagent/:path*');
    expect(rewrites.beforeFiles[1]).toEqual(beforeRule);
    expect(rewrites.afterFiles).toEqual([afterRule]);
    expect(rewrites.fallback).toEqual([]);
  });
});

describe('pinagent() — turbopack', () => {
  it('registers the loader rule and merges existing turbopack config', () => {
    const result = pinagent({
      turbopack: { rules: { '*.svg': { loaders: ['my-svg-loader'] } } },
    });
    const rules = result.turbopack?.rules as Record<string, { loaders: string[] }>;
    expect(rules['*.{ts,tsx,js,jsx}'].loaders).toEqual(['@pinagent/next-plugin/loader']);
    // Pre-existing rule is preserved.
    expect(rules['*.svg'].loaders).toEqual(['my-svg-loader']);
  });
});
