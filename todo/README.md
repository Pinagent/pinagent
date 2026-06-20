# Offline-first feature-parity audit — ticket index

Audit date: 2026-06-12. Scope: the offline-first layer (browser SQLite-WASM mirror of
`.pinagent/db.sqlite`) and its integrations: `vite-plugin`, `next-plugin`, `nuxt-plugin`,
`svelte-plugin`, `vue-plugin`, `react-native` (Expo + bare Metro). `ee/*` and `apps/cloud`
were explicitly excluded.

## How the offline-first layer works (ground truth)

Server SQLite (`.pinagent/db.sqlite`, `node:sqlite`) is the source of truth. The web widget
keeps a **rebuildable mirror** of `conversations` + `widget_anchors` + `messages` in
SQLite-WASM (OPFS SAH Pool VFS, no COOP/COEP needed; silent `:memory:` fallback) via
`@pinagent/browser-runtime`'s worker. On WS reconnect the widget wipes a conversation's
mirrored messages and the server replays the full transcript from the `messages` table
(the bus is SQLite-backed; subscribe always replays). A host integration must serve:
`/__pinagent/widget.js`, `/__pinagent/db-worker.js`, `/__pinagent/db-migrations`,
`/__pinagent/sqlite-wasm/*`, the feedback REST endpoints, and the WS endpoint.

## Parity matrix (condensed)

| Capability | vite | next | nuxt | svelte/vue | react-native |
|---|---|---|---|---|---|
| Source tagging | ✅ | ✅ | ✅ (via vite) | ✅ (transforms shipped inside vite-plugin) | ✅ (babel preset) |
| Widget / picker | ✅ | ✅ | ✅ | ✅ via vite-plugin | ✅ (FAB + tap) |
| Multi-select (`additional_anchors`) | ✅ | ✅ | ✅ | ✅ | ❌ → [008](008-rn-multi-select-parity.md) |
| Screenshot with feedback | ✅ | ✅ | ✅ | ✅ | ✅ (view-shot) |
| Offline mirror (survives reload) | ✅ | ✅ | ✅ | ✅ | ❌ → [001](001-rn-restore-conversations-after-reload.md) |
| Failed-submit draft kept | ❌ (no outbox) | ❌ | ❌ | ❌ | ❌ (worse: comment cleared) → [002](002-rn-failed-submit-draft-retention.md) |
| Follow-up queue survives reload | ❌ → [004](004-widget-persist-followup-queue.md) | ❌ | ❌ | ❌ | n/a (in-memory) |
| WS stream + replay on reconnect | ✅ | ✅ | ✅ | ✅ | ✅ |
| spawnAgent inline/worktree/off | ✅ | ✅ | ✅ | ✅ | ✅ |
| `apiKey` option | ✅ | ✅ | ❌ → [007](007-nuxt-option-passthrough-parity.md) | ✅ | ❌ → [011](011-rn-middleware-config-parity.md) |
| `worktreeServeCommand` option | ✅ | ✅ | ❌ → [007](007-nuxt-option-passthrough-parity.md) | ✅ | n/a (no dock) |
| Dock | ✅ | ✅ | ✅ | ✅ | intentional non-goal (MCP pull mode) |
| Prod-noop verb parity | n/a | ❌ → [003](003-next-route-noop-verb-parity.md) | n/a | n/a | n/a |
| Example app | ✅ | ✅ | ✅ | svelte ✅ / vue ❌ → [012](012-vue-vite-example.md) | ✅ (expo-app) |

Dock-only endpoints (branches/changes/PRs/connections/settings) are intentionally absent from
the RN Metro middleware — RN's multi-agent story is MCP pull mode. Not a gap; no ticket.

## Tickets

