// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createComposerController } from '../src/composer';
import type { WidgetContext } from '../src/context';
import { attachStreamHandler } from '../src/stream-handler';
import type { AgentEvent, Composer, FeedbackHandler, LifecycleEls } from '../src/types';
import type { WidgetWsClient } from '../src/ws-client';

// ---------------------------------------------------------------------------
// attachStreamHandler — exercised against a hand-built stream-pane DOM and a
// fake WS client, so the follow-up queue / auto-close / needs-input logic is
// driven directly (no reliance on the iframe load handler, which happy-dom
// doesn't fire synchronously).
// ---------------------------------------------------------------------------

/** Build the subset of the stream-pane DOM that attachStreamHandler touches. */
function buildStreamDom() {
  document.body.innerHTML = `
    <div class="card">
      <div class="mini-bar"><span id="pa-mini-label"></span></div>
      <div id="pa-stream-header"></div>
      <div class="stream-context" id="pa-stream-context" hidden></div>
      <div class="lifecycle" id="pa-lifecycle" hidden>
        <span id="pa-lifecycle-label"></span>
        <button id="pa-land" hidden></button>
        <button id="pa-discard" hidden></button>
      </div>
      <div class="log" id="pa-stream-log"></div>
      <div class="follow">
        <textarea id="pa-follow-input"></textarea>
        <button id="pa-follow-send"></button>
      </div>
      <div id="pa-stream-footer-row">
        <span id="pa-stream-footer"></span>
        <button id="pa-stop" hidden></button>
      </div>
    </div>`;
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const lifecycle: LifecycleEls = {
    row: byId('pa-lifecycle'),
    label: byId('pa-lifecycle-label'),
    landBtn: byId('pa-land') as HTMLButtonElement,
    discardBtn: byId('pa-discard') as HTMLButtonElement,
  };
  return {
    idoc: document,
    header: byId('pa-stream-header'),
    log: byId('pa-stream-log'),
    footer: byId('pa-stream-footer'),
    stopBtn: byId('pa-stop') as HTMLButtonElement,
    followInput: byId('pa-follow-input') as HTMLTextAreaElement,
    followSend: byId('pa-follow-send') as HTMLButtonElement,
    lifecycle,
  };
}

/** Minimal Composer stand-in — only the fields/methods the handler reads. */
function fakeComposer(over: Partial<Composer> = {}): Composer {
  return {
    feedbackId: 'fb-1',
    turn: 1,
    followUpQueue: [],
    expanded: true,
    viewState: 'expanded',
    needsInput: false,
    agentState: 'running',
    autoCloseTimer: null,
    refitStream: vi.fn(),
    scheduleAutoClose: vi.fn(),
    cancelAutoClose: vi.fn(),
    ...over,
  } as unknown as Composer;
}

/** Fake WS client that captures the subscribed handler + records sends. */
function fakeClient() {
  let captured: FeedbackHandler | undefined;
  const sendUserMessage = vi.fn();
  const sendInterrupt = vi.fn();
  const sendAskResponse = vi.fn();
  const client = {
    subscribe: (_id: string, h: FeedbackHandler) => {
      captured = h;
    },
    sendUserMessage,
    sendInterrupt,
    sendAskResponse,
    sendLandRequest: vi.fn(),
    sendDiscardRequest: vi.fn(),
  } as unknown as WidgetWsClient;
  return {
    client,
    sendUserMessage,
    sendInterrupt,
    sendAskResponse,
    get handler(): FeedbackHandler {
      if (!captured) throw new Error('subscribe was never called');
      return captured;
    },
  };
}

function attach(composer: Composer) {
  const dom = buildStreamDom();
  const ws = fakeClient();
  attachStreamHandler(
    ws.client,
    dom.idoc,
    composer,
    vi.fn(),
    dom.header,
    dom.log,
    dom.footer,
    dom.stopBtn,
    dom.followInput,
    dom.followSend,
    dom.lifecycle,
  );
  return { dom, ws };
}

const okResult: AgentEvent = {
  type: 'result',
  subtype: 'success',
  numTurns: 1,
  totalCostUsd: 0,
};

