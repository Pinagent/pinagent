// SPDX-License-Identifier: Apache-2.0
/**
 * Exercises the working-copy fs watcher against a real temp dir: a source
 * edit fires (debounced) `onChange`, and writes under ignored dirs
 * (`.git`, `node_modules`, `.pinagent`) stay silent.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkingCopyWatcher, type WorkingCopyWatcher } from '../src/working-copy-watcher';

const ROOT = join(tmpdir(), `pa-wcw-${nanoid(8)}`);
let watcher: WorkingCopyWatcher | null = null;

beforeEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(join(ROOT, 'src'), { recursive: true });
  await mkdir(join(ROOT, 'node_modules', 'pkg'), { recursive: true });
  await mkdir(join(ROOT, '.git'), { recursive: true });
  await mkdir(join(ROOT, '.pinagent'), { recursive: true });
});

afterEach(async () => {
  await watcher?.close();
  watcher = null;
  await rm(ROOT, { recursive: true, force: true });
});

/** Resolves true if onChange fired within `ms`, false otherwise. */
function awaitChange(ms: number): { fired: Promise<boolean>; onChange: () => void } {
  let resolve!: (v: boolean) => void;
  const fired = new Promise<boolean>((r) => {
    resolve = r;
  });
  const timer = setTimeout(() => resolve(false), ms);
  return {
    fired,
    onChange: () => {
      clearTimeout(timer);
      resolve(true);
    },
  };
}

describe('createWorkingCopyWatcher', () => {
  it('fires (debounced) when a source file changes', async () => {
    const { fired, onChange } = awaitChange(3000);
    watcher = createWorkingCopyWatcher(ROOT, onChange, { debounceMs: 50 });
    // chokidar needs a beat to finish its initial scan before add events
    // reliably fire; ignoreInitial means the scan itself is silent.
    await new Promise((r) => setTimeout(r, 300));
    await writeFile(join(ROOT, 'src', 'feature.ts'), 'export const x = 1;\n', 'utf8');
    expect(await fired).toBe(true);
  });

  it('stays silent for writes under ignored dirs', async () => {
    const { fired, onChange } = awaitChange(800);
    watcher = createWorkingCopyWatcher(ROOT, onChange, { debounceMs: 50 });
    await new Promise((r) => setTimeout(r, 300));
    await writeFile(join(ROOT, 'node_modules', 'pkg', 'index.js'), '1', 'utf8');
    await writeFile(join(ROOT, '.git', 'COMMIT_EDITMSG'), 'x', 'utf8');
    await writeFile(join(ROOT, '.pinagent', 'db.sqlite'), 'x', 'utf8');
    expect(await fired).toBe(false);
  });
});
