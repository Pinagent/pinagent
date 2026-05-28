// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

// VSCode loads extensions in its CommonJS extension host, so the entry
// must be a single CJS file with a synchronous `activate` export. We
// mark `vscode` external because the host injects it at runtime — it
// isn't installed as a real npm dependency.
export default defineConfig({
  entry: { extension: 'src/extension.ts' },
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ['vscode'],
  fixedExtension: true,
  hash: false,
});
