// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComposerController } from '../src/composer';
import { ANCHOR_LOST_GRACE_MS } from '../src/constants';
import type { WidgetContext } from '../src/context';
import { openConversationInDock } from '../src/dock-bridge';
import type { WidgetWsClient } from '../src/ws-client';

// composer.ts has its own *local* `tryReanchor`; the only re-anchor lever it
// exposes is `selector.ts::findReanchorTarget`. We force it to always miss so
// a detached target stays lost (and the grace → detach path is exercised)
// rather than re-resolving against unrelated DOM the full suite leaves around.
// Every other selector export stays real via the `...actual` spread.
vi.mock('../src/selector', async (importActual) => {
  const actual = await importActual<typeof import('../src/selector')>();
  return { ...actual, findReanchorTarget: () => null };
});

/**
 * Stub WS client — every method is a no-op spy. The composer reaches for
 * `unsubscribe` (in close()/detachToTray()) and the subscribe surface (only
 * after the iframe's load handler fires, which we don't wait on here).
 */
function stubWsClient(): WidgetWsClient {
  return new Proxy(
    {},
    {
      get: () => () => {},
    },
  ) as unknown as WidgetWsClient;
}

function makeCtx(over: Partial<WidgetContext> = {}): WidgetContext {
  const root = document.createElement('div').attachShadow({ mode: 'open' });
  return {
    host: document.createElement('div'),
    root,
    fab: document.createElement('div'),
    outline: document.createElement('div'),
    state: { mode: 'idle' },
    wsClient: stubWsClient(),
    hotkeyChar: null,
    dockEnabled: false,
    isMac: false,
    composers: new Set(),
    expandedComposer: null,
    enterPicking: () => {},
    exitPicking: () => {},
    applyFabPresentation: () => {},
    swapTo: () => {},
    hopToNextActive: () => {},
    openComposer: () => {},
    bubbleOwner: () => null,
    openUnanchored: () => {},
    toast: () => {},
    ...over,
  };
}

describe('openConversationInDock', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.classList.remove('pa-picking');
  });

  it('posts the open-conversation frame to the dock iframe', () => {
    const iframe = document.createElement('iframe');
    iframe.id = '__pinagent-dock';
    document.body.appendChild(iframe);
    const post = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => ({ postMessage: post }),
    });

    openConversationInDock('fb-xyz');

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      { source: 'pinagent-host', type: 'open-conversation', feedbackId: 'fb-xyz' },
      '*',
    );
  });

  it('no-ops when no dock iframe is present', () => {
    expect(() => openConversationInDock('fb-none')).not.toThrow();
  });
});

describe('anchor lost — detach to the FAB tray', () => {
  // Capture the rAF callback so we can step the position loop by hand under
  // fake timers (happy-dom's real rAF wouldn't fire inside a sync test, and
  // we need to control how much wall-clock the grace window sees).
  let rafCb: FrameRequestCallback | null = null;

  beforeEach(() => {
    document.body.replaceChildren();
    vi.useFakeTimers();
    rafCb = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCb = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      rafCb = null;
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function step() {
    rafCb?.(0);
  }

  it('pulls the whole widget off the page once the grace window elapses', () => {
    const target = document.createElement('button');
    target.textContent = 'pick me';
    document.body.appendChild(target);

    const ctx = makeCtx();
    const controller = createComposerController(ctx);
    controller.open(target, { x: 5, y: 5 });
    const composer = Array.from(ctx.composers)[0];
    composer.feedbackId = 'fb-detach';

    // Detach the anchor. The first frame flags the loss and freezes the
    // widget in place — still on the page during the grace window.
    target.remove();
    step();
    expect(composer.anchorLost).toBe(true);
    expect(composer.iframe.isConnected).toBe(true);
    expect(ctx.composers.has(composer)).toBe(true);

    // After the grace window the anchor is treated as gone for good: the
    // widget is removed and the composer drops out of the live set. The
    // conversation itself is untouched (no cache delete) so the FAB tray,
    // which polls the server, keeps surfacing it.
    vi.advanceTimersByTime(ANCHOR_LOST_GRACE_MS + 50);
    step();
    expect(composer.iframe.isConnected).toBe(false);
    expect(composer.bubble.isConnected).toBe(false);
    expect(ctx.composers.has(composer)).toBe(false);
  });

  it('recovers without detaching if the element comes back during the grace window', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);

    const ctx = makeCtx();
    const controller = createComposerController(ctx);
    controller.open(target, { x: 5, y: 5 });
    const composer = Array.from(ctx.composers)[0];
    composer.feedbackId = 'fb-recover';

    target.remove();
    step();
    expect(composer.anchorLost).toBe(true);

    // Re-attach within the grace window and clear the re-anchor miss so the
    // next frame finds the live target again.
    document.body.appendChild(target);
    vi.advanceTimersByTime(ANCHOR_LOST_GRACE_MS - 100);
    step();

    expect(composer.anchorLost).toBe(false);
    expect(composer.iframe.isConnected).toBe(true);
    expect(ctx.composers.has(composer)).toBe(true);
  });
});

describe('openUnanchored — free-floating chat', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    document.body.replaceChildren();
    // Neutralise the rAF loop so the composer's positioning doesn't run
    // against the detached body rect mid-assertion.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  it('opens a conversation as an unanchored, expanded composer', () => {
    const ctx = makeCtx();
    const controller = createComposerController(ctx);

    controller.openUnanchored('fb-float');

    const composer = Array.from(ctx.composers)[0];
    expect(composer).toBeTruthy();
    expect(composer.feedbackId).toBe('fb-float');
    expect(composer.unanchored).toBe(true);
    expect(composer.expanded).toBe(true);
    expect(ctx.expandedComposer).toBe(composer);
  });

  it('surfaces an already-open conversation instead of duplicating it', () => {
    const swapTo = vi.fn();
    const ctx = makeCtx({ swapTo });
    const controller = createComposerController(ctx);

    controller.openUnanchored('fb-dupe');
    expect(ctx.composers.size).toBe(1);

    controller.openUnanchored('fb-dupe');
    // No second composer; the existing one is surfaced via swapTo.
    expect(ctx.composers.size).toBe(1);
  });
});
