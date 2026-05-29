// SPDX-License-Identifier: Apache-2.0
/**
 * Dock open/close + layout-mode state, persisted to localStorage.
 *
 * `mode` is the layout the dock surface uses when open:
 *   - panel:      480px right-anchored sheet (default)
 *   - floating:   600×800 draggable window
 *   - fullscreen: full viewport overlay
 *
 * Mode is sticky per browser (so the user gets the layout they last
 * picked). Open/close is NOT persisted — every session starts closed.
 */
import { useCallback, useEffect, useState } from 'react';

export type DockMode = 'panel' | 'floating' | 'fullscreen';

const STORAGE_KEY = 'pinagent.dock.mode';
const VALID_MODES: readonly DockMode[] = ['panel', 'floating', 'fullscreen'];

function readPersistedMode(): DockMode {
  if (typeof window === 'undefined') return 'panel';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID_MODES as readonly string[]).includes(raw)) {
      return raw as DockMode;
    }
  } catch {
    // localStorage disabled (private mode, quota); fall through.
  }
  return 'panel';
}

export interface DockState {
  open: boolean;
  mode: DockMode;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setMode: (mode: DockMode) => void;
}

export function useDockMode(): DockState {
  const [open, setOpenState] = useState(false);
  const [mode, setModeState] = useState<DockMode>(() => readPersistedMode());

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Quietly ignore; mode is a UX nicety, not load-bearing.
    }
  }, [mode]);

  // Close on Escape — but only in panel mode (floating/fullscreen need
  // an explicit close because they may have dirty composer state).
  //
  // Escape reaches us two ways: the iframe's own keydown listener fires
  // while focus is inside the dock, and the host bridge posts a
  // `close-dock` message when Escape is pressed while focus is on the
  // host page (the iframe never sees those keys). Mirror of the
  // `toggle-dock` bridge — see vite-plugin/index.ts.
  useEffect(() => {
    if (!open || mode !== 'panel') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenState(false);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.source === 'pinagent-host' && data.type === 'close-dock') {
        setOpenState(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
    };
  }, [open, mode]);

  const toggle = useCallback(() => setOpenState((prev) => !prev), []);
  const setOpen = useCallback((next: boolean) => setOpenState(next), []);
  const setMode = useCallback((next: DockMode) => setModeState(next), []);

  return { open, mode, toggle, setOpen, setMode };
}
