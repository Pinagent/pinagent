// SPDX-License-Identifier: Apache-2.0
/**
 * The `pinagent()` Vite plugin dispatches its `transform` hook on file
 * extension: `.vue` SFCs go through @pinagent/vue-plugin's `transformVue`
 * (tagging `<template>` markup), `.tsx`/`.jsx` through the babel JSX
 * transform — and everything else is left untouched. This is the
 * framework-agnostic source-tagging entry point that makes the click→agent
 * loop work for Vue + Vite apps, reusing the same widget/middleware/WS wiring.
 *
 * We drive the hook directly: `config()` flips the serve gate, `configResolved`
 * pins the root so the embedded `file:line:col` is project-relative, then we
 * call `transform(code, id)` and assert on the rewritten source.
 */
import { describe, expect, it } from 'vitest';
import pinagent from '../src/index';

const ROOT = '/proj';

/** Build a serve-mode plugin with the root pinned, hooks primed. */
function primedPlugin() {
  // spawnAgent: 'off' so constructing the plugin never tries to bind a WS port.
  // biome-ignore lint/suspicious/noExplicitAny: hooks are invoked directly in tests
  const plugin = pinagent({ spawnAgent: 'off', root: ROOT }) as any;
  plugin.config();
  plugin.configResolved({ root: ROOT });
  return plugin;
}

const SFC = `<script setup lang="ts">
const n = 1;
</script>

<template>
  <main>
    <button @click="n++">Count is {{ n }}</button>
  </main>
</template>
`;

describe('pinagent() transform dispatch', () => {
  it('tags a .vue SFC with data-pa-loc + data-pa-comp', () => {
    const out = primedPlugin().transform(SFC, `${ROOT}/src/App.vue`);
    expect(out).not.toBeNull();
    expect(out.code).toContain('<main data-pa-loc="src/App.vue:');
    expect(out.code).toContain('<button data-pa-loc="src/App.vue:');
    // Vue's enclosing-component identity is the SFC filename.
    expect(out.code).toContain('data-pa-comp="App"');
  });

  it('still tags .tsx via the JSX transform (React path unchanged)', () => {
    const tsx = 'export function Foo() {\n  return <div>hi</div>;\n}\n';
    const out = primedPlugin().transform(tsx, `${ROOT}/src/Foo.tsx`);
    expect(out).not.toBeNull();
    expect(out.code).toContain('data-pa-loc="src/Foo.tsx:');
    expect(out.code).toContain('data-pa-comp="Foo"');
  });

  it('is a no-op on the compiled ?vue sub-module (no parseable SFC template)', () => {
    // @vitejs/plugin-vue re-requests App.vue?vue&type=template with compiled
    // JS — stripping the query lands on `.vue`, but there is no SFC to tag.
    const compiled = 'export function render() { return null; }\n';
    const out = primedPlugin().transform(compiled, `${ROOT}/src/App.vue?vue&type=template&lang.js`);
    expect(out).toBeNull();
  });

  it('skips .vue files under node_modules', () => {
    const out = primedPlugin().transform(SFC, `${ROOT}/node_modules/dep/Comp.vue`);
    expect(out).toBeNull();
  });

  it('leaves unrelated extensions untouched', () => {
    const out = primedPlugin().transform('body { color: red; }', `${ROOT}/src/app.css`);
    expect(out).toBeNull();
  });

  it('does nothing outside serve (production build)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: hooks are invoked directly in tests
    const plugin = pinagent({ spawnAgent: 'off', root: ROOT }) as any;
    // No config() call → isServe stays false.
    plugin.configResolved({ root: ROOT });
    expect(plugin.transform(SFC, `${ROOT}/src/App.vue`)).toBeNull();
  });
});
