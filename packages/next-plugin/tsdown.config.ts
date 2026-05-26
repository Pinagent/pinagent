// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

const common = {
  format: ['esm', 'cjs'] as ('esm' | 'cjs')[],
  dts: true,
  target: 'node20' as const,
  platform: 'node' as const,
  deps: { neverBundle: ['next', 'react', 'react/jsx-runtime'] },
  sourcemap: true,
  splitting: false,
  // Match tsup naming: ESM as `.js`, CJS as `.cjs`. package.json's
  // `exports` map references `./dist/<entry>.js` (ESM) and `.cjs` (CJS).
  fixedExtension: false,
  // Disable content-hashed chunk filenames so the shared chunk split
  // out between the two-config array build gets a stable name —
  // important for deterministic turbo cache hits.
  hash: false,
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
  // Client-only entries: the <Pinagent /> component (dev) and its prod stub.
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
