#!/usr/bin/env node
// Mirror the drizzle migrations from @pinagent/next-plugin into
// packages/vite-plugin/drizzle/ so the published vite-plugin tarball ships
// the same migration set. The agent-runner runtime (bundled into vite-plugin's
// dist) probes `<dist>/../drizzle` for migrations at first connect.
//
// Single source of truth: packages/next-plugin/drizzle/. This script copies
// at build time. The destination is gitignored.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../next-plugin/drizzle');
const dst = resolve(here, '../drizzle');

if (!existsSync(src)) {
  console.error(
    `[pinagent:vite-plugin] drizzle source not found at ${src}. Has @pinagent/next-plugin been built / generated?`,
  );
  process.exit(1);
}

if (!statSync(src).isDirectory()) {
  console.error(`[pinagent:vite-plugin] drizzle source ${src} is not a directory`);
  process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
mkdirSync(dirname(dst), { recursive: true });
cpSync(src, dst, { recursive: true });

const count = readdirSync(dst).filter((n) => n.endsWith('.sql')).length;
console.log(`[pinagent:vite-plugin] copied ${count} migration(s) → ${dst}`);
