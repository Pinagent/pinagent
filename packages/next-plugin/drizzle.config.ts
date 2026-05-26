// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit config for generating SQL migrations from the shared
 * schema in @pinagent/db.
 *
 * Run:
 *   pnpm --filter @pinagent/next-plugin drizzle:gen   (generate migration)
 *   pnpm --filter @pinagent/next-plugin drizzle:check (lint generated files)
 *
 * The generated `drizzle/` folder is checked in and shipped with the
 * package; the server applies migrations at first connect.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: '../db/src/schema.ts',
  out: './drizzle',
  // Generated migrations are version-controlled; we don't need
  // drizzle-kit's own bookkeeping table.
  strict: true,
  verbose: true,
});
