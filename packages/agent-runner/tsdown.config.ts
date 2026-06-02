// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsdown';

export default defineConfig({
  // `index` is the full runtime (pulls the Claude Agent SDK via providers).
  // `pr` is a deliberately SDK-free entry — just the git + Octokit PR core —
  // so `@pinagent/mcp` can import `openHostBranchPr` without bundling the SDK
  // into its published bin. Keep host-branch-pr.ts free of SDK imports.
  entry: { index: 'src/index.ts', pr: 'src/host-branch-pr.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  target: 'node20',
  platform: 'node',
  deps: { neverBundle: ['@sqlite.org/sqlite-wasm'] },
  sourcemap: true,
  clean: true,
  splitting: false,
  fixedExtension: false,
  hash: false,
});