| # | Ticket | Priority | Packages |
|---|---|---|---|
| 001 | [RN: restore conversations after app reload](001-rn-restore-conversations-after-reload.md) | P1 | react-native |
| 002 | [RN: keep the draft when submit fails](002-rn-failed-submit-draft-retention.md) | P1 | react-native |
| 003 | [next: route-noop verb parity (PUT/DELETE)](003-next-route-noop-verb-parity.md) | P1 | next-plugin |
| 004 | [widget: persist follow-up queue across reload](004-widget-persist-followup-queue.md) | P2 | widget (+plugin cascade) |
| 005 | [widget: surface `:memory:` persistence degradation](005-widget-surface-persistence-degradation.md) | P3 | browser-runtime, widget (+plugin cascade) |
| 006 | [widget: offline lifecycle test coverage](006-offline-lifecycle-test-coverage.md) | P2 | widget |
| 007 | [nuxt: option passthrough parity](007-nuxt-option-passthrough-parity.md) | P2 | nuxt-plugin |
| 008 | [RN: multi-select parity](008-rn-multi-select-parity.md) | P2 | react-native |
| 009 | [next: narrow Turbopack loader rule to JSX](009-next-turbopack-loader-rule.md) | P3 | next-plugin |
| 010 | [next: deployment-shape hardening (basePath, middleware, pages router)](010-next-deployment-shape-hardening.md) | P3 | next-plugin |
| 011 | [RN: middleware config parity (`apiKey`)](011-rn-middleware-config-parity.md) | P3 | react-native |
| 012 | [examples: Vue + Vite example app](012-vue-vite-example.md) | P3 | examples |
| 013 | [svelte/vue plugin: stale README + status cleanup](013-svelte-vue-plugin-status-cleanup.md) | P3 | svelte-plugin, vue-plugin |
| 014 | [docs: offline-first host-integration contract](014-offline-first-contract-doc.md) | P3 | docs |

Suggested order: 003 (smallest, prod-build risk) → 001 → 002 → 007 → 004/006 → 008 → rest.
001+002 touch the same RN files — one agent should do both, 001 first.

## RN agent-dock follow-ups (audit 2026-06-20)

Found while rehauling the minimized running-agent UI into the compact dock
(`run-state.ts` + `AgentDock.tsx`; the stuck-error and missing-connecting-state
bugs were fixed in that change). These are independent stream-sheet bugs left as
follow-ups. Same ground rules below apply.

| # | Ticket | Priority | Packages |
|---|---|---|---|
| 015 | [RN: surface interrupt (Stop) feedback](015-rn-stream-stop-feedback.md) | P2 | react-native |
| 016 | [RN: ask-options overflow pushes input off-screen](016-rn-ask-options-overflow.md) | P3 | react-native |
| 017 | [RN: transcript auto-scroll hijacks scroll-back](017-rn-transcript-autoscroll-hijack.md) | P3 | react-native |

## Ground rules for every ticket (sub-agent checklist)

1. **Worktree isolation.** Other agents run concurrently in this repo. Do code work in a git
   worktree, not the primary checkout. Fetch + rebase onto `origin/main` before starting AND
   before pushing. Never `git stash` or `git add -A` in the shared checkout. Inspect your PR
   content with `git diff origin/main...HEAD` (three dots).
2. **Bootstrap.** A fresh worktree needs `pnpm install` then a full `pnpm build` before
   vitest/typecheck work (tests resolve `@pinagent/*` from built `dist/`). Run all commands
   with cwd inside the worktree (`pnpm -C <worktree>` or `cd` first) — the default cwd is the
   primary checkout.
3. **SPDX.** Every new source file gets `// SPDX-License-Identifier: Apache-2.0` on line 1
   (everything in these tickets is in the Apache zone). `pnpm lint:spdx` enforces.
4. **Changesets.** Required for publishable `packages/*` (vite-plugin, next-plugin,
   nuxt-plugin, db, ui, widget-dock, mcp). NOT required for ignored packages (widget, shared,
   babel-plugin, browser-runtime, agent-runner, react-native, examples). **Widget cascade:**
   any change to widget (or bundled-into-plugin code like browser-runtime's worker source)
   that alters shipped bytes needs changesets bumping BOTH `@pinagent/vite-plugin` and
   `@pinagent/next-plugin` (`pnpm lint:widget-cascade` enforces; embed via
   `pnpm generate:plugin-widget-embed`).
5. **Tests** live in `packages/<pkg>/tests/` (auto-discovered). DOM tests start with
   `// @vitest-environment happy-dom`. React Native runtime code can NOT be unit-tested here
   (RN isn't installed; `vi.mock` won't intercept the missing require) — test pure logic
   (reducers, payload builders) only.
6. **Schema changes** to `packages/db/src/schema.ts` need `pnpm --filter @pinagent/db drizzle:gen`.
7. **Invariants:** localhost-only (`127.0.0.1`), dev-only (`NODE_ENV !== 'production'` gating),
   server SQLite is the source of truth (browser/device stores are rebuildable mirrors),
   import drizzle operators from `@pinagent/db` (never `drizzle-orm` directly), the bus stays
   SQLite-backed (never in-memory-only).
8. **Gates before pushing:** `pnpm build && pnpm typecheck && pnpm test && pnpm lint`, plus the
   relevant `lint:*` extras if you touched packaging/deps/headers.
9. **Conventional commits**, one logical change per commit. Base every PR on `main`, never on
   another feature branch.
10. Cited `file:line` numbers in tickets were verified on 2026-06-12 but drift — re-verify
    before editing.
