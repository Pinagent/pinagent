// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachStreamHandler } from '../src/stream-handler';
import type {
  AgentEvent,
  Composer,
  FeedbackHandler,
  LifecycleEls,
  ReplayMessage,
} from '../src/types';
import type { WidgetWsClient } from '../src/ws-client';

// Ticket 006 (+ 004): the follow-up queue semantics that make the stream
// handler offline-first — FIFO one-per-turn-end flush, ask-answer draining,
// the in-flight re-queue race (no drop, no duplicate), and the localStorage
// outbox round-trip on restore. Driven against the real stream handler with
// a hand-built minimal DOM + a fake WS client (no live socket).

const FB = 'fb-queue';

/** A fake WS client that records sends and lets the test drive the handler. */
function makeFakeWs() {
  let captured: FeedbackHandler | null = null;
  const sentUserMessages: string[] = [];
  const sentAskResponses: { askId: string; answer: string }[] = [];
  const client = {
    subscribe(_id: string, h: FeedbackHandler) {
      captured = h;
    },
    sendUserMessage(_id: string, content: string) {
      sentUserMessages.push(content);
    },
    sendAskResponse(askId: string, answer: string) {
      sentAskResponses.push({ askId, answer });
    },
    sendInterrupt() {},
    sendLandRequest() {},
    sendDiscardRequest() {},
  } as unknown as WidgetWsClient;
  return {
    client,
    sentUserMessages,
    sentAskResponses,
    get handler() {
      if (!captured) throw new Error('handler not subscribed yet');
      return captured;
    },
  };
}

/** Build the minimal iframe-document structure the handler queries. */
function buildDom() {
  document.body.innerHTML = `
    <div class="card">
      <div id="pa-mini-label"></div>
      <div id="pa-stream-context" hidden></div>
      <div class="lifecycle"><span></span>
        <button id="pa-land"></button><button id="pa-discard"></button></div>
      <div class="header"></div>
      <div class="log"></div>
      <div class="follow">
        <textarea id="pa-follow-input"></textarea>
        <button id="pa-follow-send"></button>
      </div>
      <div class="footer"></div>
      <button id="pa-stop"></button>
    </div>`;
  const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
  const lifecycle: LifecycleEls = {
    row: document.querySelector('.lifecycle') as HTMLElement,
    label: document.querySelector('.lifecycle span') as HTMLElement,
    landBtn: document.getElementById('pa-land') as HTMLButtonElement,
    discardBtn: document.getElementById('pa-discard') as HTMLButtonElement,
  };
  return {
    idoc: document,
    header: $('.header'),
    log: $('.log'),
    footer: $('.footer'),
    stopBtn: document.getElementById('pa-stop') as HTMLButtonElement,
    followInput: document.getElementById('pa-follow-input') as HTMLTextAreaElement,
    followSend: document.getElementById('pa-follow-send') as HTMLButtonElement,
    lifecycle,
  };
}

function makeComposer(): Composer {
  const bubble = document.createElement('div');
  return {
    feedbackId: FB,
    turn: 1,
    followUpQueue: [],
    expanded: true,
    needsInput: false,
    bubble,
    component: null,
    componentPath: [],
    instance: null,
    autoCloseTimer: null,
    streamFitH: null,
    cancelAutoClose: () => {},
    scheduleAutoClose: () => {},
    refitStream: () => {},
    close: () => {},
    // Unused by the queue paths but part of the shape.
    expand: () => {},
    minimize: () => {},
    toBubble: () => {},
  } as unknown as Composer;
}

function attach(ws: ReturnType<typeof makeFakeWs>, composer: Composer, replayed?: ReplayMessage[]) {
  const dom = buildDom();
  attachStreamHandler(
    ws.client,
    dom.idoc as unknown as Document,
    composer,
    () => {},
    dom.header,
    dom.log,
    dom.footer,
    dom.stopBtn,
    dom.followInput,
    dom.followSend,
    dom.lifecycle,
    replayed,
  );
  return dom;
}

