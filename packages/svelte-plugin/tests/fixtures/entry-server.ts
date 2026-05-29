// SPDX-License-Identifier: Apache-2.0
import { render } from 'svelte/server';
// @ts-expect-error — .svelte has no ambient type here; compiled by vite-plugin-svelte.
import App from './App.svelte';

// Rendered through Vite's real SSR pipeline by the integration test: our
// pre-transform tags the raw component, @sveltejs/vite-plugin-svelte compiles
// it, and the resulting DOM string should carry the data-pa-loc attributes.
export function renderApp(): string {
  return render(App).body;
}
