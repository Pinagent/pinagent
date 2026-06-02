// SPDX-License-Identifier: Apache-2.0
/**
 * `runGitCapture` / `runGit` / `appendLog` against a real throwaway git
 * repo. The load-bearing behavior these tests pin down:
 *
 *   - `runGitCapture` captures the WHOLE of stdout, even when git emits it
 *     across many chunks. This is the PR #285 regression: resolving on
 *     'exit' instead of 'close' truncated the final chunk under load, and
 *     for `rev-list --count` an empty stdout reads as `Number('') === 0`,
 *     masking a behind-base worktree as clean. The large-output test below
 *     forces the multi-chunk drain path that exposed it.
 *   - `runGitCapture` never rejects on non-zero exit — callers inspect
 *     `code` (git merge → 1 on conflict, rev-parse → non-zero for a missing
 *     ref, etc).
 *   - `runGit` rejects on non-zero exit with stderr in the message and logs
 *     a diagnostic line; resolves on success.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendLog, runGit, runGitCapture } from '../src/git-utils';

let repo: string;

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), 'pa-gitutils-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await writeFile(join(repo, 'README.md'), '# test\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('runGitCapture', () => {
  it('captures stdout and a zero exit code for a successful command', async () => {
    const { code, stdout, stderr } = await runGitCapture(repo, [
      'rev-parse',
      '--abbrev-ref',
      'HEAD',
    ]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('main');
    expect(stderr).toBe('');
  });

  it('captures large multi-chunk stdout in full (PR #285 truncation regression)', async () => {
    // A blob far larger than a single pipe chunk (~64KB), so git streams it
    // back over many 'data' events. `git show` of this blob must round-trip
    // byte-for-byte; a resolve-on-'exit' implementation drops the tail.
    const big = `${'line of content to pad out the blob\n'.repeat(40_000)}`;
    await writeFile(join(repo, 'big.txt'), big);
    execFileSync('git', ['add', 'big.txt'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'add big'], { cwd: repo });

    const { code, stdout } = await runGitCapture(repo, ['show', 'HEAD:big.txt']);
    expect(code).toBe(0);
    expect(stdout.length).toBe(big.length);
    expect(stdout).toBe(big);
  });

  it('returns the right count for rev-list --count (the bug scenario)', async () => {
    // Two commits on main so far (init + big). An empty/truncated stdout here
    // would read as 0 and mask a behind-base worktree as clean.
    const { code, stdout } = await runGitCapture(repo, ['rev-list', '--count', 'HEAD']);
    expect(code).toBe(0);
    expect(Number(stdout.trim())).toBe(2);
  });

  it('resolves (does not reject) with a non-zero code and stderr for a bad command', async () => {
    const { code, stderr } = await runGitCapture(repo, ['rev-parse', 'no-such-ref']);
    expect(code).not.toBe(0);
    expect(stderr).not.toBe('');
  });
});

describe('runGit', () => {
  it('resolves on a successful command', async () => {
    const log = join(repo, 'ok.log');
    await expect(runGit(repo, ['rev-parse', 'HEAD'], log)).resolves.toBeUndefined();
    // Success path writes nothing to the log.
    expect(existsSync(log)).toBe(false);
  });

  it('rejects on non-zero exit, surfacing stderr, and appends a diagnostic to the log', async () => {
    const log = join(repo, 'fail.log');
    await expect(runGit(repo, ['checkout', 'definitely-missing-branch'], log)).rejects.toThrow(
      /exited [1-9]/,
    );
    const logged = await readFile(log, 'utf8');
    expect(logged).toContain('git checkout definitely-missing-branch');
  });
});

describe('appendLog', () => {
  it('creates the file and appends successive writes', async () => {
    const log = join(repo, 'append.log');
    await appendLog(log, 'first\n');
    await appendLog(log, 'second\n');
    expect(await readFile(log, 'utf8')).toBe('first\nsecond\n');
  });

  it('is a no-op on empty text (no file created)', async () => {
    const log = join(repo, 'empty.log');
    await appendLog(log, '');
    expect(existsSync(log)).toBe(false);
  });
});
