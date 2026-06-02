// SPDX-License-Identifier: Apache-2.0
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveAgentMode,
  resolvePermissionMode,
  resolvePermissionModeOverride,
  resolveRunPermissionMode,
  toSdkPermissionMode,
} from '../src/agent-permission';
import { SettingsStore } from '../src/settings-store';

/**
 * Pure env/settings → SDK-mode resolution (src/agent-permission.ts). This
 * gates whether an agent spawns at all and with which permission mode, so
 * the precedence rules (env override > project settings > default) and the
 * fall-through behaviour for unset/invalid values are worth pinning down.
 */

const PERMISSION_ENV = 'PINAGENT_AGENT_PERMISSION_MODE';
const SPAWN_ENV = 'PINAGENT_SPAWN_AGENT';

describe('resolveAgentMode', () => {
  it("maps 'worktree' to worktree", () => {
    expect(resolveAgentMode({ [SPAWN_ENV]: 'worktree' })).toBe('worktree');
  });

  it("maps 'off' and 'false' to false (spawning disabled)", () => {
    expect(resolveAgentMode({ [SPAWN_ENV]: 'off' })).toBe(false);
    expect(resolveAgentMode({ [SPAWN_ENV]: 'false' })).toBe(false);
  });

  it("defaults to 'inline' when unset, explicit, or unrecognised", () => {
    expect(resolveAgentMode({})).toBe('inline');
    expect(resolveAgentMode({ [SPAWN_ENV]: 'inline' })).toBe('inline');
    expect(resolveAgentMode({ [SPAWN_ENV]: 'banana' })).toBe('inline');
  });
});

describe('resolvePermissionMode', () => {
  it('passes through every recognised SDK mode', () => {
    for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto']) {
      expect(resolvePermissionMode({ [PERMISSION_ENV]: mode })).toBe(mode);
    }
  });

  it("falls back to 'acceptEdits' when unset or invalid", () => {
    expect(resolvePermissionMode({})).toBe('acceptEdits');
    expect(resolvePermissionMode({ [PERMISSION_ENV]: 'nonsense' })).toBe('acceptEdits');
  });
});

describe('resolvePermissionModeOverride', () => {
  it('returns null when the env var is unset', () => {
    expect(resolvePermissionModeOverride({})).toBeNull();
  });

  it('returns the resolved mode when the env var is set', () => {
    expect(resolvePermissionModeOverride({ [PERMISSION_ENV]: 'plan' })).toBe('plan');
  });

  it('returns the fallback mode (not null) for an invalid but present override', () => {
    // Distinct from resolvePermissionMode: presence — not validity — is what
    // makes this non-null, so the dock can show "an override is active".
    expect(resolvePermissionModeOverride({ [PERMISSION_ENV]: 'nonsense' })).toBe('acceptEdits');
  });
});

describe('toSdkPermissionMode', () => {
  it('maps each project mode to its SDK mode', () => {
    expect(toSdkPermissionMode('auto')).toBe('acceptEdits');
    expect(toSdkPermissionMode('approve')).toBe('default');
    expect(toSdkPermissionMode('dry-run')).toBe('plan');
  });
});

describe('resolveRunPermissionMode', () => {
  let root: string;
  let savedEnv: string | undefined;

  beforeEach(async () => {
    savedEnv = process.env[PERMISSION_ENV];
    delete process.env[PERMISSION_ENV];
    root = join(tmpdir(), `pa-perm-${nanoid(8)}`);
    await mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env[PERMISSION_ENV];
    else process.env[PERMISSION_ENV] = savedEnv;
    await rm(root, { recursive: true, force: true });
  });

  it('uses the project setting when no env override is present', async () => {
    await new SettingsStore(root).patch({ permissionMode: 'approve' });
    expect(await resolveRunPermissionMode(root)).toBe('default');
  });

  it("defaults to the 'auto' project setting → acceptEdits with no config file", async () => {
    expect(await resolveRunPermissionMode(root)).toBe('acceptEdits');
  });

  it('lets the env override win over the project setting', async () => {
    await new SettingsStore(root).patch({ permissionMode: 'approve' });
    process.env[PERMISSION_ENV] = 'plan';
    expect(await resolveRunPermissionMode(root)).toBe('plan');
  });
});
