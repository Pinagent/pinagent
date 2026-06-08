// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

// The Node-side dev-server middleware (`server`) and the Metro/Babel
// source-tagging plugin (`babel`) are built. The RN client under
// `src/native/` ships as TypeScript source (see package.json `exports`)
// so the consumer's Metro/Babel pipeline transpiles it — it imports
// `react-native`, which isn't a dependency of this repo.
export default defineConfig({
  entry: { server: 'src/server/index.ts', babel: 'src/babel.ts' },
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
