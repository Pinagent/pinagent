// SPDX-License-Identifier: Apache-2.0
/**
 * The Nuxt module is thin glue, so we test the glue: dev-only gating, that it
 * registers the reused `@pinagent/vite-plugin` Vite plugin, that it injects the
 * widget loader into the app head, and that `spawnAgent` flows through.
 *
 * `@nuxt/kit` is mocked so `defineNuxtModule` returns the definition object
 * (letting us call `setup` directly) and `addVitePlugin` is a spy — no real
 * Nuxt context required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addVitePlugin = vi.fn();
vi.mock('@nuxt/kit', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test shim mirrors kit's shape loosely
  defineNuxtModule: (def: any) => def,
  // biome-ignore lint/suspicious/noExplicitAny: spy passthrough
  addVitePlugin: (...args: any[]) => addVitePlugin(...args),
}));

// Imported after the mock is registered; with the mock, the default export is
// the module definition object (meta/defaults/setup), not a wrapped fn.
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

beforeEach(() => {
  addVitePlugin.mockClear();
});

afterEach(() => {
  delete process.env.PINAGENT_SPAWN_AGENT;
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

  it('injects the widget loader into the app head at body-close', () => {
    const nuxt = fakeNuxt(true);
    setup({ spawnAgent: 'off' }, nuxt);
    expect(nuxt.options.app.head.script).toEqual([
      { src: '/__pinagent/widget.js', type: 'module', tagPosition: 'bodyClose' },
    ]);
  });

  it('preserves any pre-existing head scripts', () => {
    const nuxt = fakeNuxt(true);
    nuxt.options.app.head.script = [{ src: '/existing.js' }];
    setup({ spawnAgent: 'off' }, nuxt);
    expect(nuxt.options.app.head.script).toHaveLength(2);
    expect(nuxt.options.app.head.script[0]).toEqual({ src: '/existing.js' });
  });

  it('forwards spawnAgent through to the underlying Vite plugin', () => {
    setup({ spawnAgent: 'worktree' }, fakeNuxt(true));
    // The Vite plugin records the mode in the env at construction time.
    expect(process.env.PINAGENT_SPAWN_AGENT).toBe('worktree');
  });
});
