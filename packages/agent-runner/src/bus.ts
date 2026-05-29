// SPDX-License-Identifier: Apache-2.0
//
// SQLite-backed per-feedback event bus.
//
// Replaces the previous in-memory implementation that lived in
// @pinagent/shared. The in-memory version pinned its state to a
// `globalThis` Symbol so module re-evaluations within one process
// stayed in sync — but Vite 8 (and similar multi-environment dev
// servers) load this plugin into TWO Node contexts, each with its
// own `globalThis`. A publish in context B was invisible to a
// subscriber in context A → silent UI.
//
// SQLite is already in the project. Every context that opens
// `.pinagent/db.sqlite` sees the same on-disk state. We use the
// pre-existing `messages` table (schema field already shipped via
// migration 0000) and a small polling subscriber.
//
// Trade-offs:
//   - Latency: events appear with up to POLL_INTERVAL_MS lag. At
//     100ms this is invisible for a streaming UI.
//   - Write cost: every publish is one INSERT (~1ms on node:sqlite).
//     The hot path is the in-memory event bus's WebSocket fanout, not
//     the bus itself, so this is fine.
//   - Persistence: events survive a dev-server restart. A page reload
//     in the middle of a run shows the transcript-so-far without
//     needing the agent to still be alive. (The previous in-memory
//     bus already promised this via the 5-minute TTL; SQLite makes
//     it cheap and unbounded.)
//
// `markFinished` writes a sentinel row (role === FINISHED_ROLE).
// Subscribers detect it on their next poll and call `onClose`.

import { messages, type NewMessage } from '@pinagent/db';
import type { AgentEvent, BusSubscriber } from '@pinagent/shared';
import { and, asc, eq, gt } from 'drizzle-orm';
import { getDb } from './db/client';

const POLL_INTERVAL_MS = 100;
const FINISHED_ROLE = '__finished';

export class SqliteEventBus {
  constructor(
    private readonly feedbackId: string,
    private readonly projectRoot: string,
  ) {}

  /**
   * Append an event to the bus. INSERTs one row into `messages` keyed
   * by the conversation id. Idempotent failures (e.g. the conversation
   * row doesn't exist yet because POST handler hasn't finished writing
   * it) are silently swallowed — the caller's event ordering is
   * preserved by the autoincrement id, and a missing row would only
   * happen during a narrow startup race we already tolerate.
   */
  async publish(event: AgentEvent): Promise<void> {
    try {
      const db = getDb(this.projectRoot);
      await db.insert(messages).values({
        conversationId: this.feedbackId,
        // `turn` is part of the messages schema but isn't tracked at
        // the bus layer — the agent doesn't emit turn boundaries. We
        // record 1 uniformly; the turn-aware transcript view in the
        // widget groups by other signals (init / result events).
        turn: 1,
        role: event.type,
        content: event as unknown as NewMessage['content'],
      });
    } catch {
      // FK violation (conversation not yet inserted) or transient DB
      // error — better to drop one event than crash the agent run.
    }
  }

  /**
   * Start delivering events to `sub`. Replays everything written so
   * far for this feedback id (via the first poll), then delivers new
   * events as they arrive. Calling the returned function stops
   * polling.
   *
   * Polling is per-subscriber. For our actual subscriber load (1–3
   * widget connections per feedback) this is cheaper than maintaining
   * a shared poll loop with a fan-out Set.
   */
  subscribe(sub: BusSubscriber): () => void {
    let lastSeenId = 0;
    let stopped = false;
    let polling = false;

    const poll = async (): Promise<void> => {
      if (stopped || polling) return;
      polling = true;
      try {
        const db = getDb(this.projectRoot);
        const rows = await db
          .select()
          .from(messages)
          .where(and(eq(messages.conversationId, this.feedbackId), gt(messages.id, lastSeenId)))
          .orderBy(asc(messages.id));

        for (const row of rows) {
          if (stopped) return;
          lastSeenId = row.id;
          if (row.role === FINISHED_ROLE) {
            stopped = true;
            clearInterval(interval);
            try {
              sub.onClose();
            } catch {
              // Subscriber's onClose threw — nothing useful to do.
            }
            return;
          }
          try {
            sub.onEvent(row.content as unknown as AgentEvent);
          } catch {
            // Subscriber threw on a specific event — keep going, this
            // matches the in-memory bus's "don't let one bad sub take
            // down delivery" contract.
          }
        }
      } catch {
        // DB may not have migrated yet on the very first poll if the
        // route handler is still booting. Drop this tick; the next
        // poll will likely succeed.
      } finally {
        polling = false;
      }
    };

    // Kick off the initial replay immediately rather than waiting
    // POLL_INTERVAL_MS — fast first-paint matters for the widget.
    void poll();
    const interval = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }

  /**
   * Signal that no more events will be published for this feedback.
   * Writes a sentinel row that subscribers pick up on their next poll
   * and translate into `onClose`. The DB rows themselves stay until
   * the parent `conversations` row is deleted (FK cascade).
   */
  async markFinished(): Promise<void> {
    try {
      const db = getDb(this.projectRoot);
      await db.insert(messages).values({
        conversationId: this.feedbackId,
        turn: 1,
        role: FINISHED_ROLE,
        content: {} as unknown as NewMessage['content'],
      });
    } catch {
      // Same rationale as publish — better to drop the sentinel than
      // crash the cleanup path. Subscribers' polls will time out
      // naturally if the agent process is gone.
    }
  }
}

/**
 * Per-context cache of bus instances. Cross-context publish/subscribe
 * still works because the instances all hit the same SQLite file —
 * the cache here just avoids re-allocating the bus object on every
 * lookup within one context.
 */
const BUSES_SYMBOL = Symbol.for('pinagent.agent-runner.bus');
type BusMap = Map<string, SqliteEventBus>;
const buses: BusMap =
  ((globalThis as Record<symbol, unknown>)[BUSES_SYMBOL] as BusMap | undefined) ??
  new Map<string, SqliteEventBus>();
(globalThis as Record<symbol, unknown>)[BUSES_SYMBOL] = buses;

export function getOrCreateBus(feedbackId: string, projectRoot?: string): SqliteEventBus {
  const root = projectRoot ?? process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
  let bus = buses.get(feedbackId);
  if (!bus) {
    bus = new SqliteEventBus(feedbackId, root);
    buses.set(feedbackId, bus);
  }
  return bus;
}

export function getBus(feedbackId: string): SqliteEventBus | undefined {
  return buses.get(feedbackId);
}

export async function finishBus(feedbackId: string): Promise<void> {
  const bus = buses.get(feedbackId);
  if (!bus) return;
  await bus.markFinished();
  buses.delete(feedbackId);
}
