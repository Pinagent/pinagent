// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the restore-filter (ticket 001). The RN widget itself isn't
 * unit-testable here (RN not installed), so we test the pure list→pills filter
 * that decides which conversations come back after an app reload.
 */
import { describe, expect, it } from 'vitest';
import { RESTORE_LIMIT, type RestoreCandidate, restorePills } from '../src/native/restore';

function item(overrides: Partial<RestoreCandidate> = {}): RestoreCandidate {
  return {
    id: 'abc1234567',
    status: 'pending',
    url: 'Home',
    file: 'src/HomeScreen.tsx',
    line: 42,
    selector: 'App > HomeScreen > PrimaryButton',
    updatedAt: '2026-06-12T10:00:00.000Z',
    ...overrides,
  };
}

describe('restorePills', () => {
  it('keeps pending items on the matching surface and builds a file:line target', () => {
    const pills = restorePills([item()], 'Home');
    expect(pills).toEqual([{ id: 'abc1234567', target: 'src/HomeScreen.tsx:42' }]);
  });

  it('drops resolved/dismissed (non-pending) conversations', () => {
    const pills = restorePills(
      [
        item({ id: 'p1' }),
        item({ id: 'fixed1', status: 'fixed' }),
        item({ id: 'wf1', status: 'wontfix' }),
        item({ id: 'def1', status: 'deferred' }),
      ],
      'Home',
    );
    expect(pills.map((p) => p.id)).toEqual(['p1']);
  });

  it('drops conversations from a different surface', () => {
    const pills = restorePills(
      [item({ id: 'here', url: 'Home' }), item({ id: 'elsewhere', url: 'Settings' })],
      'Home',
    );
    expect(pills.map((p) => p.id)).toEqual(['here']);
  });

  it('drops items with no id (cannot subscribe)', () => {
    const pills = restorePills([item({ id: undefined }), item({ id: 'ok' })], 'Home');
    expect(pills.map((p) => p.id)).toEqual(['ok']);
  });

  it('sorts newest-first by updatedAt', () => {
    const pills = restorePills(
      [
        item({ id: 'old', updatedAt: '2026-06-12T08:00:00.000Z' }),
        item({ id: 'new', updatedAt: '2026-06-12T12:00:00.000Z' }),
        item({ id: 'mid', updatedAt: '2026-06-12T10:00:00.000Z' }),
      ],
      'Home',
    );
    expect(pills.map((p) => p.id)).toEqual(['new', 'mid', 'old']);
  });

  it('caps at RESTORE_LIMIT (most recent)', () => {
    const many = Array.from({ length: RESTORE_LIMIT + 3 }, (_, i) =>
      item({ id: `c${i}`, updatedAt: `2026-06-12T${String(i).padStart(2, '0')}:00:00.000Z` }),
    );
    const pills = restorePills(many, 'Home');
    expect(pills).toHaveLength(RESTORE_LIMIT);
    // Highest hour (most recent) first.
    expect(pills[0]?.id).toBe(`c${RESTORE_LIMIT + 2}`);
  });

  it('honors a custom limit', () => {
    const pills = restorePills([item({ id: 'a' }), item({ id: 'b' })], 'Home', 1);
    expect(pills).toHaveLength(1);
  });

  it('falls back to the selector tail when there is no file:line', () => {
    const pills = restorePills(
      [item({ file: null, line: null, selector: 'App > HomeScreen > PrimaryButton' })],
      'Home',
    );
    expect(pills[0]?.target).toBe('PrimaryButton');
  });

  it('falls back to "component" when neither loc nor selector is usable', () => {
    const pills = restorePills([item({ file: null, line: null, selector: '' })], 'Home');
    expect(pills[0]?.target).toBe('component');
  });

  it('returns [] for null/undefined/non-array input', () => {
    expect(restorePills(null, 'Home')).toEqual([]);
    expect(restorePills(undefined, 'Home')).toEqual([]);
    // @ts-expect-error — exercising the runtime guard against a non-array
    expect(restorePills({}, 'Home')).toEqual([]);
  });
});
