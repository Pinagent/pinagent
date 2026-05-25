import { defineConfig } from 'tsup';

const common = {
  format: ['esm', 'cjs'] as ('esm' | 'cjs')[],
  dts: true,
  target: 'node20' as const,
  platform: 'node' as const,
  external: ['next', 'react', 'react/jsx-runtime'],
  sourcemap: true,
  splitting: false,
};

export default defineConfig([
  // Server-only entries: config, route handlers, webpack loader
  {
    ...common,
    entry: {
      config: 'src/config.ts',
      route: 'src/route.ts',
      loader: 'src/loader.ts',
    },
    clean: true,
  },
  // Client-only entry: the <Pinpoint /> component.
  // The 'use client' banner is required — esbuild strips the source directive
  // when bundling, so we re-inject it as the first line of the output.
  {
    ...common,
    entry: { index: 'src/index.ts' },
    clean: false,
    banner: { js: "'use client';" },
  },
]);
