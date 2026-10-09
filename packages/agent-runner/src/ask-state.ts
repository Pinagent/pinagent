// SPDX-License-Identifier: Apache-2.0
import { activeRuns, and, eq, inArray, messages } from '@pinagent/db';
import type { AwaitingInput } from '@pinagent/shared';
import { type Db, getDb } from './db/client';
import { emitProjectChange } from './project-events';

/**
 * Server-authoritative "this run is blocked on the developer" state.
 *
 * The widget's running-agents tray (and the dock's conversation list) learn
 * about a conversation from the shallow `GET /__pinagent/feedback` list, not
 * the per-conversation event stream, so they can't see an open `ask_user`
 * on their own. The run's `active_runs` row carries `awaiting_ask_id` for
 * exactly this: set while an ask is shown, cleared when it settles, and gone
 * with the row when the run ends. Answers are not bus events, so the column —
 * not the transcript — is the only record that an ask is still open.
 *
 * Writes are conditional on the ask id, so a clear for an ask that has
 * already been replaced by the next queued one is a no-op, whatever order
 * the two writes land in.
 */
export async function setAwaitingAsk(
  projectRoot: string,
  feedbackId: string,
  askId: string,
): Promise<void> {
  try {
    await getDb(projectRoot)
      .update(activeRuns)
      .set({ awaitingAskId: askId })
      .where(eq(activeRuns.conversationId, feedbackId));
    emitProjectChange({ type: 'conversations_changed' });
  } catch {
    // Transient DB error — the ask itself is still shown in the stream;
    // only the list surfaces miss it until the next write.
  }
}

export async function clearAwaitingAsk(
  projectRoot: string,
  feedbackId: string,
  askId: string,
): Promise<void> {
  try {
    await getDb(projectRoot)
      .update(activeRuns)
      .set({ awaitingAskId: null })
      .where(and(eq(activeRuns.conversationId, feedbackId), eq(activeRuns.awaitingAskId, askId)));
    emitProjectChange({ type: 'conversations_changed' });
  } catch {
    // Same rationale as setAwaitingAsk; the row also dies with the run.
  }
}

/**
 * Batch-read the open asks for a set of conversations: one `active_runs`
 * read plus one read of the matching `ask_user` events (for when the ask
 * was shown and what kind it is). Typically zero or one row each.
 */
export async function readAwaitingInputs(
  db: Db,
  ids?: readonly string[],
): Promise<Map<string, AwaitingInput>> {
  const out = new Map<string, AwaitingInput>();
  const runs = await db
    .select({ id: activeRuns.conversationId, askId: activeRuns.awaitingAskId })
    .from(activeRuns)
    .where(ids ? inArray(activeRuns.conversationId, [...ids]) : undefined);
  const open = runs.filter((r): r is { id: string; askId: string } => !!r.askId);
  if (open.length === 0) return out;
  const asks = await db
    .select({ id: messages.conversationId, content: messages.content, at: messages.createdAt })
    .from(messages)
    .where(
      and(
        eq(messages.role, 'ask_user'),
        inArray(
          messages.conversationId,
          open.map((r) => r.id),
        ),
      ),
    );
  for (const run of open) {
    const row = asks.find((a) => askIdOf(a.content) === run.askId);
    const content = (row?.content ?? {}) as { kind?: unknown; expiresAt?: unknown };
    out.set(run.id, {
      askId: run.askId,
      kind: content.kind === 'permission' ? 'permission' : 'question',
      since: row ? row.at.toISOString() : null,
      expiresAt: typeof content.expiresAt === 'string' ? content.expiresAt : null,
    });
  }
  return out;
}

function askIdOf(content: unknown): string | null {
  if (content && typeof content === 'object' && 'askId' in content) {
    const v = (content as { askId?: unknown }).askId;
    return typeof v === 'string' ? v : null;
  }
  return null;
}
