// SPDX-License-Identifier: Apache-2.0
/**
 * `parseGitHubRemote` URL parsing + `resolveOriginRemote` against a real
 * throwaway git repo. The composer relies on this to decide between the
 * GitHub API path and the manual "push only" fallback, so the
 * GitHub-vs-not boundary is the load-bearing assertion.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseGitHubRemote, resolveOriginRemote } from '../src/git-remote';

describe('parseGitHubRemote', () => {
  it('parses SSH remotes with and without the .git suffix', () => {
    expect(parseGitHubRemote('git@github.com:acme/widgets.git')).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
    });
    expect(parseGitHubRemote('git@github.com:acme/widgets')).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('parses HTTPS remotes with .git, without, and with a trailing slash', () => {
    const expected = { host: 'github.com', owner: 'acme', repo: 'widgets' };
    expect(parseGitHubRemote('https://github.com/acme/widgets.git')).toEqual(expected);
    expect(parseGitHubRemote('https://github.com/acme/widgets')).toEqual(expected);
    expect(parseGitHubRemote('https://github.com/acme/widgets/')).toEqual(expected);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(parseGitHubRemote('  git@github.com:acme/widgets.git\n')).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('returns null for non-GitHub hosts and unrecognized shapes', () => {
    expect(parseGitHubRemote('git@gitlab.com:acme/widgets.git')).toBeNull();
    expect(parseGitHubRemote('https://bitbucket.org/acme/widgets')).toBeNull();
    expect(parseGitHubRemote('https://github.enterprise.example/acme/widgets')).toBeNull();
    expect(parseGitHubRemote('not a url')).toBeNull();
    expect(parseGitHubRemote('')).toBeNull();
  });
});

describe('resolveOriginRemote', () => {
  let repo: string;
  let noRemote: string;

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'pa-gitremote-'));
    noRemote = await mkdtemp(join(tmpdir(), 'pa-gitnoremote-'));
    for (const dir of [repo, noRemote]) {
      execFileSync('git', ['init', '-q'], { cwd: dir });
    }
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/widgets.git'], {
      cwd: repo,
    });
  });

  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(noRemote, { recursive: true, force: true });
  });

  it('reads and parses the origin remote of a real repo', async () => {
    expect(await resolveOriginRemote(repo)).toEqual({
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('returns null when there is no origin remote', async () => {
    expect(await resolveOriginRemote(noRemote)).toBeNull();
  });
});
