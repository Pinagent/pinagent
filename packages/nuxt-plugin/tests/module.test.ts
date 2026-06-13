// SPDX-License-Identifier: Apache-2.0
/**
 * The Nuxt module is thin glue, so we test the glue: dev-only gating, that it
 * registers the reused `@pinagent/vite-plugin` Vite plugin, that it injects the
 * widget loader into the app head, and that the public options flow through to
 * the inner `pinagent(...)` call.
 *
 * `@nuxt/kit` is mocked so `defineNuxtModule` returns the definition object
 * (letting us call `setup` directly) and `addVitePlugin` is a spy — no real
 * Nuxt context required.
 *
 * `@pinagent/vite-plugin`'s default export is wrapped in a spy (the real plugin
 * factory still runs, via `importActual`) so we can assert the exact options
 * object the module forwards. The named `DOCK_*_SCRIPT` exports are preserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addVitePlugin = vi.fn();
vi.mock('@nuxt/kit', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test shim mirrors kit's shape loosely
  defineNuxtModule: (def: any) => def,
  // biome-ignore lint/suspicious/noExplicitAny: spy passthrough
  addVitePlugin: (...args: any[]) => addVitePlugin(...args),
}));

// Spy on the default export (the plugin factory) while keeping the real
// implementation and the named script exports the module also imports.
const pinagentSpy = vi.fn();
vi.mock('@pinagent/vite-plugin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pinagent/vite-plugin')>();
  return {
    ...actual,
    // biome-ignore lint/suspicious/noExplicitAny: spy passthrough to the real factory
    default: (...args: any[]) => {
      pinagentSpy(...args);
      // biome-ignore lint/suspicious/noExplicitAny: forwarding to actual default
      return (actual as any).default(...args);
    },
  };
});

import { DOCK_HOST_BRIDGE_SCRIPT, DOCK_IFRAME_SCRIPT } from '@pinagent/vite-plugin';
// Imported after the mocks are registered; with the `@nuxt/kit` mock, the
// default export is the module definition object (meta/defaults/setup), not a
// wrapped fn.
import moduleDef from '../src/module';

// biome-ignore lint/suspicious/noExplicitAny: definition shape is test-local
const setup = (moduleDef as any).setup as (
  // biome-ignore lint/suspicious/noExplicitAny: options/nuxt are test stubs
  options: any,
  // biome-ignore lint/suspicious/noExplicitAny: options/nuxt are test stubs
  nuxt: any,
) => void;

function fakeNuxt(dev: boolean) {
  return { options: { dev, rootDir: '/proj', app: { head: {} as Record<string, unknown> } } };
}

/** The options object the module passed to the inner `pinagent(...)` call. */
function lastPinagentOptions(): Record<string, unknown> {
  return pinagentSpy.mock.calls.at(-1)?.[0] ?? {};
}

beforeEach(() => {
  addVitePlugin.mockClear();
  pinagentSpy.mockClear();
});

afterEach(() => {
  delete process.env.PINAGENT_SPAWN_AGENT;
  delete process.env.PINAGENT_AGENT_API_KEY;
  delete process.env.PINAGENT_WORKTREE_SERVE_COMMAND;
});

