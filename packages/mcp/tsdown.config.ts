// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
  // Match tsup naming: ESM as `.js`, CJS as `.cjs`. Keeps existing
  // `"bin": { "pinagent-mcp": "dist/index.js" }` in package.json valid.
  fixedExtension: false,
  hash: false,
});