describe('attachStreamHandler — follow-up queue', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('parks a follow-up typed mid-turn instead of sending it', () => {
    const composer = fakeComposer();
    const { dom, ws } = attach(composer);

    // The handler starts in the running state (turnRunning = true).
    composer.enqueueFollowUp?.('hold me');

    expect(ws.sendUserMessage).not.toHaveBeenCalled();
    expect(composer.followUpQueue).toHaveLength(1);
    expect(dom.log.querySelectorAll('.user-msg.pending')).toHaveLength(1);
  });

  it('flushes one queued message per turn-end, FIFO', () => {
    const composer = fakeComposer();
    const { ws } = attach(composer);

    composer.enqueueFollowUp?.('first');
    composer.enqueueFollowUp?.('second');
    expect(composer.followUpQueue).toHaveLength(2);

    // First turn-end flushes "first" (and starts its turn).
    ws.handler.onEvent(okResult);
    expect(ws.sendUserMessage).toHaveBeenLastCalledWith('fb-1', 'first');
    expect(composer.followUpQueue).toHaveLength(1);
    // Queue still has work → no auto-close yet.
    expect(composer.scheduleAutoClose).not.toHaveBeenCalled();

    // Second turn-end flushes "second".
    ws.handler.onEvent(okResult);
    expect(ws.sendUserMessage).toHaveBeenLastCalledWith('fb-1', 'second');
    expect(composer.followUpQueue).toHaveLength(0);
  });

  it('promotes the pending bubble to a committed one on flush', () => {
    const composer = fakeComposer();
    const { dom, ws } = attach(composer);

    composer.enqueueFollowUp?.('queued msg');
    expect(dom.log.querySelectorAll('.user-msg.pending')).toHaveLength(1);

    ws.handler.onEvent(okResult);
    // Same node, de-pending'd — not a duplicate append.
    expect(dom.log.querySelectorAll('.user-msg')).toHaveLength(1);
    expect(dom.log.querySelectorAll('.user-msg.pending')).toHaveLength(0);
  });

  it('sends immediately when the agent is idle', () => {
    const composer = fakeComposer();
    const { ws } = attach(composer);

    // End the initial turn so the handler is idle.
    ws.handler.onEvent(okResult);
    ws.sendUserMessage.mockClear();

    composer.enqueueFollowUp?.('now');
    expect(ws.sendUserMessage).toHaveBeenCalledWith('fb-1', 'now');
    expect(composer.followUpQueue).toHaveLength(0);
  });

  it('re-queues (does not drop) a message bounced with "turn already in progress"', () => {
    const composer = fakeComposer();
    const { dom, ws } = attach(composer);

    ws.handler.onEvent(okResult); // idle
    composer.enqueueFollowUp?.('race'); // sends immediately, becomes lastSent
    expect(ws.sendUserMessage).toHaveBeenCalledWith('fb-1', 'race');

    ws.handler.onError('a turn is already in progress');

    expect(composer.followUpQueue).toHaveLength(1);
    expect(composer.followUpQueue[0]?.content).toBe('race');
    // The race is recovered silently — no error line in the transcript.
    expect(dom.log.querySelector('.err-line')).toBeNull();
  });
});

describe('attachStreamHandler — completion auto-close', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('schedules auto-close once on a clean finish with an empty queue', () => {
    const composer = fakeComposer();
    const { ws } = attach(composer);

    ws.handler.onEvent(okResult);
    expect(composer.scheduleAutoClose).toHaveBeenCalledTimes(1);
  });

  it('does not auto-close a failed run', () => {
    const composer = fakeComposer();
    const { ws } = attach(composer);

    ws.handler.onEvent({ type: 'result', subtype: 'error_max_turns', numTurns: 1 });
    expect(composer.scheduleAutoClose).not.toHaveBeenCalled();
  });
});

