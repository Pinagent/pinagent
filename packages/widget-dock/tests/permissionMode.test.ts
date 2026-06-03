// SPDX-License-Identifier: Apache-2.0
/**
 * Display labels for the SDK permission modes surfaced in the
 * conversation detail header.
 */
import { describe, expect, it } from 'vitest';
import {
  overrideProjectMode,
  permissionModeDisplay,
  permissionRowBadge,
} from '../src/lib/permissionMode';

describe('permissionModeDisplay', () => {
  it('maps acceptEdits to the Auto-accept chip', () => {
    const out = permissionModeDisplay('acceptEdits');
    expect(out.label).toBe('Auto-accept');
    expect(out.title).toMatch(/without prompting/);
  });

  it('maps default to Approval required', () => {
    const out = permissionModeDisplay('default');
    expect(out.label).toBe('Approval required');
    expect(out.title).toMatch(/prompts before each tool call/);
  });

  it('maps plan to Dry-run', () => {
    const out = permissionModeDisplay('plan');
    expect(out.label).toBe('Dry-run');
    expect(out.title).toMatch(/reasons without running tools/);
  });

  it('maps bypassPermissions to Bypass', () => {
    expect(permissionModeDisplay('bypassPermissions').label).toBe('Bypass');
  });

  it('maps dontAsk and auto to their own chips', () => {
    expect(permissionModeDisplay('dontAsk').label).toBe("Don't ask");
    expect(permissionModeDisplay('auto').label).toBe('Auto');
  });

  it('falls back to the raw mode string for unknown values', () => {
    const out = permissionModeDisplay('something-novel');
    expect(out.label).toBe('something-novel');
    expect(out.title).toMatch(/something-novel/);
  });
});

describe('overrideProjectMode', () => {
  it('maps an SDK override mode back to its picker project mode', () => {
    expect(overrideProjectMode('plan')).toBe('dry-run');
    expect(overrideProjectMode('acceptEdits')).toBe('auto');
    expect(overrideProjectMode('default')).toBe('approve');
  });

  it('returns null for no override or an SDK-only mode', () => {
    expect(overrideProjectMode(null)).toBeNull();
    expect(overrideProjectMode('bypassPermissions')).toBeNull();
  });
});

describe('permissionRowBadge', () => {
  it('marks the selected row "current" when no override is active', () => {
    expect(permissionRowBadge({ rowMode: 'auto', savedMode: 'auto', overrideMode: null })).toBe(
      'current',
    );
    expect(
      permissionRowBadge({ rowMode: 'approve', savedMode: 'auto', overrideMode: null }),
    ).toBeNull();
  });

  it('marks "In force" and "Saved" rows separately under an override', () => {
    expect(
      permissionRowBadge({ rowMode: 'dry-run', savedMode: 'auto', overrideMode: 'dry-run' }),
    ).toBe('In force');
    expect(
      permissionRowBadge({ rowMode: 'auto', savedMode: 'auto', overrideMode: 'dry-run' }),
    ).toBe('Saved');
    expect(
      permissionRowBadge({ rowMode: 'approve', savedMode: 'auto', overrideMode: 'dry-run' }),
    ).toBeNull();
  });

  it('shows a single "In force" when the override equals the saved mode', () => {
    expect(permissionRowBadge({ rowMode: 'auto', savedMode: 'auto', overrideMode: 'auto' })).toBe(
      'In force',
    );
  });
});
