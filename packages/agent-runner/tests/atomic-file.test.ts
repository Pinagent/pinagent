// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicWriteFile, withFileLock } from '../src/atomic-file';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa-atomic-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('withFileLock', () => {
  it('serializes critical sections for the same key (no overlap)', async () => {
    let active = 0;
    let maxActive = 0;
    const body = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active--;
    };
    await Promise.all([withFileLock('k', body), withFileLock('k', body), withFileLock('k', body)]);
    expect(maxActive).toBe(1);
  });

  it('does not wedge the queue when a holder throws', async () => {
    await expect(
      withFileLock('k', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(withFileLock('k', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('atomicWriteFile', () => {
  it('writes the file with the requested mode (POSIX)', async () => {
    if (process.platform === 'win32') return;
    const path = join(root, 'nested', 'secret.json');
    await atomicWriteFile(path, '{"k":1}', 0o600);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toBe('{"k":1}');
  });

  it('overwrites in place via rename and leaves no temp files behind', async () => {
    const { readdir } = await import('node:fs/promises');
    const path = join(root, 'data.json');
    await atomicWriteFile(path, 'first');
    await atomicWriteFile(path, 'second');
    expect(await readFile(path, 'utf8')).toBe('second');
    // The temp sibling is renamed (not left), so the dir holds only the target.
    expect((await readdir(root)).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });
});
