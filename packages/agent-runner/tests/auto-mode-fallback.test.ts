// SPDX-License-Identifier: Apache-2.0
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_MODE_FALLBACK,
  applyAutoModeFallback,
  createAutoModeFallback,
} from '../src/auto-mode-fallback';

/**
 * When a run asks for the SDK's `auto` mode and auto mode is unavailable,
 * the CLI starts the session in `default` rather than failing (verified
 * against SDK 0.3.294 with a model lacking auto support and with
 * `disableAutoMode`). The fallback switches such a run to `acceptEdits`.
 */

function init(permissionMode: string): SDKMessage {
  return { type: 'system', subtype: 'init', permissionMode } as unknown as SDKMessage;
}

function status(permissionMode?: string): SDKMessage {
  return {
    type: 'system',
    subtype: 'status',
    status: null,
    permissionMode,
  } as unknown as SDKMessage;
}

function setter() {
  return { setPermissionMode: vi.fn(async () => {}) };
}

describe('createAutoModeFallback', () => {
  it('switches a requested-auto run the CLI started in default to acceptEdits', async () => {
    const run = setter();
    const fallback = createAutoModeFallback('auto', run);
    const result = await fallback.check(init('default'));
    expect(run.setPermissionMode).toHaveBeenCalledWith('acceptEdits');
    expect(result?.mode).toBe(AUTO_MODE_FALLBACK);
    expect(result?.note).toMatch(/Auto mode isn't available/);
  });

  it('leaves a run alone when the CLI honoured auto', async () => {
    const run = setter();
    const fallback = createAutoModeFallback('auto', run);
    expect(await fallback.check(init('auto'))).toBeNull();
    expect(await fallback.check(status())).toBeNull();
    expect(run.setPermissionMode).not.toHaveBeenCalled();
  });

  it('catches auto mode withdrawn mid-run via a status message', async () => {
    const run = setter();
    const fallback = createAutoModeFallback('auto', run);
    expect(await fallback.check(init('auto'))).toBeNull();
    expect((await fallback.check(status('default')))?.mode).toBe('acceptEdits');
  });

  it('fires at most once per run', async () => {
    const run = setter();
    const fallback = createAutoModeFallback('auto', run);
    await fallback.check(init('default'));
    expect(await fallback.check(status('default'))).toBeNull();
    expect(run.setPermissionMode).toHaveBeenCalledTimes(1);
  });

  it('ignores modes other than default (plan entered mid-run, the fallback echo)', async () => {
    const run = setter();
    const fallback = createAutoModeFallback('auto', run);
    expect(await fallback.check(status('plan'))).toBeNull();
    expect(await fallback.check(status('acceptEdits'))).toBeNull();
    expect(run.setPermissionMode).not.toHaveBeenCalled();
  });

  it.each([
    'acceptEdits',
    'default',
    'plan',
    'bypassPermissions',
  ])('is a no-op for a run that asked for %s', async (mode) => {
    const run = setter();
    const fallback = createAutoModeFallback(mode, run);
    expect(await fallback.check(init('default'))).toBeNull();
    expect(run.setPermissionMode).not.toHaveBeenCalled();
  });
});

describe('applyAutoModeFallback', () => {
  it('reports the run stays in default when the switch fails', async () => {
    const run = {
      setPermissionMode: vi.fn(async () => {
        throw new Error('control channel closed');
      }),
    };
    const result = await applyAutoModeFallback(run);
    expect(result.mode).toBe('default');
    expect(result.note).toMatch(/failed \(control channel closed\)/);
  });

  it('survives a query object without setPermissionMode (mocked SDKs)', async () => {
    const result = await applyAutoModeFallback({} as never);
    expect(result.mode).toBe('default');
  });
});
