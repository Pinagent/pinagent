// SPDX-License-Identifier: Apache-2.0
/**
 * `buildSdkAuthEnv` — the explicit-auth contract for Claude Agent SDK runs.
 *
 * The bug this guards against: a raw `ANTHROPIC_API_KEY` exported in the
 * dev-server's shell used to flow straight into the SDK env and shadow the
 * user's Claude Code subscription, so a stale/external key killed runs with
 * `authentication_failed`. The helper must strip that implicit key and only
 * re-supply one the user explicitly configured via the dock.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSdkAuthEnv } from '../src/agent-auth';
import { SecretsStore } from '../src/secrets-store';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa-auth-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('buildSdkAuthEnv', () => {
  it('drops an inherited ANTHROPIC_API_KEY so the run falls back to the subscription', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-stale-from-shell');
    const env = await buildSdkAuthEnv(root);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('uses the dock-configured key explicitly when one is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-stale-from-shell');
    await new SecretsStore(root).setAnthropic('sk-ant-dock-configured');
    const env = await buildSdkAuthEnv(root);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-dock-configured');
  });

  it('supplies the dock key even when the shell exported none', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await new SecretsStore(root).setAnthropic('sk-ant-dock-configured');
    const env = await buildSdkAuthEnv(root);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-dock-configured');
  });

  it('preserves the rest of the inherited environment', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-stale-from-shell');
    vi.stubEnv('PINAGENT_UNRELATED_MARKER', 'kept');
    const env = await buildSdkAuthEnv(root);
    expect(env.PINAGENT_UNRELATED_MARKER).toBe('kept');
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('applies run-scoped extras last', async () => {
    const env = await buildSdkAuthEnv(root, {
      PINAGENT_PROJECT_ROOT: root,
      CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '720000',
    });
    expect(env.PINAGENT_PROJECT_ROOT).toBe(root);
    expect(env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT).toBe('720000');
  });
});
