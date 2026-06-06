// SPDX-License-Identifier: Apache-2.0
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

  // Dogfood loop (opt-in), manager half. The widget is injected into the
  // *preview* iframe (see `viteFinal`), so its pick hotkey only fires when
  // focus is in the story canvas. Expose the dogfood flag to the manager
  // bundle so `manager.ts` can relay the hotkey across the frame boundary
  // when focus is in the Storybook chrome. Off (no flag) otherwise, so the
  // relay stays a no-op in normal Storybook and the CI build-storybook gate.
  managerHead: (head) =>
    process.env.PINAGENT_DOGFOOD
      ? `${head}\n<script>window.__PINAGENT_DOGFOOD__ = true;</script>`
      : head,

  // Dogfood loop (opt-in). With `PINAGENT_DOGFOOD=1 pnpm storybook`, mount the
  // *real* @pinagent/vite-plugin onto Storybook's own dev server: it injects
  // the production widget IIFE into the preview iframe and serves the
  // /__pinagent endpoints, so you can pin-comment your own widget stories with
  // the widget. `spawnAgent: 'inline'` closes the loop — each submit runs a
  // Claude Agent SDK query against `packages/widget`, streams progress back
  // into the composer, and shows the running-agent FAB/tray. It boots the WS
  // server on the shared port 53636, so don't run another pinagent dev server
  // at the same time, and it needs Claude credentials. Edits land in
  // `packages/widget/src` (the `data-pa-loc` anchors point there). Requires the
  // plugin built first (`pnpm build`); for an offline queue you drive yourself,
  // swap to `spawnAgent: 'off'` and run `pinagent mcp` / Claude Code instead.
  //
  // Gated on the env var so the normal Storybook and the CI `build-storybook`
  // gate never load the plugin (and never bind the WS port). We import its
  // built `dist` by workspace-relative path rather than by package specifier on
  // purpose: declaring `@pinagent/vite-plugin` as a widget dependency would
  // create a turbo build cycle (vite-plugin already depends on the widget),
  // and pnpm's strict node_modules won't resolve an undeclared specifier.
  // Importing the file directly lets Node resolve the plugin's *own* deps
  // from *its* node_modules. Requires the plugin built first (`pnpm build`).
  async viteFinal(viteConfig) {
    if (!process.env.PINAGENT_DOGFOOD) return viteConfig;
    const distUrl = pathToFileURL(
      join(import.meta.dirname, '../../vite-plugin/dist/index.js'),
    ).href;
    try {
      const { default: pinagent } = await import(distUrl);
      viteConfig.plugins = viteConfig.plugins ?? [];
      viteConfig.plugins.push(pinagent({ spawnAgent: 'inline' }));
      // eslint-disable-next-line no-console
      console.log('[pinagent:storybook] dogfood mode — widget injected, spawnAgent: inline');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[pinagent:storybook] PINAGENT_DOGFOOD set but @pinagent/vite-plugin failed to load — run \`pnpm build\` first. (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    return viteConfig;
  },
};

export default config;