describe('@pinagent/nuxt-plugin module', () => {
  it('does nothing outside dev (production build untouched)', () => {
    const nuxt = fakeNuxt(false);
    setup({}, nuxt);
    expect(addVitePlugin).not.toHaveBeenCalled();
    expect(nuxt.options.app.head.script).toBeUndefined();
  });

  it('registers the @pinagent/vite-plugin Vite plugin in dev', () => {
    const nuxt = fakeNuxt(true);
    setup({ spawnAgent: 'off' }, nuxt);
    expect(addVitePlugin).toHaveBeenCalledTimes(1);
    const plugin = addVitePlugin.mock.calls[0]?.[0];
    expect(plugin?.name).toBe('pinagent');
    // apply:'serve' is what keeps it from touching production builds.
    expect(plugin?.apply).toBe('serve');
  });

  it('injects only the widget loader into the app head when dock is off', () => {
    const nuxt = fakeNuxt(true);
    setup({ spawnAgent: 'off' }, nuxt);
    expect(nuxt.options.app.head.script).toEqual([
      { src: '/__pinagent/widget.js', type: 'module', tagPosition: 'bodyClose' },
    ]);
  });

  it('also injects the dock iframe + host bridge when dock: true', () => {
    const nuxt = fakeNuxt(true);
    setup({ spawnAgent: 'off', dock: true }, nuxt);
    expect(nuxt.options.app.head.script).toEqual([
      { src: '/__pinagent/widget.js', type: 'module', tagPosition: 'bodyClose' },
      { innerHTML: DOCK_IFRAME_SCRIPT, tagPosition: 'bodyClose' },
      { innerHTML: DOCK_HOST_BRIDGE_SCRIPT, tagPosition: 'bodyClose' },
    ]);
  });

  it('preserves any pre-existing head scripts', () => {
    const nuxt = fakeNuxt(true);
    nuxt.options.app.head.script = [{ src: '/existing.js' }];
    setup({ spawnAgent: 'off' }, nuxt);
    expect(nuxt.options.app.head.script).toHaveLength(2);
    expect(nuxt.options.app.head.script[0]).toEqual({ src: '/existing.js' });
  });

  it('always forwards root derived from nuxt.options.rootDir', () => {
    setup({ spawnAgent: 'off' }, fakeNuxt(true));
    expect(lastPinagentOptions().root).toBe('/proj');
  });

  it('forwards spawnAgent through to the underlying Vite plugin', () => {
    setup({ spawnAgent: 'worktree' }, fakeNuxt(true));
    expect(lastPinagentOptions().spawnAgent).toBe('worktree');
    // The Vite plugin also records the mode in the env at construction time.
    expect(process.env.PINAGENT_SPAWN_AGENT).toBe('worktree');
  });

  it('forwards apiKey through to the underlying Vite plugin', () => {
    setup({ spawnAgent: 'off', apiKey: 'sk-test-123' }, fakeNuxt(true));
    expect(lastPinagentOptions().apiKey).toBe('sk-test-123');
    // The Vite plugin bridges the explicit key to the runner via this env var.
    expect(process.env.PINAGENT_AGENT_API_KEY).toBe('sk-test-123');
  });

  it('forwards worktreeServeCommand through to the underlying Vite plugin', () => {
    setup(
      { spawnAgent: 'worktree', worktreeServeCommand: 'nuxt dev --port {port}' },
      fakeNuxt(true),
    );
    expect(lastPinagentOptions().worktreeServeCommand).toBe('nuxt dev --port {port}');
    // The Vite plugin bridges the override to the middleware via this env var.
    expect(process.env.PINAGENT_WORKTREE_SERVE_COMMAND).toBe('nuxt dev --port {port}');
  });

  it('omits unset options (no env-var fallback invented)', () => {
    // apiKey is opt-in only: leaving it unset must NOT pass an apiKey through,
    // and must NOT read ANTHROPIC_API_KEY/OPENAI_API_KEY from the environment.
    setup({ spawnAgent: 'off' }, fakeNuxt(true));
    const opts = lastPinagentOptions();
    expect('apiKey' in opts).toBe(false);
    expect('worktreeServeCommand' in opts).toBe(false);
    expect(process.env.PINAGENT_AGENT_API_KEY).toBeUndefined();
  });

  it('drift guard: every ModuleOptions key is a real PinagentOptions key', () => {
    // Runtime mirror of the type-level `satisfies` guard in module.ts. If the
    // next vite-plugin option is added to ModuleOptions without existing on
    // PinagentOptions (i.e. an invented nuxt-only option), this list forces a
    // conscious update here.
    const moduleOptionKeys = ['spawnAgent', 'apiKey', 'dock', 'worktreeServeCommand'] as const;
    const pinagentOptionKeys = new Set([
      'root',
      'spawnAgent',
      'apiKey',
      'dock',
      'worktreeServeCommand',
    ]);
    for (const key of moduleOptionKeys) {
      expect(pinagentOptionKeys.has(key)).toBe(true);
    }
  });
});
