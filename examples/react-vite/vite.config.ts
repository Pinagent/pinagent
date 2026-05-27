import pinagent from '@pinagent/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [pinagent(), react()],
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
