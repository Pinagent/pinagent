// SPDX-License-Identifier: Apache-2.0
/**
 * Display labels for the SDK permission modes surfaced in the
 * conversation detail header.
 */
import { describe, expect, it } from 'vitest';
import { permissionModeDisplay } from '../src/lib/permissionMode';

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
