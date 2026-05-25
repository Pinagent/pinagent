import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
});
