// SPDX-License-Identifier: Apache-2.0
import type { StorybookConfig } from '@storybook/html-vite';

/**
 * Storybook for the browser widget. The widget is vanilla shadow-root DOM
 * (no React framework), so we use the HTML renderer on Storybook's Vite
 * builder. Stories import the *real* widget source — `composerHTML`,
 * `STYLES`, `buildPinIcon`, … — so what you design here is exactly what
 * ships in the embedded IIFE. See `src/stories/story-mount.ts` for the
 * shadow-root + iframe scaffolding that mirrors `mount()`.
 */
const config: StorybookConfig = {
  framework: '@storybook/html-vite',
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
};

export default config;
