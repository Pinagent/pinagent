// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

// VSCode loads extensions in its CommonJS extension host, so the entry
// must be a single CJS file with a synchronous `activate` export. We
// mark `vscode` external because the host injects it at runtime — it
// isn't installed as a real npm dependency.
//
// `ws` must be BUNDLED, not externalized: we package the .vsix with
// `vsce --no-dependencies`, so node_modules never ships — a leftover
// `require("ws")` would throw at activation and break the URI handler
// too. `noExternal` forces it inline.
export default defineConfig({
  entry: { extension: 'src/extension.ts' },
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ['vscode'],
  noExternal: ['ws'],
  fixedExtension: true,
  hash: false,
});
