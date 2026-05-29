// SPDX-License-Identifier: Apache-2.0
import { conversations, messages, widgetAnchors } from '@pinagent/db/schema';
import { eq, sql } from 'drizzle-orm';
import type { BrowserDb } from './client';

/**
 * Anchor data captured at pick time. Mirrors the columns on
 * widget_anchors so the call site doesn't need to know table shape.
 */
export interface AnchorInput {
  url: string;
  file: string | null;
  line: number | null;
  col: number | null;
  selector: string;
  clickX: number;
  clickY: number;
  viewportW: number;
  viewportH: number;
  /** Enclosing component name (`data-pa-comp`); null when uninstrumented. */
  component?: string | null;
  /** Outer→inner chain of distinct enclosing component names. */
  componentPath?: string[] | null;
  /** Loop-instance disambiguation; null unless the loc was ambiguous. */
  instanceIndex?: number | null;
  instanceTotal?: number | null;
  instanceFingerprint?: string | null;
  /**
   * Secondary elements picked via Cmd/Ctrl-click before the committing
   * click. Empty/undefined for the single-pick case.
   */
  additionalAnchors?: AdditionalAnchor[];
}

export interface AdditionalAnchor {
  file: string | null;
  line: number | null;
  col: number | null;
  selector: string;
  clickX: number;
  clickY: number;
  component?: string | null;
}

/**
 * Called once per submitted comment, right after the server returns
 * `{ id, agentSpawned: true }`. Records the conversation header + DOM
 * anchor so restoration on reload can find the original target.
 */
export async function recordConversationStart(
  db: BrowserDb,
  args: { feedbackId: string; comment: string; anchor: AnchorInput },
): Promise<void> {
  await db
    .insert(conversations)
    .values({ id: args.feedbackId, comment: args.comment })
    .onConflictDoNothing();

  const { additionalAnchors, ...anchorCols } = args.anchor;
  await db
    .insert(widgetAnchors)
    .values({
      conversationId: args.feedbackId,
      ...anchorCols,
      additionalAnchors:
        additionalAnchors && additionalAnchors.length > 0 ? additionalAnchors : null,
    })
    .onConflictDoNothing();
}

/**
 * Append one AgentEvent to the conversation transcript. The event is
 * stored as JSON in `content`; the discriminator goes in `role` so
 * future queries can filter without parsing JSON.
 *
 * Caller's responsibility to ensure `turn` matches the active agent
 * turn (see Composer.turn — bumps on user submit + initial submit).
 */
export async function recordEvent(
  db: BrowserDb,
  feedbackId: string,
  turn: number,
  event: { type: string; [k: string]: unknown },
): Promise<void> {
  try {
    await db.insert(messages).values({
      conversationId: feedbackId,
      turn,
      role: event.type,
      content: event,
    });
    await touchConversation(db, feedbackId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[pinagent:db] recordEvent insert failed (${feedbackId} turn ${turn} ${event.type}):`,
      err,
    );
    throw err;
  }
}

/**
 * Append a user-typed follow-up message. role='user' so it stands out
 * from agent events at query time; content is the raw text.
 */
export async function recordUserMessage(
  db: BrowserDb,
  feedbackId: string,
  turn: number,
  content: string,
): Promise<void> {
  await db.insert(messages).values({
    conversationId: feedbackId,
    turn,
    role: 'user',
    content: { text: content },
  });
  await touchConversation(db, feedbackId);
}

async function touchConversation(db: BrowserDb, feedbackId: string): Promise<void> {
  await db.run(
    sql`UPDATE conversations SET updated_at = (unixepoch() * 1000) WHERE id = ${feedbackId}`,
  );
}

/**
 * Flip a conversation out of `pending` so it stops appearing in
 * restoration scans on the next reload. Called when the widget sees
 * a terminal event (`result` or `error`).
 *
 * Server's own status (via MCP `resolve_feedback`) is the canonical
 * source for "did the agent fix it"; this is just the BROWSER cache's
 * lifecycle marker. We can converge to the server's status later if
 * we wire it up.
 */
export async function markConversationResolved(
  db: BrowserDb,
  feedbackId: string,
  status: 'fixed' | 'wontfix' | 'deferred',
  resolvedAt?: Date | null,
): Promise<void> {
  await db
    .update(conversations)
    .set({
      status,
      resolvedAt: resolvedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, feedbackId));
}

/**
 * Hard delete — drops the conversation row, which cascades to
 * messages + widget_anchors. Used when the user explicitly closes
 * the widget (Cancel button, Esc-on-done), signalling they don't
 * want it to come back.
 */
export async function deleteConversation(db: BrowserDb, feedbackId: string): Promise<void> {
  await db.delete(conversations).where(eq(conversations.id, feedbackId));
}

/**
 * Drop just the cached messages for a conversation, leaving the
 * conversation row (and its anchors) intact. Used on a WS reconnect: the
 * server replays the full transcript from the start, so the widget wipes
 * the mirror first and lets the replay re-record it once — otherwise each
 * reconnect appends a duplicate copy of every event to the cache, which
 * then resurfaces on the next page-reload restore.
 */
export async function deleteConversationMessages(db: BrowserDb, feedbackId: string): Promise<void> {
  await db.delete(messages).where(eq(messages.conversationId, feedbackId));
}

/**
 * Drop conversations (and their cascaded messages + anchors) that
 * have been resolved for more than 30 days. Keeps the OPFS file from
 * growing forever in a project that gets steady pinagent use.
 *
 * Pending conversations are spared even if they're old — they may
 * still resolve someday, and the user can always dismiss them
 * explicitly. Tune CUTOFF_MS if 30 days feels wrong.
 */
const CUTOFF_MS = 30 * 24 * 60 * 60 * 1000;

export async function pruneOldConversations(db: BrowserDb): Promise<number> {
  const cutoff = Date.now() - CUTOFF_MS;
  const result = await db.run(
    sql`DELETE FROM conversations WHERE updated_at < ${cutoff} AND status != 'pending'`,
  );
  return (result as { rows?: { changes?: number }[] } | undefined)?.rows?.[0]?.changes ?? 0;
}
