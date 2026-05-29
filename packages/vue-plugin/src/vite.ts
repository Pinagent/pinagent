// SPDX-License-Identifier: Apache-2.0
import { relative, sep } from 'node:path';
import type { Plugin } from 'vite';
import { transformVue } from './transform';

// Minimal proof-of-concept Vite plugin. It mirrors the extension-dispatch
// pattern from @pinagent/vite-plugin's `transform` hook, but for `.vue` files
// instead of `.tsx`. A production plugin would handle both in one place
// (transformVue for *.vue, transformJsx for *.tsx) and also inject the widget
// + /__pinagent middleware — none of which is Vue-specific.

const toPosix = (p: string): string => p.split(sep).join('/');

export function vitePlugin(): Plugin {
  let root = process.cwd();
  let isServe = false;

  return {
    name: 'pinagent:vue-tag',
    // Run before @vitejs/plugin-vue so we tag the *raw* SFC source. plugin-vue
    // then re-parses our tagged source into its descriptor, so the attributes
    // flow through to the compiled `?vue&type=template` submodule.
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
      isServe = config.command === 'serve';
    },

    transform(code, id) {
      // Dev-only, matching Pinagent's "production builds are untouched" invariant.
      if (!isServe) return null;
      // Strip query strings (Vite adds ?vue&type=..., ?v=hash, etc.).
      const cleanId = id.split('?')[0] ?? id;
      if (!cleanId.endsWith('.vue')) return null;
      if (cleanId.includes(`${sep}node_modules${sep}`) || cleanId.includes('/node_modules/')) {
        return null;
      }

      const rel = toPosix(relative(root, cleanId)) || cleanId;
      const transformed = transformVue(code, { relPath: rel });
      if (!transformed) return null;
      // `map: null` lets Vite synthesize a fresh map from the diff — safe
      // because we only splice attributes inline and never move source lines.
      return { code: transformed, map: null };
    },
  };
}
