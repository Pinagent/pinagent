// SPDX-License-Identifier: Apache-2.0
/**
 * Companion to vue-transform.test.ts: the `pinagent()` Vite plugin also
 * dispatches `.svelte` components through @pinagent/svelte-plugin's
 * `transformSvelte`, alongside `.vue` and `.tsx`/`.jsx`. This is what makes the
 * click→agent loop work for Svelte + Vite apps, reusing the same
 * widget/middleware/WS wiring.
 *
 * We drive the `transform` hook directly: `config()` flips the serve gate,
 * `configResolved` pins the root, then we assert on the rewritten source.
 */
import { describe, expect, it } from 'vitest';
import pinagent from '../src/index';

const ROOT = '/proj';

function primedPlugin() {
  // spawnAgent: 'off' so constructing the plugin never tries to bind a WS port.
  // biome-ignore lint/suspicious/noExplicitAny: hooks are invoked directly in tests
  const plugin = pinagent({ spawnAgent: 'off', root: ROOT }) as any;
  plugin.config();
  plugin.configResolved({ root: ROOT });
  return plugin;
}

const COMPONENT = `<script>
  let count = 0;
</script>

<main>
  <button onclick={() => count++}>Count is {count}</button>
</main>
`;

describe('pinagent() transform dispatch — Svelte', () => {
  it('tags a .svelte component with data-pa-loc + data-pa-comp', () => {
    const out = primedPlugin().transform(COMPONENT, `${ROOT}/src/App.svelte`);
    expect(out).not.toBeNull();
    expect(out.code).toContain('<main data-pa-loc="src/App.svelte:');
    expect(out.code).toContain('<button data-pa-loc="src/App.svelte:');
    // Svelte's enclosing-component identity is the filename.
    expect(out.code).toContain('data-pa-comp="App"');
  });

  it('is a no-op on the compiled ?svelte sub-module (no parseable component)', () => {
    // vite-plugin-svelte re-requests App.svelte?svelte&type=style etc. with
    // compiled output — stripping the query lands on `.svelte`, but there is
    // nothing taggable.
    const compiled = 'export default function App() {}\n';
    const out = primedPlugin().transform(
      compiled,
      `${ROOT}/src/App.svelte?svelte&type=style&lang.css`,
    );
    expect(out).toBeNull();
  });

  it('skips .svelte files under node_modules', () => {
    const out = primedPlugin().transform(COMPONENT, `${ROOT}/node_modules/dep/Comp.svelte`);
    expect(out).toBeNull();
  });
});
