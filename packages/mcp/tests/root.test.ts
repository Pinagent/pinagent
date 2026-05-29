// SPDX-License-Identifier: Apache-2.0
/**
 * `resolveRoot` precedence: explicit env var → nearest `.pinagent/`
 * ancestor → nearest `package.json` ancestor → cwd. Exercised against
 * real temp directory trees so the walk-up logic is covered, not mocked.
 */

import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRoot } from '../src/root';

let base: string;

beforeEach(async () => {
  // realpath so macOS's /var -> /private/var symlink doesn't break equality.
  base = realpathSync(await mkdtemp(join(tmpdir(), 'pa-root-')));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('resolveRoot', () => {
  it('honors PINAGENT_PROJECT_ROOT above everything else', () => {
    const explicit = join(base, 'explicit');
    expect(resolveRoot({ PINAGENT_PROJECT_ROOT: explicit }, join(base, 'somewhere', 'else'))).toBe(
      resolve(explicit),
    );
  });

  it('walks up to the nearest .pinagent ancestor', async () => {
    await mkdir(join(base, '.pinagent'), { recursive: true });
    const deep = join(base, 'apps', 'web', 'src');
    await mkdir(deep, { recursive: true });
    expect(resolveRoot({}, deep)).toBe(base);
  });

  it('prefers a closer .pinagent over a higher package.json', async () => {
    // package.json at base, .pinagent in a nested app — the .pinagent
    // pass runs first and should win.
    await writeFile(join(base, 'package.json'), '{}', 'utf8');
    const app = join(base, 'apps', 'web');
    await mkdir(join(app, '.pinagent'), { recursive: true });
    const deep = join(app, 'src', 'components');
    await mkdir(deep, { recursive: true });
    expect(resolveRoot({}, deep)).toBe(app);
  });

  it('falls back to the nearest package.json when no .pinagent exists', async () => {
    await writeFile(join(base, 'package.json'), '{}', 'utf8');
    const deep = join(base, 'src', 'nested');
    await mkdir(deep, { recursive: true });
    expect(resolveRoot({}, deep)).toBe(base);
  });

  it('falls back to cwd when neither marker is present', async () => {
    const deep = join(base, 'plain', 'dir');
    await mkdir(deep, { recursive: true });
    // No .pinagent and no package.json anywhere down this temp subtree;
    // resolveRoot returns the cwd it was given.
    expect(resolveRoot({}, deep)).toBe(resolve(deep));
  });

  it('ignores an empty-string env var (treated as unset)', async () => {
    await mkdir(join(base, '.pinagent'), { recursive: true });
    expect(resolveRoot({ PINAGENT_PROJECT_ROOT: '' }, base)).toBe(base);
  });
});
