// SPDX-License-Identifier: Elastic-2.0
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  fixedExtension: false,
  hash: false,
});
