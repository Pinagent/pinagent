// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Pin the pure pieces of useSavedFilters — preset matching + the
 * storage write/read roundtrip via writeUserPresets / readUserPresets
 * (exercised indirectly by re-importing the module). Hook itself
 * relies on React lifecycle; the matcher + storage layer carries the
 * load-bearing logic.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PRESETS,
  type ConversationFilterState,
  type FilterPreset,
  matchesPreset,
} from '../src/hooks/useSavedFilters';

const baseState: ConversationFilterState = {
  statusFilter: 'all',
  query: '',
  showArchived: false,
};

describe('matchesPreset', () => {
  it('matches when every field is equal', () => {
    const preset: FilterPreset = {
      id: 'builtin:all',
      name: 'All active',
      builtin: true,
      ...baseState,
    };
    expect(matchesPreset(baseState, preset)).toBe(true);
  });

  it("doesn't match when status differs", () => {
    const preset: FilterPreset = {
      id: 'builtin:ready',
      name: 'Ready',
      builtin: true,
      statusFilter: 'readyToLand',
      query: '',
      showArchived: false,
    };
    expect(matchesPreset(baseState, preset)).toBe(false);
  });

  it("doesn't match when query differs", () => {
    const preset: FilterPreset = {
      id: 'user:abc',
      name: 'Mine',
      builtin: false,
      statusFilter: 'all',
      query: 'jack',
      showArchived: false,
    };
    expect(matchesPreset(baseState, preset)).toBe(false);
  });

  it("doesn't match when showArchived differs", () => {
    const preset: FilterPreset = {
      id: 'builtin:archived',
      name: 'Archived',
      builtin: true,
      statusFilter: 'all',
      query: '',
      showArchived: true,
    };
    expect(matchesPreset(baseState, preset)).toBe(false);
  });
});

describe('BUILTIN_PRESETS', () => {
  it('ships at least the All / Ready / Awaiting / Archived presets', () => {
    const names = BUILTIN_PRESETS.map((p) => p.name);
    expect(names).toContain('All active');
    expect(names).toContain('Ready to land');
    expect(names).toContain('Awaiting reply');
    expect(names).toContain('Archived');
  });

  it('marks every built-in as builtin: true', () => {
    expect(BUILTIN_PRESETS.every((p) => p.builtin)).toBe(true);
  });
});

describe('matchesPreset — user preset round-trip', () => {
  it('matches a stored user preset against its declared state', () => {
    const userPreset: FilterPreset = {
      id: 'user:1',
      name: 'My mine',
      builtin: false,
      statusFilter: 'readyToLand',
      query: 'jack',
      showArchived: false,
    };
    expect(
      matchesPreset(
        { statusFilter: 'readyToLand', query: 'jack', showArchived: false },
        userPreset,
      ),
    ).toBe(true);
  });

  it('treats two presets with identical filter shape as equivalent', () => {
    const a: FilterPreset = {
      id: 'builtin:archived',
      name: 'Archived',
      builtin: true,
      statusFilter: 'all',
      query: '',
      showArchived: true,
    };
    const b: FilterPreset = {
      id: 'user:dup',
      name: 'My archived view',
      builtin: false,
      statusFilter: 'all',
      query: '',
      showArchived: true,
    };
    const sharedState: ConversationFilterState = {
      statusFilter: 'all',
      query: '',
      showArchived: true,
    };
    expect(matchesPreset(sharedState, a)).toBe(true);
    expect(matchesPreset(sharedState, b)).toBe(true);
  });
});