/** End the in-flight turn so the queue can flush one item. */
function endTurn(ws: ReturnType<typeof makeFakeWs>) {
  ws.handler.onEvent({ type: 'result', subtype: 'success', numTurns: 1 } as AgentEvent);
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('FIFO one-per-turn-end flush', () => {
  it('flushes queued follow-ups one at a time, in order, at each turn-end', () => {
    const ws = makeFakeWs();
    const composer = makeComposer();
    attach(ws, composer);

    // Turn is in flight (handler starts with turnRunning=true). Queue two.
    composer.enqueueFollowUp?.('first');
    composer.enqueueFollowUp?.('second');
    expect(composer.followUpQueue).toHaveLength(2);
    expect(ws.sentUserMessages).toEqual([]);

    // First turn ends → exactly ONE flushes.
    endTurn(ws);
    expect(ws.sentUserMessages).toEqual(['first']);
    expect(composer.followUpQueue).toHaveLength(1);

    // Next turn ends → the second flushes.
    endTurn(ws);
    expect(ws.sentUserMessages).toEqual(['first', 'second']);
    expect(composer.followUpQueue).toHaveLength(0);
  });

  it('sends immediately when the agent is already idle', () => {
    const ws = makeFakeWs();
    const composer = makeComposer();
    attach(ws, composer);
    // Move to idle first.
    endTurn(ws);
    composer.enqueueFollowUp?.('now');
    expect(ws.sentUserMessages).toEqual(['now']);
    expect(composer.followUpQueue).toHaveLength(0);
  });
});

describe('ask-answer drains the queue', () => {
  it('answering an ask_user resumes the turn and flushes the next queued item', () => {
    const ws = makeFakeWs();
    const composer = makeComposer();
    const dom = attach(ws, composer);

    // Agent asks a question — the follow-up box is blocked, but queueing
    // still works (it parks behind the ask).
    ws.handler.onEvent({ type: 'ask_user', askId: 'a1', question: 'Which one?' } as AgentEvent);
    composer.enqueueFollowUp?.('queued-behind-ask');
    expect(composer.followUpQueue).toHaveLength(1);
    expect(ws.sentUserMessages).toEqual([]);

    // The turn ends while the ask is still unanswered — a `result` with a
    // pending ask does NOT flush the queue (the agent is blocked on input).
    endTurn(ws);
    expect(ws.sentUserMessages).toEqual([]);
    expect(composer.followUpQueue).toHaveLength(1);

    // Answer via the rendered ask form. Now that the turn isn't running and
    // the ask is resolved, answering drains the queued follow-up.
    const askInput = dom.log.querySelector('.ask-input') as HTMLTextAreaElement;
    const askSend = dom.log.querySelector('.ask-form .btn.primary') as HTMLButtonElement;
    askInput.value = 'the first one';
    askInput.dispatchEvent(new Event('input'));
    askSend.click();

    expect(ws.sentAskResponses).toEqual([{ askId: 'a1', answer: 'the first one' }]);
    // The queue drains now that the ask is resolved and the turn isn't running.
    expect(ws.sentUserMessages).toEqual(['queued-behind-ask']);
    expect(composer.followUpQueue).toHaveLength(0);
  });
});

describe('in-flight re-queue race (no drop, no duplicate)', () => {
  it('re-queues a follow-up the server bounced with "turn already in progress"', () => {
    const ws = makeFakeWs();
    const composer = makeComposer();
    attach(ws, composer);

    composer.enqueueFollowUp?.('racy');
    endTurn(ws); // flushes 'racy' onto the wire
    expect(ws.sentUserMessages).toEqual(['racy']);
    expect(composer.followUpQueue).toHaveLength(0);

    // The server says the turn was still active — re-queue, don't drop.
    ws.handler.onError('a turn is already in progress');
    expect(composer.followUpQueue).toHaveLength(1);
    expect(composer.followUpQueue[0]?.content).toBe('racy');

    // Exactly one copy persisted (no duplicate from the race).
    expect(JSON.parse(localStorage.getItem(`pinagent:followups:${FB}`) ?? '[]')).toEqual([
      { content: 'racy' },
    ]);

    // The active turn ends → it flushes once more, cleanly.
    endTurn(ws);
    expect(ws.sentUserMessages).toEqual(['racy', 'racy']);
    expect(composer.followUpQueue).toHaveLength(0);
  });
});

describe('ticket 004 — outbox persistence + restore', () => {
  it('write-through persists queued follow-ups to localStorage', () => {
    const ws = makeFakeWs();
    const composer = makeComposer();
    attach(ws, composer);
    composer.enqueueFollowUp?.('one');
    composer.enqueueFollowUp?.('two');
    expect(JSON.parse(localStorage.getItem(`pinagent:followups:${FB}`) ?? '[]')).toEqual([
      { content: 'one' },
      { content: 'two' },
    ]);
  });

  it('restores the persisted queue on a reload attach and flushes it normally', () => {
    // Seed the outbox as if a prior page-load had queued these.
    localStorage.setItem(
      `pinagent:followups:${FB}`,
      JSON.stringify([{ content: 'survived-1' }, { content: 'survived-2' }]),
    );

    const ws = makeFakeWs();
    const composer = makeComposer();
    // Restored attach passes a `replayed` array (page-reload path). An
    // in-flight transcript keeps turnRunning true so the queue parks.
    attach(ws, composer, [{ turn: 1, role: 'init', content: { type: 'init', model: 'claude' } }]);

    expect(composer.followUpQueue).toHaveLength(2);
    // Rendered as queued bubbles.
    expect(document.querySelectorAll('.log .user-msg.pending')).toHaveLength(2);

    endTurn(ws);
    expect(ws.sentUserMessages).toEqual(['survived-1']);
    endTurn(ws);
    expect(ws.sentUserMessages).toEqual(['survived-1', 'survived-2']);
  });

  it('a sent follow-up does not re-queue or re-send after reload (outbox already drained)', () => {
    // After a follow-up sent, write-through removed it — the key is gone.
    expect(localStorage.getItem(`pinagent:followups:${FB}`)).toBeNull();
    const ws = makeFakeWs();
    const composer = makeComposer();
    attach(ws, composer, [
      { turn: 1, role: 'result', content: { type: 'result', subtype: 'success', numTurns: 1 } },
    ]);
    expect(composer.followUpQueue).toHaveLength(0);
    endTurn(ws);
    expect(ws.sentUserMessages).toEqual([]);
  });

  it('clears the persisted queue when the server resolves the conversation', () => {
    const ws = makeFakeWs();
    const composer = makeComposer();
    attach(ws, composer);
    composer.enqueueFollowUp?.('abandon-me');
    expect(localStorage.getItem(`pinagent:followups:${FB}`)).not.toBeNull();

    ws.handler.onEvent({ type: 'status_changed', status: 'fixed' } as AgentEvent);
    expect(localStorage.getItem(`pinagent:followups:${FB}`)).toBeNull();
  });
});
