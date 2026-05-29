// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // Pin a compatibility date so Nuxt's defaults stay stable across releases.
  compatibilityDate: '2025-01-01',

  // Wire Pinagent in. The module is dev-only: it tags this app's .vue
  // `<template>` markup with data-pa-loc, mounts the /__pinagent dev
  // middleware, starts the WebSocket server, and injects the widget loader.
  modules: ['@pinagent/nuxt-plugin'],

  // Optional Pinagent config (these are the defaults):
  //   pinagent: { spawnAgent: 'inline' }   // 'inline' | 'worktree' | 'off'
  // 'inline' runs a Claude Agent SDK query on each submit and streams progress
  // back into the widget over WebSocket. Set 'off' to only record comments and
  // drive the loop from your own agent session via `@pinagent/cli mcp`.

  devtools: { enabled: false },
});
