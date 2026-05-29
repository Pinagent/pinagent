// SPDX-License-Identifier: Apache-2.0
/**
 * Posts the rects of dock-interactive elements to the parent window via
 * postMessage. The vite-plugin / next-plugin host bridge listens and
 * toggles the iframe's pointer-events between auto and none based on
 * the mouse position — so the host page stays interactive everywhere
 * the dock isn't, but the dock panel still receives clicks.
 *
 * Tracks every element tagged with `data-pinagent-rect`: the dock
 * surface section (in any mode) and the modal backdrop when present.
 * Polls with rAF and only posts when the rect set changes —
 * drag and slide-in animations converge in one frame. Off-viewport
 * rects (e.g. the panel translated off-screen while closed) are
 * filtered out so the host doesn't keep `pointer-events: auto` over a
 * phantom area.
 */

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function snapshot(): Rect[] {
  const els = document.querySelectorAll<HTMLElement>('[data-pinagent-rect]');
  const out: Rect[] = [];
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right <= 0 || r.bottom <= 0) continue;
    if (r.left >= window.innerWidth || r.top >= window.innerHeight) continue;
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
}

function rectsEqual(a: Rect[], b: Rect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i] as Rect;
    const rb = b[i] as Rect;
    if (
      ra.left !== rb.left ||
      ra.top !== rb.top ||
      ra.right !== rb.right ||
      ra.bottom !== rb.bottom
    ) {
      return false;
    }
  }
  return true;
}

export function startLayoutBroadcaster(): () => void {
  let last: Rect[] = [];
  let running = true;

  function loop(): void {
    if (!running) return;
    const next = snapshot();
    if (!rectsEqual(next, last)) {
      last = next;
      window.parent.postMessage({ source: 'pinagent-dock', type: 'layout', rects: next }, '*');
    }
    requestAnimationFrame(loop);
  }

  // Forward in-iframe pointer moves to the host. Once the host has set
  // the iframe to `pointer-events: auto`, the host document no longer
  // sees mousemove events that land in the iframe's region — they go to
  // the iframe's document instead. Without this forward, the host can't
  // ever toggle `pointer-events` back to `none`, and the iframe stays
  // permanently interactive (blocking host clicks under empty dock
  // areas like the strip to the left of an open panel).
  function onPointerMove(e: MouseEvent): void {
    window.parent.postMessage(
      { source: 'pinagent-dock', type: 'pointer-move', x: e.clientX, y: e.clientY },
      '*',
    );
  }
  document.addEventListener('mousemove', onPointerMove, true);

  requestAnimationFrame(loop);
  return () => {
    running = false;
    document.removeEventListener('mousemove', onPointerMove, true);
  };
}
