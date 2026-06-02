// SPDX-License-Identifier: Apache-2.0
/**
 * `getDb` self-ignores the `.pinagent` data dir so git never sees the
 * SQLite DB / screenshots / worktrees — otherwise the dashboard listed
 * them as changes and `git add -A` committed them into the user's PR.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe('getDb — .pinagent self-ignore', () => {
  it('writes .pinagent/.gitignore with `*` on first open', () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-dbgi-'));
    roots.push(root);
    getDb(root);
    const gi = join(root, '.pinagent', '.gitignore');
    expect(existsSync(gi)).toBe(true);
    expect(readFileSync(gi, 'utf8').trim()).toBe('*');
  });
});
