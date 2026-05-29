// SPDX-License-Identifier: Elastic-2.0
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The cloud dashboard SPA. In dev, API calls go to `/usage`, `/members`, … on
 * the same origin; point the proxy at a running control-plane Worker (or set
 * `VITE_CLOUD_API_BASE` to its URL).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/usage': 'http://127.0.0.1:8787',
      '/members': 'http://127.0.0.1:8787',
      '/audit': 'http://127.0.0.1:8787',
      '/subscriptions': 'http://127.0.0.1:8787',
      '/cost-controls': 'http://127.0.0.1:8787',
      '/branch-routing': 'http://127.0.0.1:8787',
      '/sso': 'http://127.0.0.1:8787',
    },
  },
});
