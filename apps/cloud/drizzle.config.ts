// SPDX-License-Identifier: Elastic-2.0
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config for the cloud Postgres schema (organizations +
 * memberships). Migrations are version-controlled in `drizzle/` so the
 * history is reviewable in PRs and applyable against Neon.
 *
 * Run:
 *   pnpm --filter @pinagent/cloud drizzle:gen    (generate migration)
 *   pnpm --filter @pinagent/cloud drizzle:check  (lint generated files)
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
