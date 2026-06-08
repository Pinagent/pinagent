// SPDX-License-Identifier: Apache-2.0
/**
 * The explicit-auth contract (agent-auth.ts).
 *
 * The bug this guards against: a raw `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
 * exported in the dev-server's shell used to flow straight into the agent's env
 * and shadow the user's Claude Code / Codex subscription, so a stale/external
 * key killed runs with `authentication_failed`. Pinagent must use a key ONLY
 * when the developer hands one over explicitly — via the `apiKey` plugin option
 * (bridged as `PINAGENT_AGENT_API_KEY`) or the dock — and otherwise strip the
 * implicit key so the run falls back to the subscription.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCliAuthEnv, buildSdkAuthEnv, EXPLICIT_API_KEY_ENV } from '../src/agent-auth';
import { SecretsStore } from '../src/secrets-store';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa-auth-'));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('buildSdkAuthEnv (Claude provider)', () => {
  it('drops an inherited ANTHROPIC_API_KEY so the run falls back to the subscription', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-stale-from-shell');
    const env = await buildSdkAuthEnv(root);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('uses the plugin-configured key (PINAGENT_AGENT_API_KEY) explicitly', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-stale-from-shell');
    vi.stubEnv(EXPLICIT_API_KEY_ENV, 'sk-ant-from-config');
    const env = await buildSdkAuthEnv(root);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-from-config');
  });

  it('lets a dock-saved key override the plugin-configured key', async () => {
    vi.stubEnv(EXPLICIT_API_KEY_ENV, 'sk-ant-from-config');
    await new SecretsStore(root).setAnthropic('sk-ant-from-dock');
    const env = await buildSdkAuthEnv(root);
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-from-dock');
  });

  it('never leaks the internal bridge var into the SDK env', async () => {
    vi.stubEnv(EXPLICIT_API_KEY_ENV, 'sk-ant-from-config');
    const env = await buildSdkAuthEnv(root);
    expect(env[EXPLICIT_API_KEY_ENV]).toBeUndefined();
  });

  it('preserves the rest of the inherited environment and applies extras last', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-stale-from-shell');
    vi.stubEnv('PINAGENT_UNRELATED_MARKER', 'kept');
    const env = await buildSdkAuthEnv(root, {
      PINAGENT_PROJECT_ROOT: root,
      CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '720000',
    });
    expect(env.PINAGENT_UNRELATED_MARKER).toBe('kept');
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.PINAGENT_PROJECT_ROOT).toBe(root);
    expect(env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT).toBe('720000');
  });
});

describe('buildCliAuthEnv (Codex / bring-your-own CLI)', () => {
  it('strips inherited provider keys so the CLI falls back to its own login', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-stale');
    vi.stubEnv('OPENAI_API_KEY', 'sk-oai-stale');
    const env = buildCliAuthEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('re-supplies the plugin-configured key under both provider names', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-oai-stale');
    vi.stubEnv(EXPLICIT_API_KEY_ENV, 'sk-explicit');
    const env = buildCliAuthEnv();
    expect(env.ANTHROPIC_API_KEY).toBe('sk-explicit');
    expect(env.OPENAI_API_KEY).toBe('sk-explicit');
  });

  it('does not reinterpret the dock (Anthropic) key as a generic CLI credential', async () => {
    await new SecretsStore(root).setAnthropic('sk-ant-from-dock');
    // buildCliAuthEnv is dock-agnostic — only the explicit config key feeds a CLI.
    const env = buildCliAuthEnv();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it('never leaks the internal bridge var, and applies extras last', () => {
    vi.stubEnv(EXPLICIT_API_KEY_ENV, 'sk-explicit');
    const env = buildCliAuthEnv({ PINAGENT_PROJECT_ROOT: root });
    expect(env[EXPLICIT_API_KEY_ENV]).toBeUndefined();
    expect(env.PINAGENT_PROJECT_ROOT).toBe(root);
  });
});
