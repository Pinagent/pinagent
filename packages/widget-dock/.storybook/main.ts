// SPDX-License-Identifier: Apache-2.0
import { resolve } from 'node:path';
import type { StorybookConfig } from '@storybook/react-vite';
import tailwindcss from '@tailwindcss/vite';

/**
 * Storybook for the dock — a React/TanStack SPA — on the React renderer +
 * Vite builder. Stories import the real dock components so the design system
 * here matches what ships in the iframe build.
 *
 * `viteFinal` re-adds the two bits the dock's own `vite.config.ts` relies on
 * that Storybook's base config doesn't know about: the Tailwind v4 plugin
 * (so `@pinagent/ui`'s utility classes resolve) and the `@` → `src` alias.
 * `@vitejs/plugin-react` is supplied by the framework.
 */
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  async viteFinal(viteConfig) {
    viteConfig.plugins = viteConfig.plugins ?? [];
    viteConfig.plugins.push(tailwindcss());
    viteConfig.resolve = viteConfig.resolve ?? {};
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias,
      '@': resolve(import.meta.dirname, '../src'),
    };
    return viteConfig;
  },
};

export default config;
