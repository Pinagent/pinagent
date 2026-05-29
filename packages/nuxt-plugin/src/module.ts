// SPDX-License-Identifier: Apache-2.0
import { addVitePlugin, defineNuxtModule } from '@nuxt/kit';
import pinagent, {
  DOCK_HOST_BRIDGE_SCRIPT,
  DOCK_IFRAME_SCRIPT,
  type PinagentOptions,
} from '@pinagent/vite-plugin';

/**
 * `@pinagent/nuxt-plugin` — bring Pinagent's click→agent loop to Nuxt.
 *
 * Nuxt's dev bundler is Vite, so this module is thin: it reuses the whole
 * `@pinagent/vite-plugin` via `addVitePlugin`. That single plugin tags source
 * (Vue SFC `<template>` markup and any `.tsx`/`.jsx`), mounts the
 * `/__pinagent/*` dev middleware, and starts the WebSocket server — all inside
 * vite-plugin's own module graph, so there's one Storage / drizzle identity and
 * its asset reads resolve from its own install.
 *
 * The module fills the gap Vite reuse leaves: `transformIndexHtml` (how
 * vite-plugin injects its client scripts) doesn't run for Nuxt's server-rendered
 * HTML, so we inject the widget loader — and, with `dock: true`, the dock iframe
 * + host bridge — via the app head instead.
 *
 * Everything is gated on `nuxt.options.dev` — production builds are untouched,
 * matching Pinagent's dev-only invariant.
 */

export interface ModuleOptions {
  /**
   * When a comment is submitted, spawn a Claude Agent SDK run to address it.
   * `'inline'` (default) streams a run against the project root over the
   * WebSocket; `'worktree'` isolates each run in its own git worktree; `'off'`
   * (or `false`) just records the comment for a pull/channel-mode agent.
   * Forwarded verbatim to `@pinagent/vite-plugin`.
   */
  spawnAgent?: PinagentOptions['spawnAgent'];
  /**
   * Mount the project-management dock surface alongside the per-element widget.
   * Default: `false`. When enabled, the reused middleware serves the dock's
   * static assets from `/__pinagent/dock/*` and this module injects the dock
   * iframe + host-side keyboard/pointer bridge into the app head (the SSR
   * analogue of vite-plugin's `transformIndexHtml` injection).
   */
  dock?: boolean;
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@pinagent/nuxt-plugin',
    configKey: 'pinagent',
    compatibility: { nuxt: '>=3.0.0' },
  },
  defaults: {},
  setup(options, nuxt) {
    // Dev-only — the loader, widget, and middleware never touch a build.
    if (!nuxt.options.dev) {
      return;
    }

    // Reuse the entire Vite plugin. `apply: 'serve'` keeps it dev-only even
    // though we already guard on `nuxt.options.dev`; `enforce: 'pre'` means
    // Vue SFCs are tagged before @vitejs/plugin-vue compiles them. Added to
    // both the client and SSR builds so the server-rendered HTML carries the
    // same `data-pa-loc` attributes the client does (no hydration mismatch);
    // tagging is idempotent, so the double pass is a no-op on the second run.
    const dock = options.dock === true;
    addVitePlugin(
      pinagent({
        root: nuxt.options.rootDir,
        ...(options.spawnAgent !== undefined ? { spawnAgent: options.spawnAgent } : {}),
        ...(dock ? { dock: true } : {}),
      }),
    );

    // Inject the dev-only scripts. Vite's `transformIndexHtml` (how vite-plugin
    // injects these for SPAs) never fires for Nuxt's SSR'd document, so we add
    // them to the app head at body-close instead. The bundles/assets are served
    // by the reused `/__pinagent/*` middleware with the right WS config.
    nuxt.options.app.head.script = nuxt.options.app.head.script ?? [];
    nuxt.options.app.head.script.push({
      src: '/__pinagent/widget.js',
      type: 'module',
      tagPosition: 'bodyClose',
    });

    // With the dock enabled, also inject the iframe loader + host bridge. These
    // are inline scripts (reused verbatim from @pinagent/vite-plugin so the
    // subtle pointer-events/keyboard logic stays single-sourced).
    if (dock) {
      nuxt.options.app.head.script.push(
        { innerHTML: DOCK_IFRAME_SCRIPT, tagPosition: 'bodyClose' },
        { innerHTML: DOCK_HOST_BRIDGE_SCRIPT, tagPosition: 'bodyClose' },
      );
    }
  },
});
