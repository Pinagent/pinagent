// SPDX-License-Identifier: Apache-2.0
/**
 * `resolveGithubToken` precedence (src/github-auth.ts). One place owns the
 * order so the compose and PR-refresh paths can't drift:
 *   dock-stored secret → GITHUB_TOKEN → PINAGENT_GITHUB_TOKEN → undefined.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveGithubToken } from '../src/github-auth';
import { SecretsStore } from '../src/secrets-store';

let root: string;
let savedGithub: string | undefined;
let savedPinagent: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa-ghauth-'));
  savedGithub = process.env.GITHUB_TOKEN;
  savedPinagent = process.env.PINAGENT_GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.PINAGENT_GITHUB_TOKEN;
});

afterEach(async () => {
  if (savedGithub === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedGithub;
  if (savedPinagent === undefined) delete process.env.PINAGENT_GITHUB_TOKEN;
  else process.env.PINAGENT_GITHUB_TOKEN = savedPinagent;
  await rm(root, { recursive: true, force: true });
});

describe('resolveGithubToken', () => {
  it('returns undefined when nothing is configured', async () => {
    expect(await resolveGithubToken(root)).toBeUndefined();
  });

  it('falls back to PINAGENT_GITHUB_TOKEN when no stored secret or GITHUB_TOKEN', async () => {
    process.env.PINAGENT_GITHUB_TOKEN = 'pinagent-env-token';
    expect(await resolveGithubToken(root)).toBe('pinagent-env-token');
  });

  it('prefers GITHUB_TOKEN over PINAGENT_GITHUB_TOKEN', async () => {
    process.env.GITHUB_TOKEN = 'github-env-token';
    process.env.PINAGENT_GITHUB_TOKEN = 'pinagent-env-token';
    expect(await resolveGithubToken(root)).toBe('github-env-token');
  });

  it('prefers the dock-stored secret over both env vars', async () => {
    await new SecretsStore(root).setGithub('stored-secret-token', 'octocat');
    process.env.GITHUB_TOKEN = 'github-env-token';
    process.env.PINAGENT_GITHUB_TOKEN = 'pinagent-env-token';
    expect(await resolveGithubToken(root)).toBe('stored-secret-token');
  });
});
