// SPDX-License-Identifier: Apache-2.0
/**
 * Deployment-shape hardening (ticket 010). pinagent serves the widget and all
 * `/__pinagent/*` endpoints from root-absolute paths, so a non-empty
 * `basePath` / `assetPrefix` silently 404s the widget. `pinagent()` emits one
 * grep-able `[pinagent]` warning in dev when it detects this. The decision is
 * factored into the pure `shouldWarnDeploymentShape` predicate so it's testable
 * without a Next runtime; this file covers both the predicate and the wiring.
 */
import type { NextConfig } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pinagent, { DEPLOYMENT_SHAPE_WARNING, shouldWarnDeploymentShape } from '../src/config';

describe('shouldWarnDeploymentShape', () => {
  it('warns when basePath is set', () => {
    expect(shouldWarnDeploymentShape({ basePath: '/app' })).toBe(true);
  });

  it('warns when assetPrefix is set', () => {
    expect(shouldWarnDeploymentShape({ assetPrefix: 'https://cdn.example.com' })).toBe(true);
  });

  it('warns when both are set', () => {
    expect(shouldWarnDeploymentShape({ basePath: '/app', assetPrefix: '/cdn' })).toBe(true);
  });

  it('does not warn for an empty config (the root default)', () => {
    expect(shouldWarnDeploymentShape({})).toBe(false);
  });

  it('treats empty-string basePath/assetPrefix (the Next default = root) as no warning', () => {
    expect(shouldWarnDeploymentShape({ basePath: '', assetPrefix: '' })).toBe(false);
  });
});

describe('pinagent() — deployment-shape warning', () => {
  const ENV_KEYS = ['NODE_ENV', 'PINAGENT_SPAWN_AGENT', 'PINAGENT_WS_PORT'] as const;
  let saved: Record<string, string | undefined>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.NODE_ENV = 'development';
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('emits exactly one [pinagent] warning in dev when basePath is set', () => {
    pinagent({ basePath: '/app' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(DEPLOYMENT_SHAPE_WARNING);
    expect(DEPLOYMENT_SHAPE_WARNING.startsWith('[pinagent]')).toBe(true);
  });

  it('emits the warning in dev when assetPrefix is set', () => {
    pinagent({ assetPrefix: 'https://cdn.example.com' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(DEPLOYMENT_SHAPE_WARNING);
  });

  it('stays silent in dev for a config without basePath/assetPrefix', () => {
    pinagent({ reactStrictMode: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn in production (the short-circuit runs first)', () => {
    process.env.NODE_ENV = 'production';
    const userConfig: NextConfig = { basePath: '/app' };
    const result = pinagent(userConfig);
    // Prod returns the user config untouched and emits no warning.
    expect(result).toBe(userConfig);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
