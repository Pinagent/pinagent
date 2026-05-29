// SPDX-License-Identifier: Apache-2.0
/**
 * `SecretsStore` round-trips, malformed-file recovery, the token-free
 * `presentable()` view, and 0600 perms. Tokens are stored in plaintext by
 * design (see the module header), so the contract under test is "never
 * crash the server, never leak the token through `presentable`".
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecretsStore } from '../src/secrets-store';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa-secrets-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const secretsPath = () => join(root, '.pinagent', 'secrets.json');

describe('SecretsStore.read', () => {
  it('returns an empty object when no file exists yet', async () => {
    expect(await new SecretsStore(root).read()).toEqual({});
  });

  it('treats a malformed secrets file as empty instead of throwing', async () => {
    await mkdir(join(root, '.pinagent'), { recursive: true });
    await writeFile(secretsPath(), '{ not valid json', 'utf8');
    expect(await new SecretsStore(root).read()).toEqual({});
  });

  it('treats a schema-invalid file (empty token) as empty', async () => {
    await mkdir(join(root, '.pinagent'), { recursive: true });
    await writeFile(secretsPath(), JSON.stringify({ github: { token: '', login: 'a' } }), 'utf8');
    expect(await new SecretsStore(root).read()).toEqual({});
  });
});

describe('SecretsStore write + getters', () => {
  it('persists a GitHub token and reads it back', async () => {
    const store = new SecretsStore(root);
    await store.setGithub('ghp_secret', 'octocat');
    expect(await store.getGithubToken()).toBe('ghp_secret');
    expect((await store.read()).github).toEqual({ token: 'ghp_secret', login: 'octocat' });
  });

  it('persists an Anthropic key independently of GitHub', async () => {
    const store = new SecretsStore(root);
    await store.setGithub('ghp_secret', 'octocat');
    await store.setAnthropic('sk-ant-123');
    expect(await store.getAnthropicKey()).toBe('sk-ant-123');
    // setAnthropic must not clobber the previously-stored github entry.
    expect(await store.getGithubToken()).toBe('ghp_secret');
  });

  it('clears each credential to null without touching the other', async () => {
    const store = new SecretsStore(root);
    await store.setGithub('ghp_secret', 'octocat');
    await store.setAnthropic('sk-ant-123');
    await store.clearGithub();
    expect(await store.getGithubToken()).toBeNull();
    expect(await store.getAnthropicKey()).toBe('sk-ant-123');
  });

  it('returns null from getters when nothing is stored', async () => {
    const store = new SecretsStore(root);
    expect(await store.getGithubToken()).toBeNull();
    expect(await store.getAnthropicKey()).toBeNull();
  });
});

describe('SecretsStore.presentable', () => {
  it('reports connection state without exposing the raw token', async () => {
    const store = new SecretsStore(root);
    await store.setGithub('ghp_secret', 'octocat');
    await store.setAnthropic('sk-ant-123');
    const view = await store.presentable();
    expect(view).toEqual({
      github: { connected: true, login: 'octocat' },
      anthropic: { keySet: true },
    });
    // Defensive: the serialized presentable view must never carry the token.
    expect(JSON.stringify(view)).not.toContain('ghp_secret');
    expect(JSON.stringify(view)).not.toContain('sk-ant-123');
  });

  it('reports disconnected state on a fresh project', async () => {
    expect(await new SecretsStore(root).presentable()).toEqual({
      github: { connected: false, login: null },
      anthropic: { keySet: false },
    });
  });
});

describe('SecretsStore file permissions', () => {
  it('writes the secrets file 0600 (owner-only) on POSIX', async () => {
    if (process.platform === 'win32') return;
    await new SecretsStore(root).setGithub('ghp_secret', 'octocat');
    const mode = (await stat(secretsPath())).mode & 0o777;
    expect(mode).toBe(0o600);
    // Sanity: the file really does contain the token on disk (plaintext
    // at rest is the documented tradeoff).
    expect(await readFile(secretsPath(), 'utf8')).toContain('ghp_secret');
  });
});
