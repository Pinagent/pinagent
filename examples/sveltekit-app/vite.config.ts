import pinagent from '@pinagent/vite-plugin';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // pinagent() first — it runs enforce:'pre', so it tags raw .svelte source
  // before vite-plugin-svelte compiles it. It also mounts the /__pinagent
  // middleware and starts the WebSocket server on the same Vite dev server.
  plugins: [pinagent(), sveltekit()],
});
