// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config for generating SQL migrations from the shared
 * schema in this package. Migrations live next to the schema; framework
 * adapters (next-plugin, vite-plugin) copy them into their dist tree at
 * build time via their `scripts/copy-drizzle.mjs` prebuild, so the
 * published tarballs ship the migrations even though @pinagent/db
 * itself is private and never published.
 *
 * Run:
 *   pnpm --filter @pinagent/db drizzle:gen   (generate migration)
 *   pnpm --filter @pinagent/db drizzle:check (lint generated files)
 *
 * The generated `drizzle/` folder is version-controlled here so the
 * migration history is reviewable in PRs.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
  // Generated migrations are version-controlled; we don't need
  // drizzle-kit's own bookkeeping table.
  strict: true,
  verbose: true,
});
