// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
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
