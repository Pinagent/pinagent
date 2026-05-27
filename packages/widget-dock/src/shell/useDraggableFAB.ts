// SPDX-License-Identifier: Apache-2.0
/**
 * Drag-and-snap-to-corner behavior for the dock FAB, mirroring how the
 * widget's picker FAB works in `packages/widget/src/widget.ts`. Drag
 * tracking starts on mousedown; movement past `DRAG_THRESHOLD_PX`
 * promotes it to a real drag. On mouseup we snap to whichever viewport
 * corner is closest to the FAB's centre, and persist that choice so
 * the user gets the same corner next session.
 *
 * If the user clicks without crossing the threshold, no drag happens
 * and `onClick` on the button fires normally. A flag suppresses the
 * click that fires after a real drag-release so the FAB doesn't
 * accidentally open the dock.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const DRAG_THRESHOLD_PX = 4;
const FAB_PADDING = 20;
const STORAGE_KEY = 'pinagent.dock.fab-corner';

export type FabCorner = 'tl' | 'tr' | 'bl' | 'br';
const VALID_CORNERS: readonly FabCorner[] = ['tl', 'tr', 'bl', 'br'];

function readPersistedCorner(fallback: FabCorner): FabCorner {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID_CORNERS as readonly string[]).includes(raw)) {
      return raw as FabCorner;
    }
  } catch {
    // localStorage may be disabled; fall through.
  }
  return fallback;
}

function nearestCorner(cx: number, cy: number): FabCorner {
  const top = cy < window.innerHeight / 2;
  const left = cx < window.innerWidth / 2;
  if (top && left) return 'tl';
  if (top) return 'tr';
  if (left) return 'bl';
  return 'br';
}

export interface DraggableFAB {
  corner: FabCorner;
  /** Inline style for the button — top/left/right/bottom toggled per corner; transform set during drag. */
  style: React.CSSProperties;
  /** Attach to the FAB's onMouseDown to start drag tracking. */
  onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Attach to the FAB's onClick — no-op if a drag just ended. */
  guardClick: (handler: () => void) => () => void;
  dragging: boolean;
}

export function useDraggableFAB(initialCorner: FabCorner = 'bl'): DraggableFAB {
  const [corner, setCorner] = useState<FabCorner>(() => readPersistedCorner(initialCorner));
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  // Persist corner on change.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, corner);
    } catch {
      // Same fallback as the reader; corner choice is a nicety, not load-bearing.
    }
  }, [corner]);

  const onMouseDown = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const grabX = startX - rect.left;
    const grabY = startY - rect.top;
    let dragging = false;
    let freeX = 0;
    let freeY = 0;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
      }
      freeX = Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - grabX));
      freeY = Math.max(0, Math.min(window.innerHeight - rect.height, ev.clientY - grabY));
      setDrag({ x: freeX, y: freeY });
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      if (!dragging) return;
      const cx = freeX + rect.width / 2;
      const cy = freeY + rect.height / 2;
      setCorner(nearestCorner(cx, cy));
      setDrag(null);
      suppressClickRef.current = true;
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  }, []);

  const guardClick = useCallback(
    (handler: () => void) => () => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      handler();
    },
    [],
  );

  const style: React.CSSProperties = drag
    ? { top: `${drag.y}px`, left: `${drag.x}px`, right: 'auto', bottom: 'auto' }
    : {
        top: corner === 'tl' || corner === 'tr' ? `${FAB_PADDING}px` : 'auto',
        bottom: corner === 'bl' || corner === 'br' ? `${FAB_PADDING}px` : 'auto',
        left: corner === 'tl' || corner === 'bl' ? `${FAB_PADDING}px` : 'auto',
        right: corner === 'tr' || corner === 'br' ? `${FAB_PADDING}px` : 'auto',
      };

  return { corner, style, onMouseDown, guardClick, dragging: drag !== null };
}
