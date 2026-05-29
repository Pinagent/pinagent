// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComposerController } from '../src/composer';
import type { WidgetContext } from '../src/context';
import { openConversationInDock } from '../src/dock-bridge';
import type { Composer } from '../src/types';
import type { WidgetWsClient } from '../src/ws-client';

// composer.ts has its own *local* `tryReanchor`; the only re-anchor lever it
// exposes is `selector.ts::findReanchorTarget`, which it calls with the
// composer's `dataPaLoc` + CSS `selector`. The orphaned target here is a plain
// `<button>` whose selector resolves to `body > button` — and the composer
// itself appends a `<button class="pa-anchor-lost-dismiss">` to `document.body`,
// so `document.querySelector('body > button')` *matches that dismiss button*.
// Re-anchor therefore "succeeds" against the composer's own chrome, resetting
// `anchorLost` and routing the bubble click down the normal `swapTo` path
// instead of the orphaned-dot path under test. (Cross-file DOM pollution in the
// full suite is a second way to trip the same match.) Mock the real lever to
// always miss so the dot behavior is exercised deterministically; every other
// selector export stays real via the `...actual` spread.
vi.mock('../src/selector', async (importActual) => {
  const actual = await importActual<typeof import('../src/selector')>();
  return { ...actual, findReanchorTarget: () => null };
});

/**
 * Stub WS client — every method is a no-op spy. The composer only reaches
 * for `unsubscribe` (in close()) and the subscribe surface (only after the
 * iframe's load handler fires, which we don't wait on here).
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
    toast: () => {},
    ...over,
  };
}

/**
 * Mount a composer on a detached target and force the anchor-lost dot
 * state: the rAF reposition loop flips `anchorLost` once the target is
 * not `isConnected`, but to keep the test deterministic we drive it by
 * hand. Returns the single composer the controller created.
 */
function mountOrphanedComposer(ctx: WidgetContext, feedbackId = 'fb-123'): Composer {
  const target = document.createElement('button');
  target.textContent = 'pick me';
  document.body.appendChild(target);

  const controller = createComposerController(ctx);
  controller.open(target, { x: 5, y: 5 });
  const composer = Array.from(ctx.composers)[0];

  // Give it a conversation id (required for the dot to show) and detach
  // the target so re-anchor can't possibly succeed. `findReanchorTarget`
  // is mocked to `null` at the module level, so the bubble click stays on
  // the orphaned-dot path; we still set the dot state by hand here (the
  // rAF loop that would normally do it is stubbed out in beforeEach).
  composer.feedbackId = feedbackId;
  target.remove();
  composer.anchorLost = true;
  composer.reviewingLost = false;
  composer.bubble.classList.add('anchor-lost');
  composer.bubble.hidden = false;
  return composer;
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

describe('anchor-lost dot interactions', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    // Neutralise the composer's rAF reposition loop. happy-dom's
    // `requestAnimationFrame` is a macrotask that wouldn't fire inside a
    // synchronous test, but a leaked fake-timer / rAF stub from another
    // file in the full suite can drive it — and `reposition()` re-evaluates
    // the anchor-lost state, which could clobber the hand-driven setup
    // below. No-op stubs keep the click the only thing that mutates state.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clicking the dot opens the conversation in the dock when dock is enabled', () => {
    const iframe = document.createElement('iframe');
    iframe.id = '__pinagent-dock';
    document.body.appendChild(iframe);
    const post = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => ({ postMessage: post }),
    });

    const openDock = vi.fn();
    const ctx = makeCtx({ dockEnabled: true, openDock });
    const composer = mountOrphanedComposer(ctx, 'fb-open');

    composer.bubble.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(post).toHaveBeenCalledWith(
      { source: 'pinagent-host', type: 'open-conversation', feedbackId: 'fb-open' },
      '*',
    );
    expect(openDock).toHaveBeenCalledTimes(1);
  });

  it('clicking the dot without a dock re-shows the composer card inline', () => {
    const ctx = makeCtx({ dockEnabled: false });
    const composer = mountOrphanedComposer(ctx, 'fb-inline');

    composer.bubble.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(composer.reviewingLost).toBe(true);
    expect(composer.expanded).toBe(true);
    // showDot is now false → iframe shown, dot hidden.
    expect(composer.iframe.hidden).toBe(false);
    expect(composer.bubble.hidden).toBe(true);
  });

  it('clicking dismiss archives the conversation and tears down the pin', () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const ctx = makeCtx({ dockEnabled: false });
    const composer = mountOrphanedComposer(ctx, 'fb-dismiss');

    // The dismiss button is the sibling of the bubble created in the factory.
    const dismissBtn = document.querySelector('.pa-anchor-lost-dismiss');
    expect(dismissBtn).toBeTruthy();

    dismissBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/__pinagent/feedback/fb-dismiss');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ archived: true });

    // Teardown: the pin elements are removed and the composer drops out
    // of the live set.
    expect(composer.iframe.isConnected).toBe(false);
    expect(composer.bubble.isConnected).toBe(false);
    expect(dismissBtn?.isConnected).toBe(false);
    expect(ctx.composers.has(composer)).toBe(false);
  });
});
