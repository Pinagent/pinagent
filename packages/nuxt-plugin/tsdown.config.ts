// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { module: 'src/module.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node20',
  platform: 'node',
  // @nuxt/kit and @pinagent/vite-plugin are runtime dependencies, not
  // bundled — vite-plugin's middleware resolves its drizzle/dock/sqlite-wasm
  // assets relative to its own install, so it must stay an external import.
  deps: { neverBundle: ['@nuxt/kit', '@pinagent/vite-plugin'] },
  sourcemap: true,
  clean: true,
  splitting: false,
  fixedExtension: false,
  hash: false,
});
