// SPDX-License-Identifier: Elastic-2.0
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config for the cloud Postgres schema (organizations +
 * memberships). Migrations are version-controlled in `drizzle/` so the
 * history is reviewable in PRs and applyable against Neon.
 *
 * Run:
 *   pnpm --filter @pinagent/cloud drizzle:gen      (generate migration, offline)
 *   pnpm --filter @pinagent/cloud drizzle:check    (lint generated files, offline)
 *   pnpm --filter @pinagent/cloud drizzle:migrate  (apply pending migrations)
 *
 * `drizzle:migrate` needs DATABASE_URL — the same Neon/Postgres string the
 * Worker reads (see `.dev.vars.example`). The Worker does NOT auto-apply
 * migrations on boot, so this is the only path that advances the schema; run
 * it via Doppler so the value matches the target environment, e.g.
 *   doppler run --config dev -- pnpm --filter @pinagent/cloud drizzle:migrate
 */
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  // Only migrate/push/studio need a connection; generate/check work offline.
  // Include dbCredentials only when DATABASE_URL is set so the offline commands
  // never require it (drizzle-kit reports a clear error if migrate runs without).
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
});
