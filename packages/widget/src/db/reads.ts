// SPDX-License-Identifier: Apache-2.0
import {
  type Conversation,
  conversations,
  type Message,
  messages,
  type WidgetAnchor,
  widgetAnchors,
} from '@pinagent/db/schema';
import { asc, desc, eq } from 'drizzle-orm';
import type { BrowserDb } from './client';

export interface PendingRow {
  conversation: Conversation;
  anchor: WidgetAnchor | null;
}

/**
 * All conversations that are still `pending` on the browser, newest
 * first. Joined with their anchor so the caller has everything needed
 * to re-anchor + restore the widget UI without a second round-trip.
 *
 * Filtered to the current page URL — restoring a conversation that
 * was started on a different route would put the bubble at meaningless
 * coordinates.
 */
export async function listPendingForCurrentPage(db: BrowserDb, url: string): Promise<PendingRow[]> {
  const rows = await db
    .select({ conversation: conversations, anchor: widgetAnchors })
    .from(conversations)
    .leftJoin(widgetAnchors, eq(conversations.id, widgetAnchors.conversationId))
    .where(eq(conversations.status, 'pending'))
    .orderBy(desc(conversations.updatedAt));

  return rows.filter((r) => !r.anchor || r.anchor.url === url);
}

/**
 * Full transcript for a conversation, oldest first. Used by the
 * restoration UI to repopulate the stream pane when the user expands
 * a restored bubble.
 */
export async function getConversationMessages(
  db: BrowserDb,
  feedbackId: string,
): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, feedbackId))
    .orderBy(asc(messages.id));
}
