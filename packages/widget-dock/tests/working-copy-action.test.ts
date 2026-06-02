// SPDX-License-Identifier: Apache-2.0
/**
 * Table-tests the dashboard's primary-action state machine across every
 * working-copy shape: on-base-branch, no-PR, PR-open-ahead, PR-open-synced,
 * and merged.
 */
import type { WorkingCopyStatus } from '@pinagent/shared';
import { describe, expect, it } from 'vitest';
import { deriveWorkingCopyAction } from '../src/shell/working-copy-action';

function status(overrides: Partial<WorkingCopyStatus> = {}): WorkingCopyStatus {
  return {
    branch: 'feat/x',
    baseBranch: 'main',
    isDefaultBranch: false,
    filesChanged: 3,
    additions: 10,
    deletions: 2,
    files: [],
    ahead: 0,
    behind: 0,
    hasUpstream: false,
    dirty: true,
    pr: null,
    ...overrides,
  };
}

describe('deriveWorkingCopyAction', () => {
  it('offers Start a branch on the base branch when there are changes', () => {
    const a = deriveWorkingCopyAction(status({ isDefaultBranch: true, filesChanged: 3 }));
    expect(a.kind).toBe('start');
    expect(a.label).toBe('Start a branch');
  });

  it('disables on the base branch with no changes', () => {
    const a = deriveWorkingCopyAction(
      status({ isDefaultBranch: true, filesChanged: 0, dirty: false }),
    );
    expect(a.kind).toBe('disabled');
    expect(a.disabledReason).toContain('main');
  });

  it('offers Create PR with changes and no PR', () => {
    const a = deriveWorkingCopyAction(status());
    expect(a.kind).toBe('create');
    expect(a.label).toBe('Create PR');
  });

  it('disables Create PR when there are no changes', () => {
    const a = deriveWorkingCopyAction(status({ filesChanged: 0, ahead: 0, dirty: false }));
    expect(a.kind).toBe('disabled');
    expect(a.disabledReason).toBe('No changes');
  });

  it('offers Push changes when an open PR is behind local commits', () => {
    const a = deriveWorkingCopyAction(
      status({ pr: { number: 7, url: 'u', state: 'open' }, ahead: 2, hasUpstream: true }),
    );
    expect(a.kind).toBe('push');
    expect(a.label).toBe('Push changes');
  });

  it('offers View PR when an open PR is up to date', () => {
    const a = deriveWorkingCopyAction(
      status({
        pr: { number: 7, url: 'https://gh/pr/7', state: 'open' },
        ahead: 0,
        hasUpstream: true,
      }),
    );
    expect(a.kind).toBe('view');
    expect(a.href).toBe('https://gh/pr/7');
  });

  it('offers View PR (terminal) for a merged PR even with local commits', () => {
    const a = deriveWorkingCopyAction(
      status({ pr: { number: 7, url: 'https://gh/pr/7', state: 'merged' }, ahead: 5 }),
    );
    expect(a.kind).toBe('view');
  });
});
