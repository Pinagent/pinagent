// SPDX-License-Identifier: Apache-2.0
import pinagent from '@pinagent/vite-plugin';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  // `pinagent()` first — it runs `enforce: 'pre'`, so it tags the raw `.vue`
  // SFC `<template>` markup with `data-pa-loc` before `@vitejs/plugin-vue`
  // compiles it. Keeping it first matches the conventional order the other
  // examples use. It also mounts the `/__pinagent` middleware and starts the
  // WebSocket server on the same Vite dev server.
  //
  // `dock: true` opts the project into the dock surface alongside the
  // per-element widget. Drop the flag to ship only the widget.
  plugins: [pinagent({ dock: true }), vue()],
  // Defaults to `spawnAgent: 'inline'` — every submit runs a Claude Agent SDK
  // query and streams progress into the widget over WS. Override with
  // `pinagent({ spawnAgent: 'worktree' })` for isolated git worktrees per
  // submit, or `pinagent({ spawnAgent: 'off' })` to disable per-submit
  // spawning entirely (then use `@pinagent/cli mcp` or
  //   claude --dangerously-load-development-channels server:pinagent
  // to drive the loop from your own agent session).
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: false,
  },
});
