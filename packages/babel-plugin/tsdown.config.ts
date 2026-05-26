// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', loader: 'src/loader.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  // Emit ESM as .js (default) and CJS as .cjs so package.json `exports` can
  // map both via a single condition tree.
  fixedExtension: false,
  // Stable filenames for the shared transform chunk so turbo caches hit.
  hash: false,
});
