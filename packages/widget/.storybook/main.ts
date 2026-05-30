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

  // Dogfood loop (opt-in). With `PINAGENT_DOGFOOD=1 pnpm storybook`, mount the
  // *real* @pinagent/vite-plugin onto Storybook's own dev server: it injects
  // the production widget IIFE into the preview iframe and serves the
  // /__pinagent endpoints, so you can pin-comment your own widget stories with
  // the widget. `spawnAgent: 'off'` keeps it offline — no WS server, no port
  // binding (avoids the shared 53636 collision), no agent-runner — comments
  // land in `.pinagent/` for an external `pinagent mcp` / Claude Code to pick
  // up. Requires the plugin built first (`pnpm build`).
  //
  // Off by default and gated on the env var so the normal Storybook and the
  // CI `build-storybook` gate never load the plugin. We import its built
  // `dist` by workspace-relative path rather than by package specifier on
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
      viteConfig.plugins.push(pinagent({ spawnAgent: 'off' }));
      // eslint-disable-next-line no-console
      console.log('[pinagent:storybook] dogfood mode — widget injected into the preview');
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
