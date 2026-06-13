// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizeBackend } from '../src/db/client';
import {
  dismissStorageNote,
  STORAGE_NOTE_DISMISS_KEY,
  shouldShowStorageNote,
} from '../src/storage-degradation';

// Ticket 005: the worker→client init payload carries the storage backend so
// the widget can surface a quiet degradation hint when persistence is off.
// The real OPFS/SAH path can't run in vitest — the protocol contract + the
// dismissible-note state machine are the testable seams.

describe('normalizeBackend (init-ACK protocol contract)', () => {
  it('reports memory when the worker says memory', () => {
    expect(normalizeBackend({ backend: 'memory' })).toBe('memory');
  });

  it('reports opfs when the worker says opfs', () => {
    expect(normalizeBackend({ backend: 'opfs' })).toBe('opfs');
  });

  it('assumes opfs when the field is missing (old worker / new client coexist)', () => {
    // Backward compatibility: a stale plugin dist can briefly serve an older
    // worker whose init ACK omits `backend`. Missing ⇒ persistent, no crash.
    expect(normalizeBackend({ ok: true } as { backend?: unknown })).toBe('opfs');
  });

  it('assumes opfs for null/undefined/unknown values rather than crashing', () => {
    expect(normalizeBackend(null)).toBe('opfs');
    expect(normalizeBackend(undefined)).toBe('opfs');
    expect(normalizeBackend({ backend: 'something-else' })).toBe('opfs');
  });
});

describe('shouldShowStorageNote', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the note only when the backend is memory and it was never dismissed', () => {
    expect(shouldShowStorageNote('memory', localStorage)).toBe(true);
  });

  it('never shows the note on the healthy (opfs) backend', () => {
    expect(shouldShowStorageNote('opfs', localStorage)).toBe(false);
  });

  it('stops showing the note once dismissed (survives reload via localStorage)', () => {
    expect(shouldShowStorageNote('memory', localStorage)).toBe(true);
    dismissStorageNote(localStorage);
    expect(localStorage.getItem(STORAGE_NOTE_DISMISS_KEY)).toBe('1');
    expect(shouldShowStorageNote('memory', localStorage)).toBe(false);
  });

  it('degrades to "not dismissed" if storage reads throw (private window)', () => {
    const throwingStorage = {
      getItem() {
        throw new Error('storage disabled');
      },
    };
    // No crash, and the note is still offered.
    expect(shouldShowStorageNote('memory', throwingStorage)).toBe(true);
  });
});
