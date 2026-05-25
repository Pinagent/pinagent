import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { widget: 'src/index.ts' },
  format: ['iife'],
  globalName: 'PinagentWidget',
  outDir: 'dist',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  splitting: false,
  clean: true,
  // Bundle html-to-image into the IIFE
  noExternal: [/.*/],
});
