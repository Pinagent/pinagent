import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import pinpoint from '@pinpoint/vite-plugin';

export default defineConfig({
  plugins: [pinpoint(), react()],
  // Note: prefer running Claude Code with the channel flag so feedback is
  // pushed into your existing session — no spawn-per-submit cost:
  //   claude --dangerously-load-development-channels server:pinpoint
  // If you'd rather spawn a fresh `claude -p` per submit, pass
  // `pinpoint({ autoTrigger: true })` above instead.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
});
