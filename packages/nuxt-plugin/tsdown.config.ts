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
  // @nuxt/schema is type-only (the `NuxtModule` annotation on the default
  // export) and must stay external too — bundling its `.d.ts` would drag in its
  // whole transitive type graph (postcss/autoprefixer/typescript), which the
  // dts bundler can't process (CommonJS d.ts → 138 errors). Consumers resolve
  // it via @nuxt/kit / nuxt.
  deps: { neverBundle: ['@nuxt/kit', '@nuxt/schema', '@pinagent/vite-plugin'] },
  sourcemap: true,
  clean: true,
  splitting: false,
  fixedExtension: false,
  hash: false,
});
