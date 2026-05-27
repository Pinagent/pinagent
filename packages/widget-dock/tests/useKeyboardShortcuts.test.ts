// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Pin the pure matching logic in `matchKeyboardShortcut`. The hook
 * itself is a thin lifecycle wrapper around this function — covered
 * indirectly via the matches here.
 */
import { describe, expect, it } from 'vitest';
import { matchKeyboardShortcut } from '../src/shell/shortcut-match';

function makeEvent(overrides: Partial<Parameters<typeof matchKeyboardShortcut>[0]> = {}) {
  return {
    key: 'a',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    ...overrides,
  };
}

function makeInput() {
  const el = document.createElement('input');
  el.type = 'text';
  return el;
}

describe('matchKeyboardShortcut', () => {
  describe('Cmd/Ctrl + Shift + P', () => {
    it('toggles on Meta+Shift+P', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'p', metaKey: true, shiftKey: true }), {
        pendingG: false,
        isOpen: false,
      });
      expect(action).toEqual({ type: 'toggle' });
    });

    it('toggles on Ctrl+Shift+P', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'P', ctrlKey: true, shiftKey: true }), {
        pendingG: false,
        isOpen: false,
      });
      expect(action).toEqual({ type: 'toggle' });
    });

    it('toggles even when typing in a text field', () => {
      const action = matchKeyboardShortcut(
        makeEvent({ key: 'P', metaKey: true, shiftKey: true, target: makeInput() }),
        { pendingG: false, isOpen: true },
      );
      expect(action).toEqual({ type: 'toggle' });
    });

    it('does not toggle without Shift', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'p', metaKey: true }), {
        pendingG: false,
        isOpen: false,
      });
      expect(action).toEqual({ type: 'none' });
    });
  });

  describe('g chord', () => {
    it('starts the chord on g', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'g' }), {
        pendingG: false,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'start-g-chord' });
    });

    it('navigates to conversations on g c', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'c' }), {
        pendingG: true,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'navigate', to: '/conversations' });
    });

    it('navigates to history on g h', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'h' }), {
        pendingG: true,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'navigate', to: '/history' });
    });

    it('navigates to settings on g s', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 's' }), {
        pendingG: true,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'navigate', to: '/settings' });
    });

    it('cancels on an unrelated key inside the chord window', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'x' }), {
        pendingG: true,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'cancel-g-chord' });
    });

    it('cancels on a second g', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'g' }), {
        pendingG: true,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'cancel-g-chord' });
    });

    it('does not start the chord while typing', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'g', target: makeInput() }), {
        pendingG: false,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'none' });
    });

    it('ignores the chord while typing even mid-sequence', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'c', target: makeInput() }), {
        pendingG: true,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'none' });
    });
  });

  describe('/ focus search', () => {
    it('returns focus-search when open', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: '/' }), {
        pendingG: false,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'focus-search' });
    });

    it('does nothing when the dock is closed', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: '/' }), {
        pendingG: false,
        isOpen: false,
      });
      expect(action).toEqual({ type: 'none' });
    });

    it('does nothing while typing', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: '/', target: makeInput() }), {
        pendingG: false,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'none' });
    });
  });

  describe('passthrough', () => {
    it('returns none for plain alpha keys', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'a' }), {
        pendingG: false,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'none' });
    });

    it('returns none for browser shortcuts (Cmd+R, etc.)', () => {
      const action = matchKeyboardShortcut(makeEvent({ key: 'r', metaKey: true }), {
        pendingG: false,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'none' });
    });
  });

  describe('typing detection', () => {
    it('treats contenteditable as typing', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      const action = matchKeyboardShortcut(makeEvent({ key: 'g', target: div }), {
        pendingG: false,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'none' });
    });

    it('treats <textarea> as typing', () => {
      const ta = document.createElement('textarea');
      const action = matchKeyboardShortcut(makeEvent({ key: 'g', target: ta }), {
        pendingG: false,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'none' });
    });

    it('treats <select> as typing (arrow keys, etc.)', () => {
      const sel = document.createElement('select');
      const action = matchKeyboardShortcut(makeEvent({ key: 'g', target: sel }), {
        pendingG: false,
        isOpen: true,
      });
      expect(action).toEqual({ type: 'none' });
    });
  });
});
