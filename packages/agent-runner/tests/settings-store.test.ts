// SPDX-License-Identifier: Apache-2.0
/**
 * `SettingsStore`: defaults on a fresh project, forward-merge of older
 * config files missing newer fields, parse-error recovery, and schema
 * validation on patch. The dock shows these defaults before anything is
 * written to disk, so "first GET returns defaults without writing" is the
 * contract.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsStore } from '../src/settings-store';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa-settings-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const configPath = () => join(root, '.pinagent', 'config.json');

describe('SettingsStore.read', () => {
  it('returns defaults and writes nothing on a fresh project', async () => {
    const settings = await new SettingsStore(root).read();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(existsSync(configPath())).toBe(false);
  });

  it('forward-merges newer default fields onto an older config file', async () => {
    await mkdir(join(root, '.pinagent'), { recursive: true });
    // An older config that predates `permissionMode` / cost caps.
    await writeFile(configPath(), JSON.stringify({ baseBranch: 'develop' }), 'utf8');
    const settings = await new SettingsStore(root).read();
    expect(settings.baseBranch).toBe('develop');
    expect(settings.permissionMode).toBe(DEFAULT_SETTINGS.permissionMode);
    expect(settings.worktreeRetentionDays).toBe(DEFAULT_SETTINGS.worktreeRetentionDays);
  });

  it('falls back to defaults when the file is malformed', async () => {
    await mkdir(join(root, '.pinagent'), { recursive: true });
    await writeFile(configPath(), 'not json at all', 'utf8');
    expect(await new SettingsStore(root).read()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when a stored value violates the schema', async () => {
    await mkdir(join(root, '.pinagent'), { recursive: true });
    // worktreeRetentionDays out of range (max 60) -> parse throws -> defaults.
    await writeFile(configPath(), JSON.stringify({ worktreeRetentionDays: 999 }), 'utf8');
    expect(await new SettingsStore(root).read()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('SettingsStore.patch', () => {
  it('persists a partial patch over current settings and reads it back', async () => {
    const store = new SettingsStore(root);
    const next = await store.patch({ baseBranch: 'release', monthlyBudgetUsd: 100 });
    expect(next.baseBranch).toBe('release');
    expect(next.monthlyBudgetUsd).toBe(100);
    // Unpatched fields keep their defaults.
    expect(next.perConversationCapUsd).toBe(DEFAULT_SETTINGS.perConversationCapUsd);
    // And it round-trips through a fresh read of the written file.
    expect(await new SettingsStore(root).read()).toEqual(next);
    expect(JSON.parse(await readFile(configPath(), 'utf8')).baseBranch).toBe('release');
  });

  it('rejects an invalid branch name at patch time', async () => {
    await expect(
      new SettingsStore(root).patch({ baseBranch: 'bad branch name' }),
    ).rejects.toThrow();
    // The invalid write must not have materialized the file.
    expect(existsSync(configPath())).toBe(false);
  });

  it('rejects an out-of-range cost cap at patch time', async () => {
    await expect(new SettingsStore(root).patch({ perConversationCapUsd: 0 })).rejects.toThrow();
  });

  it('defaults allowedBranchPatterns to [] and round-trips a set policy', async () => {
    expect((await new SettingsStore(root).read()).allowedBranchPatterns).toEqual([]);
    const store = new SettingsStore(root);
    const next = await store.patch({ allowedBranchPatterns: ['feat/*', 'fix/*'] });
    expect(next.allowedBranchPatterns).toEqual(['feat/*', 'fix/*']);
    expect((await new SettingsStore(root).read()).allowedBranchPatterns).toEqual([
      'feat/*',
      'fix/*',
    ]);
  });
});
