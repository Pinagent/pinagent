// SPDX-License-Identifier: Apache-2.0
/**
 * Saved-filter presets for the Conversations list. Persists the
 * `{ statusFilter, query, showArchived }` combination to localStorage
 * under a user-supplied name; the Conversations route surfaces them
 * via a dropdown so a "ready to land, mine" view (or whatever combo
 * the user lives in) doesn't have to be rebuilt every dock open.
 *
 * Built-in presets are code constants. User-saved presets append to
 * the list and persist across sessions. v1 stays in localStorage —
 * the dock can sync presets to the project's server-side settings
 * later if cross-device persistence becomes a real need.
 */
import type { StatusKey } from '@pinagent/ui/tokens';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'pinagent.dock.savedFilters.v1';

export type ConversationStatusFilter = StatusKey | 'all';

export interface ConversationFilterState {
  /** Status filter chip ('all' or a specific StatusKey). */
  statusFilter: ConversationStatusFilter;
  /** Free-text search query. */
  query: string;
  /** Whether archived rows are included. */
  showArchived: boolean;
}

export interface FilterPreset extends ConversationFilterState {
  id: string;
  name: string;
  builtin: boolean;
}

export const BUILTIN_PRESETS: readonly FilterPreset[] = [
  {
    id: 'builtin:all',
    name: 'All active',
    builtin: true,
    statusFilter: 'all',
    query: '',
    showArchived: false,
  },
  {
    id: 'builtin:ready',
    name: 'Ready to land',
    builtin: true,
    statusFilter: 'readyToLand',
    query: '',
    showArchived: false,
  },
  {
    id: 'builtin:awaiting',
    name: 'Awaiting reply',
    builtin: true,
    statusFilter: 'awaitingClarification',
    query: '',
    showArchived: false,
  },
  {
    id: 'builtin:archived',
    name: 'Archived',
    builtin: true,
    statusFilter: 'all',
    query: '',
    showArchived: true,
  },
];

const DEFAULT_STATE: ConversationFilterState = {
  statusFilter: 'all',
  query: '',
  showArchived: false,
};

export interface SavedFiltersApi {
  /** Built-in + user-saved presets, in display order. */
  presets: readonly FilterPreset[];
  /** Save the current filter state as a new user preset. */
  savePreset: (name: string, state: ConversationFilterState) => void;
  /** Delete a user preset (no-op on built-ins). */
  deletePreset: (id: string) => void;
}

/**
 * `useSavedFilters` exposes the merged preset list + persistence ops.
 * Read returns the built-in presets first, then user presets in
 * save order. Writes go straight to localStorage and update the
 * in-memory state — no debounce, the operations are infrequent.
 */
export function useSavedFilters(): SavedFiltersApi {
  const [userPresets, setUserPresets] = useState<FilterPreset[]>(() => readUserPresets());

  // Sync across browser tabs — useful when the same project is open in
  // multiple tabs (the dock is per-tab but saved filters are
  // user-scoped). Cheap because the storage event only fires on
  // OTHER tabs that touch the same key.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setUserPresets(readUserPresets());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const savePreset = useCallback((name: string, state: ConversationFilterState) => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const next: FilterPreset = {
      id: `user:${randomId()}`,
      name: trimmed.slice(0, 64),
      builtin: false,
      statusFilter: state.statusFilter,
      query: state.query,
      showArchived: state.showArchived,
    };
    setUserPresets((prev) => {
      const merged = [...prev, next];
      writeUserPresets(merged);
      return merged;
    });
  }, []);

  const deletePreset = useCallback((id: string) => {
    if (id.startsWith('builtin:')) return;
    setUserPresets((prev) => {
      const merged = prev.filter((p) => p.id !== id);
      writeUserPresets(merged);
      return merged;
    });
  }, []);

  return {
    presets: [...BUILTIN_PRESETS, ...userPresets],
    savePreset,
    deletePreset,
  };
}

/**
 * Check whether a filter state matches a preset's full shape. The
 * dropdown uses this to show the active preset as checked and to
 * gate "Save current view…" (it disables when the current state
 * already matches an existing preset).
 */
export function matchesPreset(state: ConversationFilterState, preset: FilterPreset): boolean {
  return (
    preset.statusFilter === state.statusFilter &&
    preset.query === state.query &&
    preset.showArchived === state.showArchived
  );
}

/** True when the current state matches one of the known presets. */
export function isDefaultState(state: ConversationFilterState): boolean {
  return matchesPreset(state, {
    ...BUILTIN_PRESETS[0]!,
    ...DEFAULT_STATE,
    id: 'builtin:all',
    name: 'All active',
    builtin: true,
  });
}

function readUserPresets(): FilterPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop anything that doesn't parse to a sane preset shape — the
    // schema version is part of the key so an old layout would have
    // been on a different key.
    return parsed
      .filter((p): p is FilterPreset => isValidPreset(p))
      .map((p) => ({ ...p, builtin: false }));
  } catch {
    return [];
  }
}

function writeUserPresets(presets: FilterPreset[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Storage full / disabled. The preset just won't persist — accept
    // the loss rather than failing the save.
  }
}

function isValidPreset(p: unknown): p is FilterPreset {
  if (!p || typeof p !== 'object') return false;
  const r = p as Partial<FilterPreset>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.statusFilter === 'string' &&
    typeof r.query === 'string' &&
    typeof r.showArchived === 'boolean'
  );
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
