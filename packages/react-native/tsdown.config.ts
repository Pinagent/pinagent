// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

// Only the Node-side dev-server middleware is built. The RN client under
// `src/native/` ships as TypeScript source (see package.json `exports`)
// so the consumer's Metro/Babel pipeline transpiles it — it imports
// `react-native`, which isn't a dependency of this repo.
export default defineConfig({
  entry: { server: 'src/server/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node20',
  platform: 'node',
  deps: { neverBundle: ['@sqlite.org/sqlite-wasm'] },
  sourcemap: true,
  clean: true,
  splitting: false,
  fixedExtension: false,
  hash: false,
});
