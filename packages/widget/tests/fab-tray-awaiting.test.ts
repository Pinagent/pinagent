// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawFeedback } from '../src/agent-tray';
import type { WidgetContext } from '../src/context';
import { createFabTray } from '../src/fab-tray';
import type { WidgetWsClient } from '../src/ws-client';

// The running-agents tray and the minimized pin must make an agent that is
// blocked on the developer (an open permission prompt / question) stand out
// from agents that are merely working — the waiting state comes from the
// list API's `awaitingInput`.

const NOW = Date.parse('2026-10-08T10:03:00.000Z');

function working(id: string): RawFeedback {
  return { id, comment: `work ${id}`, status: 'pending', worktreeState: 'none', isRunning: true };
}

function waiting(id: string, askId = `ask-${id}`): RawFeedback {
  return {
    ...working(id),
    comment: `wait ${id}`,
    awaitingInput: {
      askId,
      kind: 'permission',
      since: '2026-10-08T10:00:00.000Z',
      expiresAt: '2026-10-08T10:05:00.000Z',
    },
  };
}

let rows: RawFeedback[] = [];
let notifyProject: () => void = () => {};

function mount() {
  const fab = document.createElement('div');
  fab.className = 'fab';
  document.body.appendChild(fab);
  const wsClient = {
    subscribeProject: (cb: () => void) => {
      notifyProject = cb;
      return () => {};
    },
    sendInterrupt: vi.fn(),
  } as unknown as WidgetWsClient;
  const ctx = {
    fab,
    state: { mode: 'idle' },
    wsClient,
    hotkeyChar: null,
    dockEnabled: false,
    isMac: true,
    toast: vi.fn(),
    openUnanchored: vi.fn(),
    enterPicking: vi.fn(),
    exitPicking: vi.fn(),
  } as unknown as WidgetContext;
  createFabTray(ctx).start();
  return { fab, ctx };
}

/** Let the tray's fetch → render chain settle. */
async function settle() {
  await vi.waitFor(() => {
    expect(fetch).toHaveBeenCalled();
  });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })),
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  rows = [];
});

describe('running-agents tray — agents waiting on the developer', () => {
  it('flags the waiting row, sorts it first, and shows how long it has waited', async () => {
    rows = [working('a'), waiting('b')];
    const { fab } = mount();
    await settle();

    expect(fab.querySelector('.pa-tray-title')?.textContent).toBe('Agents · 2 · 1 waiting');
    const list = [...fab.querySelectorAll('.pa-tray-row')];
    expect(list[0]?.classList.contains('awaiting')).toBe(true);
    expect(list[1]?.classList.contains('awaiting')).toBe(false);

    const wait = list[0]?.querySelector('.pa-tray-wait');
    expect(wait?.textContent).toBe('Approve? · waiting 3m');
    expect(wait?.getAttribute('title')).toContain('auto-denies in 2m');
    expect(list[0]?.querySelector('.pa-status-dot')?.getAttribute('data-status')).toBe(
      'awaitingClarification',
    );
    // The primary action reads as answering, not just opening.
    expect(list[0]?.querySelector('.pa-tray-btn')?.textContent).toBe('Answer');
    expect(list[1]?.querySelector('.pa-tray-btn')?.textContent).toBe('Open');
  });

  it('keeps "waiting Xm" current without a server event', async () => {
    rows = [waiting('b')];
    const { fab } = mount();
    await settle();
    expect(fab.querySelector('.pa-tray-wait')?.textContent).toBe('Approve? · waiting 3m');
    vi.setSystemTime(NOW + 60_000);
    vi.advanceTimersByTime(5_000);
    expect(fab.querySelector('.pa-tray-wait')?.textContent).toBe('Approve? · waiting 4m');
  });

  it('turns the minimized pin amber and re-expands when a new ask opens', async () => {
    rows = [working('a')];
    const { fab } = mount();
    await settle();

    // Minimize the tray while the agent is only working.
    (fab.querySelector('.pa-tray-min') as HTMLButtonElement).click();
    expect(fab.classList.contains('tray')).toBe(false);
    expect(fab.classList.contains('running')).toBe(true);
    expect(fab.classList.contains('needs-input')).toBe(false);

    // The agent hits a permission prompt → the tray re-expands on its own.
    rows = [waiting('a')];
    notifyProject();
    await settle();
    expect(fab.classList.contains('tray')).toBe(true);

    // Minimized again with the same ask: the pin carries the amber state.
    (fab.querySelector('.pa-tray-min') as HTMLButtonElement).click();
    notifyProject();
    await settle();
    expect(fab.classList.contains('tray')).toBe(false);
    expect(fab.classList.contains('needs-input')).toBe(true);
    expect(fab.classList.contains('running')).toBe(false);
    expect(fab.querySelector('.fab-agent-badge.needs-input')?.textContent).toBe('1');
    expect(fab.getAttribute('aria-label')).toContain('1 waiting for your input');
  });
});
