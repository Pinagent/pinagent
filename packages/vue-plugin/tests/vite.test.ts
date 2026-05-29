// SPDX-License-Identifier: Apache-2.0
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { vitePlugin } from '../src/vite';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// End-to-end: spin up a real Vite dev server with our pre-transform plugin
// ahead of @vitejs/plugin-vue, SSR-render the fixture SFC, and confirm the
// rendered DOM string carries data-pa-loc attributes pointing back at source.
describe('vitePlugin (end-to-end via Vite SSR)', () => {
  let server: ViteDevServer;
  let html: string;

  beforeAll(async () => {
    server = await createServer({
      root: fixtures,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      server: { middlewareMode: true },
      plugins: [vitePlugin(), vue()],
    });
    const mod = (await server.ssrLoadModule('/entry-server.ts')) as {
      render: () => Promise<string>;
    };
    html = await mod.render();
  }, 60_000);

  afterAll(async () => {
    await server?.close();
  });

  it('renders real DOM elements carrying data-pa-loc', () => {
    expect(html).toMatch(/data-pa-loc="App\.vue:\d+:\d+"/);
  });

  it('tags the native elements from the template', () => {
    // <main> is the first template element, on line 9 of the SFC.
    expect(html).toContain('data-pa-loc="App.vue:9:3"');
    // <h1>, <button>, <ul>, <li>, and both <p> branches all render too.
    expect(html).toContain('<h1 data-pa-loc=');
    expect(html).toContain('<button data-pa-loc=');
  });

  it('tags elements inside v-for and v-if branches', () => {
    // Two fruits → two <li> elements, both tagged with the same source loc.
    const liTags = html.match(/<li data-pa-loc="App\.vue:\d+:\d+"/g) ?? [];
    expect(liTags.length).toBe(2);
    // count starts at 0, so the v-else <p> renders — and it's tagged.
    expect(html).toContain('not yet');
    expect(html).toMatch(/<p data-pa-loc="App\.vue:\d+:\d+"[^>]*>not yet<\/p>/);
  });

  it('carries the enclosing component name through the pipeline', () => {
    // Fixture is App.vue → every element gets data-pa-comp="App", so both
    // <li> loop instances share one component identity.
    expect(html).toContain('data-pa-comp="App"');
    const compTags = html.match(/data-pa-comp="App"/g) ?? [];
    expect(compTags.length).toBeGreaterThanOrEqual(2);
  });
});
