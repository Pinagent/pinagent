// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'es2022',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
});