describe('attachStreamHandler — needs-input (ask_user)', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('flags needs-input on ask and clears it on answer', () => {
    // expanded:false so the ask drives the minimized attention state too.
    const composer = fakeComposer({ expanded: false });
    const { dom, ws } = attach(composer);

    ws.handler.onEvent({ type: 'ask_user', askId: 'a1', question: 'Which one?' });
    expect(composer.needsInput).toBe(true);
    expect(document.body.classList.contains('needs-input')).toBe(true);

    const askInput = dom.log.querySelector('.ask-input') as HTMLTextAreaElement;
    const askSend = dom.log.querySelector('.ask-form .btn.primary') as HTMLButtonElement;
    askInput.value = 'the second';
    askInput.dispatchEvent(new Event('input'));
    askSend.click();

    expect(ws.sendAskResponse).toHaveBeenCalledWith('a1', 'the second');
    expect(composer.needsInput).toBe(false);
    expect(document.body.classList.contains('needs-input')).toBe(false);
  });

  it('does not flush queued follow-ups while an answer is pending', () => {
    const composer = fakeComposer();
    const { ws } = attach(composer);

    ws.handler.onEvent({ type: 'ask_user', askId: 'a1', question: 'Wait?' });
    composer.enqueueFollowUp?.('after the answer');
    // A stray result while the ask is unanswered must not flush the queue.
    ws.handler.onEvent(okResult);

    expect(ws.sendUserMessage).not.toHaveBeenCalled();
    expect(composer.followUpQueue).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Composer view-state transitions + the real auto-close timer, driven through
// the controller (mirrors the anchor-lost test's rAF-stub approach).
// ---------------------------------------------------------------------------

function stubWsClient(): WidgetWsClient {
  return new Proxy({}, { get: () => () => {} }) as unknown as WidgetWsClient;
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
    pickRouteComposer: null,
    enterPicking: () => {},
    exitPicking: () => {},
    applyFabPresentation: () => {},
    swapTo: () => {},
    hopToNextActive: () => {},
    openComposer: () => {},
    addNodeToComposer: () => {},
    bubbleOwner: () => null,
    toast: () => {},
    ...over,
  };
}

function mountComposer(ctx: WidgetContext): Composer {
  const target = document.createElement('button');
  document.body.appendChild(target);
  const controller = createComposerController(ctx);
  controller.open(target, { x: 5, y: 5 });
  return Array.from(ctx.composers)[0] as Composer;
}

describe('composer view-state transitions', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    // Neutralise the rAF reposition loop so it can't churn during the test.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('moves between expanded, minimal, and bubble', () => {
    const ctx = makeCtx();
    const c = mountComposer(ctx);

    expect(c.viewState).toBe('expanded');
    expect(c.expanded).toBe(true);

    c.minimize();
    expect(c.viewState).toBe('minimal');
    expect(c.expanded).toBe(false);

    c.toBubble();
    expect(c.viewState).toBe('bubble');
    expect(c.expanded).toBe(false);

    c.expand();
    expect(c.viewState).toBe('expanded');
    expect(c.expanded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// "Add another element to this conversation" — the picked element joins the
// running conversation as a queued follow-up via the controller's
// addNodeToComposer. The footer BUTTON wiring lives in composer-iframe.ts's
// srcdoc-iframe load handler, which happy-dom doesn't drive — that blind spot
// is why the host→host postMessage routing (event.source === window, not the
// iframe) silently dropped the pick. These lock the controller-side contract
// the button now calls into directly.
// ---------------------------------------------------------------------------
describe('addNodeToComposer', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  function openComposer(ctx: WidgetContext) {
    const controller = createComposerController(ctx);
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    controller.open(anchor, { x: 5, y: 5 });
    return { controller, composer: Array.from(ctx.composers)[0] as Composer };
  }

  it('enqueues a follow-up referencing the picked element', () => {
    const ctx = makeCtx();
    const { controller, composer } = openComposer(ctx);
    composer.feedbackId = 'fb-1';
    const enqueueFollowUp = vi.fn();
    composer.enqueueFollowUp = enqueueFollowUp;

    const picked = document.createElement('button');
    document.body.appendChild(picked);
    controller.addNodeToComposer(composer, picked, { x: 0, y: 0 });

    expect(enqueueFollowUp).toHaveBeenCalledTimes(1);
    const [content, node] = enqueueFollowUp.mock.calls[0];
    expect(content).toContain('<button>');
    expect(node?.tag).toBe('button');
  });

  it('toasts instead of sending when the conversation is not ready', () => {
    const toast = vi.fn();
    const ctx = makeCtx({ toast });
    const { controller, composer } = openComposer(ctx);
    // No feedbackId / enqueueFollowUp — the agent stream isn't wired yet.
    const picked = document.createElement('button');
    document.body.appendChild(picked);
    controller.addNodeToComposer(composer, picked, { x: 0, y: 0 });

    expect(toast).toHaveBeenCalledWith('Conversation not ready yet', 'error');
  });
});

describe('composer auto-close timer', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.useFakeTimers();
    // useFakeTimers may also fake rAF; force the position loop to a no-op so
    // advancing the clock only drives the auto-close setTimeout.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('closes a collapsed, finished composer after the delay', () => {
    const ctx = makeCtx();
    const c = mountComposer(ctx);
    c.feedbackId = 'fb-auto';
    c.minimize();

    c.scheduleAutoClose();
    expect(c.autoCloseTimer).not.toBeNull();
    expect(ctx.composers.has(c)).toBe(true);

    vi.advanceTimersByTime(5_000);
    expect(ctx.composers.has(c)).toBe(false);
  });

  it('never auto-closes while expanded', () => {
    const ctx = makeCtx();
    const c = mountComposer(ctx);
    // Stays expanded.
    c.scheduleAutoClose();
    expect(c.autoCloseTimer).toBeNull();
  });

  it('expanding cancels a pending auto-close', () => {
    const ctx = makeCtx();
    const c = mountComposer(ctx);
    c.minimize();
    c.scheduleAutoClose();
    expect(c.autoCloseTimer).not.toBeNull();

    c.expand();
    expect(c.autoCloseTimer).toBeNull();

    // The timer really was cancelled — advancing doesn't close it.
    vi.advanceTimersByTime(10_000);
    expect(ctx.composers.has(c)).toBe(true);
  });
});
