// SPDX-License-Identifier: Apache-2.0
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activeRuns } from '@pinagent/db';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskClosedError, awaitAnswer, rejectAsk, resolveAsk } from '../src/ask-user';
import { getOrCreateBus } from '../src/bus';
import { getDb } from '../src/db/client';
import { Storage } from '../src/storage';

// The conversation list reports an open ask (`awaitingInput`) from
// `active_runs.awaiting_ask_id`, which ask-user sets when an ask is shown
// and clears when it settles. This drives the real awaitAnswer against a
// real SQLite root so the tray/dock data path is covered end to end.

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `pa-ask-state-${nanoid(8)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function runningConversation(): Promise<{ id: string; storage: Storage }> {
  const storage = new Storage(root);
  const id = nanoid(10);
  await storage.create(id, {
    comment: 'make it red',
    loc: { file: 'src/Foo.tsx', line: 1, col: 1 },
    selector: 'button',
    url: 'http://localhost:3000/',
    viewport: { w: 800, h: 600 },
    userAgent: 'test',
    // 1x1 transparent PNG.
    screenshot:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    createdAt: new Date().toISOString(),
  });
  // Pin the bus to this root (ask-user looks it up by feedback id only).
  getOrCreateBus(id, root);
  await getDb(root)
    .insert(activeRuns)
    .values({ conversationId: id, startedAt: new Date(), currentTurn: 1 });
  return { id, storage };
}

async function awaitingOf(storage: Storage, id: string) {
  return (await storage.read(id))?.awaitingInput ?? null;
}

describe('awaitingInput (active_runs.awaiting_ask_id)', () => {
  it('reports an open permission prompt with its shown/expiry times, then clears on answer', async () => {
    const { id, storage } = await runningConversation();
    const before = Date.now();
    const answer = awaitAnswer(
      id,
      { kind: 'permission', question: 'Allow Bash?' },
      { ttlMs: 60_000 },
    );

    await vi.waitFor(async () => {
      expect(await awaitingOf(storage, id)).not.toBeNull();
    });
    const open = await awaitingOf(storage, id);
    expect(open?.kind).toBe('permission');
    expect(open?.since).not.toBeNull();
    const expiresAt = Date.parse(open?.expiresAt ?? '');
    expect(expiresAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    // The list projection agrees with read().
    const listed = (await storage.list()).find((r) => r.id === id);
    expect(listed?.awaitingInput?.askId).toBe(open?.askId);

    resolveAsk(open?.askId ?? '', 'Allow');
    await expect(answer).resolves.toBe('Allow');
    await vi.waitFor(async () => {
      expect(await awaitingOf(storage, id)).toBeNull();
    });
    // Still running — only the ask closed.
    expect((await storage.read(id))?.isRunning).toBe(true);
  });

  it('reports a model question as kind "question" and clears when the run closes it', async () => {
    const { id, storage } = await runningConversation();
    const answer = awaitAnswer(id, { question: 'Which one?' }, { ttlMs: 60_000 });
    await vi.waitFor(async () => {
      expect((await awaitingOf(storage, id))?.kind).toBe('question');
    });

    rejectAsk(id, 'agent run ended');
    await expect(answer).rejects.toBeInstanceOf(AskClosedError);
    await vi.waitFor(async () => {
      expect(await awaitingOf(storage, id)).toBeNull();
    });
  });

  it('moves to the next queued ask when the shown one is answered', async () => {
    const { id, storage } = await runningConversation();
    const first = awaitAnswer(id, { kind: 'permission', question: 'A?' }, { ttlMs: 60_000 });
    const second = awaitAnswer(id, { kind: 'permission', question: 'B?' }, { ttlMs: 60_000 });

    await vi.waitFor(async () => {
      expect(await awaitingOf(storage, id)).not.toBeNull();
    });
    const a = await awaitingOf(storage, id);
    resolveAsk(a?.askId ?? '', 'Allow');
    await first;

    // The stale clear for A must not wipe B, whichever write lands last.
    await vi.waitFor(async () => {
      const b = await awaitingOf(storage, id);
      expect(b).not.toBeNull();
      expect(b?.askId).not.toBe(a?.askId);
    });
    const b = await awaitingOf(storage, id);
    resolveAsk(b?.askId ?? '', 'Deny');
    await expect(second).resolves.toBe('Deny');
    await vi.waitFor(async () => {
      expect(await awaitingOf(storage, id)).toBeNull();
    });
  });

  it('reports nothing for a run that is not blocked', async () => {
    const { id, storage } = await runningConversation();
    expect(await awaitingOf(storage, id)).toBeNull();
    expect((await storage.list()).find((r) => r.id === id)?.awaitingInput).toBeNull();
  });
});
