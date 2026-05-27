import pinagent from '@pinagent/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // `dock: true` opts the project into the dock surface alongside the
  // per-element widget. The plugin serves the dock's static assets from
  // /__pinagent/dock/* and injects a full-viewport, pointer-events:none
  // iframe pointing at it. Drop the flag to ship only the widget.
  plugins: [pinagent({ dock: true }), react()],
  // Defaults to `spawnAgent: 'inline'` — every submit runs a Claude Agent SDK
  // query and streams progress into the widget over WS. Override with
  // `pinagent({ spawnAgent: 'worktree' })` for isolated git worktrees per
  // submit, or `pinagent({ spawnAgent: 'off' })` to disable per-submit
  // spawning entirely (then use `@pinagent/cli mcp` or
  //   claude --dangerously-load-development-channels server:pinagent
  // to drive the loop from your own agent session).
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
});
