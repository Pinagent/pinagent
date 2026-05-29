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
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: code ?? -1, stdout, stderr }));
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
    child.on('exit', (code) => {
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
