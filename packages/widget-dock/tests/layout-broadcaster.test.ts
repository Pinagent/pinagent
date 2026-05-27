// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Pin the contract `startLayoutBroadcaster` has with the host bridge:
 *
 *   - It discovers every element tagged with `data-pinagent-rect`.
 *   - It posts those rects to `window.parent` as
 *     `{ source: 'pinagent-dock', type: 'layout', rects }`.
 *   - It only re-broadcasts on change (so the host doesn't process a
 *     message per frame).
 *   - It forwards in-iframe mousemove events as
 *     `{ source: 'pinagent-dock', type: 'pointer-move', x, y }` so the
 *     host can flip `pointer-events` back to `none` after the iframe
 *     captured a move event the host doc never saw.
 *
 * If any of these break the FAB stops being clickable (or the host
 * loses click-through under empty dock areas). Both regressions are
 * silent until a user tries to click something.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLayoutBroadcaster } from '../src/entry/layout-broadcaster';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface PostedMessage {
  source: 'pinagent-dock';
  type: 'layout' | 'pointer-move';
  rects?: Rect[];
  x?: number;
  y?: number;
}

/**
 * happy-dom's default getBoundingClientRect returns zeroes — the
 * snapshot filter would then drop the element. Override the prototype
 * to return whatever we wrote to `__rect` on each element so the test
 * can place rects deterministically.
 */
function stubRects(): void {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: HTMLElement & { __rect?: Rect }) {
      const r = this.__rect ?? { left: 0, top: 0, right: 0, bottom: 0 };
      return {
        ...r,
        x: r.left,
        y: r.top,
        width: r.right - r.left,
        height: r.bottom - r.top,
        toJSON() {
          return r;
        },
      } as DOMRect;
    },
  });
}

function tagged(rect: Rect): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-pinagent-rect', '');
  (el as HTMLElement & { __rect: Rect }).__rect = rect;
  document.body.appendChild(el);
  return el;
}

/**
 * Run as many rAF ticks as needed for the broadcaster to flush. The
 * broadcaster reads rects on the next rAF after start, so one tick is
 * enough — but we drain a few to be safe across happy-dom versions.
 */
async function flushFrames(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

let posted: PostedMessage[];
let stop: () => void;

beforeEach(() => {
  stubRects();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  posted = [];
  vi.spyOn(window.parent, 'postMessage').mockImplementation((data: unknown) => {
    posted.push(data as PostedMessage);
  });
});

afterEach(() => {
  stop?.();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('startLayoutBroadcaster', () => {
  it('posts the rects of every [data-pinagent-rect] element to the parent window', async () => {
    tagged({ left: 20, top: 700, right: 68, bottom: 748 }); // FAB
    tagged({ left: 520, top: 0, right: 1000, bottom: 800 }); // open panel

    stop = startLayoutBroadcaster();
    await flushFrames();

    const layouts = posted.filter((m) => m.type === 'layout');
    expect(layouts.length).toBeGreaterThan(0);
    const first = layouts[0];
    expect(first?.source).toBe('pinagent-dock');
    expect(first?.rects).toEqual([
      { left: 20, top: 700, right: 68, bottom: 748 },
      { left: 520, top: 0, right: 1000, bottom: 800 },
    ]);
  });

  it('filters out elements positioned off-viewport so the host does not get stuck `pointer-events: auto` over a phantom rect', async () => {
    tagged({ left: 20, top: 700, right: 68, bottom: 748 }); // on-screen FAB
    tagged({ left: 1500, top: 0, right: 1980, bottom: 800 }); // panel translated off-screen right
    tagged({ left: -300, top: 0, right: 0, bottom: 800 }); // off-screen left

    stop = startLayoutBroadcaster();
    await flushFrames();

    const layouts = posted.filter((m) => m.type === 'layout');
    expect(layouts[0]?.rects).toEqual([{ left: 20, top: 700, right: 68, bottom: 748 }]);
  });

  it('does not re-broadcast when the rect set is unchanged across frames', async () => {
    tagged({ left: 20, top: 700, right: 68, bottom: 748 });

    stop = startLayoutBroadcaster();
    await flushFrames(5);

    const layouts = posted.filter((m) => m.type === 'layout');
    // Exactly one layout message even though the rAF loop ticked
    // multiple times — the broadcaster must short-circuit on equal rects.
    expect(layouts).toHaveLength(1);
  });

  it('forwards in-iframe mousemove events to the parent as pointer-move messages', async () => {
    stop = startLayoutBroadcaster();
    await flushFrames();

    // Drop any layout messages from start — we only care about the
    // pointer-move forward here.
    posted = posted.filter((m) => m.type !== 'layout');

    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 123, clientY: 456, bubbles: true }),
    );

    const moves = posted.filter((m) => m.type === 'pointer-move');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      source: 'pinagent-dock',
      type: 'pointer-move',
      x: 123,
      y: 456,
    });
  });
});
