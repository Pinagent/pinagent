import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { widget: 'src/index.ts' },
  format: ['iife'],
  outDir: 'dist',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  splitting: false,
  clean: true,
  // Bundle everything (drizzle-orm, html-to-image) into the IIFE so the
  // widget is a single self-contained script the host page can drop in.
  deps: { alwaysBundle: [/.*/] },
});
