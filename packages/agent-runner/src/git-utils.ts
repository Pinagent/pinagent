// SPDX-License-Identifier: Apache-2.0
/**
 * Shared `git` runner. Lifted out of agent.ts so other modules
 * (changes.ts, future PR-composer code) can use the same spawn shape
 * without importing the whole agent module + its SDK pulls.
 */
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';

export interface GitCapture {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn `git` with the given args in `cwd`, capturing stdout and stderr.
 * Never rejects on non-zero exit — callers inspect `code` themselves
 * because non-zero exits are meaningful for several git commands
 * (`git merge` returns 1 on conflict, `git rev-parse` returns non-zero
 * for missing refs, etc).
 */
export function runGitCapture(cwd: string, args: string[]): Promise<GitCapture> {
  return runCapture('git', args, cwd);
}

/**
 * Generic command-capture, same drain-safe shape as {@link runGitCapture}
 * (resolves on 'close', never rejects on non-zero exit). Used for `gh` (PR
 * creation fallback) as well as `git`. Rejects only if the binary can't be
 * spawned (e.g. `gh` not installed → ENOENT) — callers catch that to treat
 * the tool as unavailable.
 */
export function runCapture(file: string, args: string[], cwd: string): Promise<GitCapture> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', reject);
    // Resolve on 'close', not 'exit' — 'exit' can fire before stdout/stderr
    // are drained, so a reader there sees truncated output. 'close' fires only
    // after all stdio streams close. (See the rev-list-count behind-base flake.)
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/**
 * Spawn `git` and reject on non-zero exit, appending a diagnostic line to
 * the conversation log. Used for fire-and-forget mutations (`worktree add`)
 * where the caller wants an exception on failure rather than inspecting a
 * code — contrast with `runGitCapture`, which never rejects.
 */
export function runGit(cwd: string, args: string[], logPath: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn('git', args, { cwd, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', rej);
    // 'close' (not 'exit') so the captured stderr is complete before we log it
    // — see runGitCapture for the drain-race rationale.
    child.on('close', (code) => {
      if (code === 0) {
        res();
      } else {
        appendLog(
          logPath,
          `[pinagent:git] git ${args.join(' ')} → exit ${code}\n${stderr}\n`,
        ).catch(() => {});
        rej(new Error(`git ${args.join(' ')} exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Whether `cwd` is inside a git work tree. Use this instead of
 * `existsSync(join(cwd, '.git'))` — the dev server can run from a
 * subdirectory of the repo (e.g. an example app), where there's no `.git`
 * entry, or from a linked worktree, where `.git` is a *file* at the
 * worktree root and absent in subdirs. `git rev-parse` walks up like git
 * itself, so it's correct in all those cases. Never throws.
 */
export async function isInsideWorkTree(cwd: string): Promise<boolean> {
  const res = await runGitCapture(cwd, ['rev-parse', '--is-inside-work-tree']);
  return res.code === 0 && res.stdout.trim() === 'true';
}

/** Whether `cwd`'s working tree has uncommitted changes (`git status --porcelain`). */
export async function isWorkingTreeDirty(cwd: string): Promise<boolean> {
  const res = await runGitCapture(cwd, ['status', '--porcelain']);
  return res.code === 0 && res.stdout.trim().length > 0;
}

/** Append `text` to the file at `path`, creating it if needed. No-op on empty text. */
export async function appendLog(path: string, text: string): Promise<void> {
  if (!text) return;
  const h = await open(path, 'a');
  try {
    await h.write(text);
  } finally {
    await h.close();
  }
}
