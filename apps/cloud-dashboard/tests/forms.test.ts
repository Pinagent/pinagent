// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { parseBranchRoutingForm, parseCostControlForm, patternsToText } from '../src/forms';

describe('parseCostControlForm', () => {
  it('treats a blank cap as "no cap" (null)', () => {
    const r = parseCostControlForm({ cap: '   ', enforcement: 'warn' });
    expect(r).toEqual({
      ok: true,
      value: { maxRelaySessionsPerPeriod: null, enforcement: 'warn' },
    });
  });

  it('accepts a non-negative integer cap', () => {
    const r = parseCostControlForm({ cap: '5000', enforcement: 'block' });
    expect(r).toEqual({
      ok: true,
      value: { maxRelaySessionsPerPeriod: 5000, enforcement: 'block' },
    });
  });

  it('accepts a zero cap', () => {
    const r = parseCostControlForm({ cap: '0', enforcement: 'block' });
    expect(r.ok && r.value.maxRelaySessionsPerPeriod).toBe(0);
  });

  it('rejects a negative or fractional cap', () => {
    expect(parseCostControlForm({ cap: '-1', enforcement: 'block' }).ok).toBe(false);
    expect(parseCostControlForm({ cap: '1.5', enforcement: 'block' }).ok).toBe(false);
    expect(parseCostControlForm({ cap: 'abc', enforcement: 'block' }).ok).toBe(false);
  });

  it('rejects an unknown enforcement value', () => {
    const r = parseCostControlForm({ cap: '10', enforcement: 'nuke' });
    expect(r.ok).toBe(false);
  });
});

describe('parseBranchRoutingForm', () => {
  it('splits patterns on newlines and commas, trimming + dropping blanks', () => {
    const r = parseBranchRoutingForm({
      defaultBaseBranch: 'main',
      allowedBranchPatterns: 'feat/*\n  fix/*  ,\n\nchore/*',
    });
    expect(r).toEqual({
      ok: true,
      value: { defaultBaseBranch: 'main', allowedBranchPatterns: ['feat/*', 'fix/*', 'chore/*'] },
    });
  });

  it('maps a blank base branch to null and blank patterns to []', () => {
    const r = parseBranchRoutingForm({ defaultBaseBranch: '  ', allowedBranchPatterns: '   ' });
    expect(r).toEqual({
      ok: true,
      value: { defaultBaseBranch: null, allowedBranchPatterns: [] },
    });
  });
});

describe('patternsToText', () => {
  it('round-trips with parseBranchRoutingForm', () => {
    const text = patternsToText(['feat/*', 'fix/*']);
    expect(text).toBe('feat/*\nfix/*');
    const r = parseBranchRoutingForm({ defaultBaseBranch: 'main', allowedBranchPatterns: text });
    expect(r.ok && r.value.allowedBranchPatterns).toEqual(['feat/*', 'fix/*']);
  });
});
