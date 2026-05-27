// SPDX-License-Identifier: Apache-2.0
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Three entry points share this Vite config:
 *
 *   - `index.html`      — dev preview (vite dev), points at src/main.tsx.
 *                         NOT part of the production build; it's the
 *                         designer's local UX with the host backdrop.
 *   - `embedded.html`   — production iframe build (consumed by
 *                         @pinagent/vite-plugin + @pinagent/next-plugin).
 *                         Memory history, no host backdrop.
 *   - `standalone.html` — production hosted-dashboard build (future
 *                         app.pinagent.io). Browser history.
 *
 * `rollupOptions.input` lists only the two production entries so dist/
 * doesn't pick up the dev preview.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        embedded: resolve(__dirname, 'embedded.html'),
        standalone: resolve(__dirname, 'standalone.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: false,
    // Proxy /__pinagent/* to the host app's dev-server (vite-plugin or
    // next-plugin middleware), where the storage layer + WS server
    // actually live. The target is the typical Vite host port; override
    // via PINAGENT_HOST_ORIGIN if you run the host on a different port.
    proxy: {
      '/__pinagent': {
        target: process.env.PINAGENT_HOST_ORIGIN ?? 'http://127.0.0.1:5173',
        changeOrigin: true,
      },
    },
  },
});
