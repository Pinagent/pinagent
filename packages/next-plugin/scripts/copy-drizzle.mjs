#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Mirror the drizzle migrations from @pinagent/db into
// packages/next-plugin/drizzle/ so the published next-plugin tarball
// ships them. The agent-runner runtime (bundled into next-plugin's
// dist) probes `<dist>/../drizzle` for migrations at first connect.
//
// Single source of truth: packages/db/drizzle/. This script copies at
// build time. The destination is gitignored. Mirror of
// packages/vite-plugin/scripts/copy-drizzle.mjs.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../db/drizzle');
const dst = resolve(here, '../drizzle');

if (!existsSync(src)) {
  console.error(
    `[pinagent:next-plugin] drizzle source not found at ${src}. Has the schema in @pinagent/db been generated? Run \`pnpm --filter @pinagent/db drizzle:gen\`.`,
  );
  process.exit(1);
}

if (!statSync(src).isDirectory()) {
  console.error(`[pinagent:next-plugin] drizzle source ${src} is not a directory`);
  process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(dirname(dst), { recursive: true });
cpSync(src, dst, { recursive: true });

const count = readdirSync(dst).filter((n) => n.endsWith('.sql')).length;
console.log(`[pinagent:next-plugin] copied ${count} migration(s) → ${dst}`);
