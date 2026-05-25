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
  // Server-only entries: config, route handlers, webpack loader.
  // The `-noop` variants are production stubs resolved via the `"default"`
  // condition in package.json exports — they ship zero claude-agent-sdk,
  // zero @babel/*, zero `ws`, and no node:child_process / node:fs.
  {
    ...common,
    entry: {
      config: 'src/config.ts',
      'config-noop': 'src/config-noop.ts',
      route: 'src/route.ts',
      'route-noop': 'src/route-noop.ts',
      loader: 'src/loader.ts',
    },
    clean: true,
  },
  // Client-only entries: the <Pinpoint /> component (dev) and its prod stub.
  // The 'use client' banner is required — esbuild strips the source directive
  // when bundling, so we re-inject it as the first line of the output.
  {
    ...common,
    entry: {
      index: 'src/index.ts',
      'index-noop': 'src/component-noop.tsx',
    },
    clean: false,
    banner: { js: "'use client';" },
  },
]);
