import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  // Match tsup naming: ESM as `.js`, CJS as `.cjs`. The package.json
  // `exports` map still references `./dist/index.js` for ESM consumers.
  fixedExtension: false,
  hash: false,
});
