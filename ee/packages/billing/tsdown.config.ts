import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Match tsup/tsdown<0.x naming: ESM as `.js`, CJS as `.cjs`. Keeps the
  // existing `"main": "./dist/index.js"` in package.json valid.
  fixedExtension: false,
  hash: false,
});
