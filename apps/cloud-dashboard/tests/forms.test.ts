// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import {
  parseBranchRoutingForm,
  parseCostControlForm,
  parseSubscriptionForm,
  patternsToText,
} from '../src/forms';

describe('parseSubscriptionForm', () => {
  it('accepts a known plan and a non-empty period start', () => {
    const r = parseSubscriptionForm({ planId: 'pro', currentPeriodStart: '2026-05-01T00:00:00Z' });
    expect(r).toEqual({
      ok: true,
      value: { planId: 'pro', currentPeriodStart: '2026-05-01T00:00:00Z' },
    });
  });

  it('trims both fields', () => {
    const r = parseSubscriptionForm({ planId: '  free  ', currentPeriodStart: '  2026-01-01  ' });
    expect(r).toEqual({ ok: true, value: { planId: 'free', currentPeriodStart: '2026-01-01' } });
  });

  it('rejects an unknown or blank plan', () => {
    expect(parseSubscriptionForm({ planId: 'platinum', currentPeriodStart: 'x' }).ok).toBe(false);
    expect(parseSubscriptionForm({ planId: '', currentPeriodStart: 'x' }).ok).toBe(false);
  });

  it('rejects a blank period start', () => {
    const r = parseSubscriptionForm({ planId: 'pro', currentPeriodStart: '   ' });
    expect(r.ok).toBe(false);
  });

  it('rejects a privileged (non-self-serviceable) plan like enterprise', () => {
    const r = parseSubscriptionForm({
      planId: 'enterprise',
      currentPeriodStart: '2026-05-01T00:00:00Z',
    });
    expect(r.ok).toBe(false);
  });
});

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
