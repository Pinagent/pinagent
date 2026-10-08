// SPDX-License-Identifier: Apache-2.0
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

/**
 * Agent-model resolution (src/agent-model.ts) and its plumbing into the
 * Claude provider's `query()` options. Without an explicit `model` the SDK
 * runs its bundled CLI's default model, which tracks whatever SDK version
 * the consumer's lockfile resolved — so the precedence (env override >
 * project setting > unset) and "omit `model` when unset" both matter.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/claude-agent-sdk')>(
    '@anthropic-ai/claude-agent-sdk',
  );
  return { ...actual, query: vi.fn() };
});

const { query } = await import('@anthropic-ai/claude-agent-sdk');
const { resolveModelOverride, resolveRunModel } = await import('../src/agent-model');
const { ClaudeCodeProvider } = await import('../src/providers/claude-code');
const { SettingsStore } = await import('../src/settings-store');

const MODEL_ENV = 'PINAGENT_AGENT_MODEL';

let root: string;
let savedEnv: string | undefined;

beforeEach(async () => {
  savedEnv = process.env[MODEL_ENV];
  delete process.env[MODEL_ENV];
  root = join(tmpdir(), `pa-model-${nanoid(8)}`);
  await mkdir(root, { recursive: true });
  (query as Mock).mockReset();
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[MODEL_ENV];
  else process.env[MODEL_ENV] = savedEnv;
  await rm(root, { recursive: true, force: true });
});

describe('resolveModelOverride', () => {
  it('returns null when the env var is unset or blank', () => {
    expect(resolveModelOverride({})).toBeNull();
    expect(resolveModelOverride({ [MODEL_ENV]: '' })).toBeNull();
    expect(resolveModelOverride({ [MODEL_ENV]: '   ' })).toBeNull();
  });

  it('returns the trimmed value verbatim when set', () => {
    expect(resolveModelOverride({ [MODEL_ENV]: ' claude-opus-5-5 ' })).toBe('claude-opus-5-5');
    expect(resolveModelOverride({ [MODEL_ENV]: 'opus[1m]' })).toBe('opus[1m]');
  });
});

describe('resolveRunModel', () => {
  it('is undefined with no env override and no saved model', async () => {
    expect(await resolveRunModel(root)).toBeUndefined();
  });

  it('uses the project setting when no env override is present', async () => {
    await new SettingsStore(root).patch({ model: 'sonnet' });
    expect(await resolveRunModel(root)).toBe('sonnet');
  });

  it('lets the env override win over the project setting', async () => {
    await new SettingsStore(root).patch({ model: 'sonnet' });
    process.env[MODEL_ENV] = 'claude-opus-5-5';
    expect(await resolveRunModel(root)).toBe('claude-opus-5-5');
  });
});

describe('SettingsStore model field', () => {
  it('defaults to null, trims on save, and clears back to null', async () => {
    const store = new SettingsStore(root);
    expect((await store.read()).model).toBeNull();
    expect((await store.patch({ model: '  opus  ' })).model).toBe('opus');
    expect((await store.patch({ model: null })).model).toBeNull();
  });

  it('rejects blank or whitespace-containing model ids', async () => {
    const store = new SettingsStore(root);
    await expect(store.patch({ model: '' })).rejects.toThrow();
    await expect(store.patch({ model: 'claude opus' })).rejects.toThrow();
  });
});

describe('ClaudeCodeProvider model plumbing', () => {
  const RESULT = {
    type: 'result',
    subtype: 'success',
    num_turns: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    total_cost_usd: 0,
    duration_ms: 0,
  } as unknown as SDKMessage;

  /** Run one provider turn against a scripted `query()` and return its options. */
  async function capturedOptions(): Promise<Record<string, unknown> | undefined> {
    let options: Record<string, unknown> | undefined;
    (query as Mock).mockImplementation((params: { options?: Record<string, unknown> }) => {
      options = params.options;
      return (async function* () {
        yield RESULT;
      })();
    });
    const provider = new ClaudeCodeProvider();
    for await (const _ of provider.run({
      projectRoot: root,
      feedbackId: nanoid(10),
      cwd: root,
      prompt: 'make it red',
      isInitial: true,
      permissionMode: 'acceptEdits',
      abortSignal: new AbortController().signal,
    })) {
      // drain
    }
    return options;
  }

  it('omits `model` when neither the env nor the project sets one', async () => {
    const options = await capturedOptions();
    expect(options).toBeDefined();
    expect(options).not.toHaveProperty('model');
  });

  it('passes the saved project model to query()', async () => {
    await new SettingsStore(root).patch({ model: 'sonnet' });
    expect((await capturedOptions())?.model).toBe('sonnet');
  });

  it('passes the env override to query() over the saved model', async () => {
    await new SettingsStore(root).patch({ model: 'sonnet' });
    process.env[MODEL_ENV] = 'claude-opus-5-5';
    expect((await capturedOptions())?.model).toBe('claude-opus-5-5');
  });
});
