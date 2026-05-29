// SPDX-License-Identifier: Apache-2.0
import { relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { transformSvelte } from './transform';

// Minimal proof-of-concept Vite plugin. It mirrors the extension-dispatch
// pattern from @pinagent/vite-plugin's `transform` hook, but for `.svelte`
// files instead of `.tsx`. A production plugin would handle all of them in one
// place (transformSvelte for *.svelte, transformVue for *.vue, transformJsx for
// *.tsx) and also inject the widget + /__pinagent middleware — none of which is
// Svelte-specific.

const toPosix = (p: string): string => p.split(sep).join('/');

export function vitePlugin(): Plugin {
  let root = process.cwd();
  let isServe = false;

  return {
    name: 'pinagent:svelte-tag',
    // Run before @sveltejs/vite-plugin-svelte so we tag the *raw* component
    // source before it's compiled. vite-plugin-svelte then compiles our tagged
    // markup, so the attributes flow through to the rendered DOM.
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
      isServe = config.command === 'serve';
    },

    transform(code, id) {
      // Dev-only, matching Pinagent's "production builds are untouched" invariant.
      if (!isServe) return null;
      // Strip query strings (Vite / vite-plugin-svelte add ?svelte&type=..., etc.).
      const cleanId = id.split('?')[0] ?? id;
      if (!cleanId.endsWith('.svelte')) return null;
      if (cleanId.includes(`${sep}node_modules${sep}`) || cleanId.includes('/node_modules/')) {
        return null;
      }

      const rel = toPosix(relative(root, cleanId)) || cleanId;
      const transformed = transformSvelte(code, { relPath: rel });
      if (!transformed) return null;
      // `map: null` lets Vite synthesize a fresh map from the diff — safe
      // because we only splice attributes inline and never move source lines.
      return { code: transformed, map: null };
    },
  };
}
