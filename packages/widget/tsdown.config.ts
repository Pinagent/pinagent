// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

export default defineConfig([
  // Browser IIFE bundle — the script the host page actually drops in.
  {
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
  },
  // Tiny ESM/CJS library entries that expose the brand path + colors
  // and the React `<Logo>` to anything else in the repo (examples,
  // marketing pages, etc.) without dragging in the full widget bundle.
  {
    entry: { brand: 'src/brand.ts', logo: 'src/logo.tsx' },
    format: ['esm', 'cjs'],
    outDir: 'dist',
    platform: 'neutral',
    target: 'es2020',
    dts: true,
    sourcemap: true,
    splitting: false,
    clean: false,
    fixedExtension: false,
    hash: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime'] },
  },
]);
