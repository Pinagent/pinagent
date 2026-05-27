// SPDX-License-Identifier: Apache-2.0
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
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
