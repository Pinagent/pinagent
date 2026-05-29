// SPDX-License-Identifier: Apache-2.0
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import App from './App.vue';

// Rendered through Vite's real SSR pipeline by the integration test: our
// pre-transform tags the raw SFC, @vitejs/plugin-vue compiles it, and the
// resulting DOM string should carry the data-pa-loc attributes.
export async function render(): Promise<string> {
  return renderToString(createSSRApp(App));
}
