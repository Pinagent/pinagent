// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import {
  type AgentTrayDeps,
  createAgentTray,
  type RawFeedback,
  selectUnresolvedAgents,
  type TrayAgent,
} from '../src/agent-tray';

function rec(partial: Partial<RawFeedback> & Pick<RawFeedback, 'id'>): RawFeedback {
  return { status: 'pending', worktreeState: 'none', ...partial };
}

describe('selectUnresolvedAgents', () => {
  it('keeps the three unresolved statuses', () => {
    const raw = [
      rec({ id: 'working00', status: 'pending', worktreeState: 'active' }), // working
      rec({ id: 'readyland0', status: 'fixed', worktreeState: 'active' }), // readyToLand
      rec({ id: 'awaiting00', status: 'deferred', worktreeState: 'none' }), // awaitingClarification
    ];
    expect(selectUnresolvedAgents(raw).map((a) => a.id)).toEqual([
      'working00',
      'readyland0',
      'awaiting00',
    ]);
  });

  it('drops landed, discarded, and fresh-pending conversations', () => {
    const raw = [
      rec({ id: 'landed0000', worktreeState: 'landed' }),
      rec({ id: 'discarded0', worktreeState: 'discarded' }),
      rec({ id: 'wontfix000', status: 'wontfix' }),
      rec({ id: 'pending000', status: 'pending', worktreeState: 'none' }),
    ];
    expect(selectUnresolvedAgents(raw)).toEqual([]);
  });

  it('drops archived conversations even when otherwise unresolved', () => {
    const raw = [rec({ id: 'archived00', worktreeState: 'active', archived: true })];
    expect(selectUnresolvedAgents(raw)).toEqual([]);
  });

  it('prefers the explicit title, else the comment first line, mapping selector', () => {
    const [withTitle, withComment, untitled] = selectUnresolvedAgents([
      rec({
        id: 'titled0000',
        worktreeState: 'active',
        title: 'Fix the header',
        comment: 'ignored',
        selector: 'header > h1',
      }),
      rec({
        id: 'commented0',
        worktreeState: 'active',
        comment: 'Tweak the modal\nsecond line',
      }),
      rec({ id: 'blank00000', worktreeState: 'active' }),
    ]);
    expect(withTitle).toMatchObject({ title: 'Fix the header', selector: 'header > h1' });
    expect(withComment).toMatchObject({ title: 'Tweak the modal', selector: null });
    expect(untitled.title).toBe('Untitled');
  });

  it('maps messageCount and totalCostUsd, defaulting missing values to 0', () => {
    const [withMeta, withoutMeta] = selectUnresolvedAgents([
      rec({ id: 'withmeta00', worktreeState: 'active', messageCount: 5, totalCostUsd: 0.34 }),
      rec({ id: 'nometa0000', worktreeState: 'active' }),
    ]);
    expect(withMeta).toMatchObject({ messageCount: 5, costUsd: 0.34 });
    expect(withoutMeta).toMatchObject({ messageCount: 0, costUsd: 0 });
  });
});

/** A promise plus its resolver, for driving async fetches in the test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createAgentTray controller', () => {
  it('fetches and renders on start', async () => {
    const raw = [rec({ id: 'working00', worktreeState: 'active' })];
    const render = vi.fn();
    const tray = createAgentTray({
      fetchFeedback: () => Promise.resolve(raw),
      subscribeProject: () => () => {},
      render,
    });
    tray.start();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect((render.mock.calls[0][0] as TrayAgent[]).map((a) => a.id)).toEqual(['working00']);
  });

  it('coalesces refreshes that arrive while a fetch is in flight', async () => {
    const gates = [deferred<RawFeedback[]>(), deferred<RawFeedback[]>()];
    let calls = 0;
    const deps: AgentTrayDeps = {
      fetchFeedback: () => gates[calls++]?.promise ?? Promise.resolve([]),
      subscribeProject: () => () => {},
      render: vi.fn(),
    };
    const tray = createAgentTray(deps);

    void tray.refresh(); // call #1 — in flight
    void tray.refresh(); // queued
    void tray.refresh(); // collapses into the single queued slot
    expect(calls).toBe(1);

    gates[0].resolve([]);
    await vi.waitFor(() => expect(calls).toBe(2)); // exactly one more, not three
    gates[1].resolve([]);
    await gates[1].promise;
  });

  it('removeOptimistic drops a row and is idempotent', async () => {
    const raw = [
      rec({ id: 'working00', worktreeState: 'active' }),
      rec({ id: 'readyland0', status: 'fixed', worktreeState: 'active' }),
    ];
    const render = vi.fn();
    const tray = createAgentTray({
      fetchFeedback: () => Promise.resolve(raw),
      subscribeProject: () => () => {},
      render,
    });
    tray.start();
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    tray.removeOptimistic('working00');
    expect((render.mock.calls.at(-1)?.[0] as TrayAgent[]).map((a) => a.id)).toEqual(['readyland0']);

    const callsBefore = render.mock.calls.length;
    tray.removeOptimistic('working00'); // already gone → no re-render
    expect(render.mock.calls.length).toBe(callsBefore);
  });

  it('refreshes when a project event fires and stops cleanly', async () => {
    let onChange: (() => void) | null = null;
    const unsub = vi.fn();
    let calls = 0;
    const tray = createAgentTray({
      fetchFeedback: () => {
        calls++;
        return Promise.resolve([]);
      },
      subscribeProject: (cb) => {
        onChange = cb;
        return unsub;
      },
      render: vi.fn(),
    });
    tray.start();
    await vi.waitFor(() => expect(calls).toBe(1));
    onChange?.();
    await vi.waitFor(() => expect(calls).toBe(2));
    tray.stop();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
