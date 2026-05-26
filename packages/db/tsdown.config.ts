import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', schema: 'src/schema.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'es2022',
  platform: 'neutral',
  deps: { neverBundle: ['drizzle-orm', 'drizzle-orm/sqlite-core'] },
  sourcemap: true,
  clean: true,
  splitting: false,
});
