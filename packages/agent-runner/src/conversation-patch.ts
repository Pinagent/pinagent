// SPDX-License-Identifier: Apache-2.0
/**
 * Conversation patch helpers — single entry points both plugins call
 * when the dock PATCHes one or many conversations.
 *
 *   - `applyConversationPatch` wraps Storage.patch for a single id and
 *     emits the human-facing audit events (rename, archive, unarchive).
 *   - `applyBulkArchive` does N storage.patch calls then emits ONE
 *     bulk audit event with the full id list. Bulk avoids papering the
 *     History → Activity feed with N individual archive entries when a
 *     user sweeps 50 stale rows.
 *
 * Other fields (status, worktreeState, etc.) flow through Storage.patch
 * unaudited because they have their own emit sites elsewhere
 * (mergeWorktree, discardWorktree, MCP resolve).
 */
import { z } from 'zod';
import { recordAuditEvent } from './audit-log';
import { type FeedbackRecord, ID_RE, type Patch, Storage } from './storage';

/**
 * Wire body for `POST /__pinagent/feedback/bulk-update`. v1 only carries
 * the archived flip; rename + lifecycle stay on the per-row PATCH.
 * Cap on the id list keeps the worst-case request bounded — a 200-row
 * batch is already well past the manual-select pain threshold.
 */
export const BulkUpdateBodySchema = z.object({
  ids: z.array(z.string().regex(ID_RE)).min(1).max(200),
  patch: z.object({
    archived: z.boolean(),
  }),
});
export type BulkUpdateBody = z.infer<typeof BulkUpdateBodySchema>;

export interface ApplyPatchResult {
  /** Updated record, or null when the id didn't exist. */
  record: FeedbackRecord | null;
}

export async function applyConversationPatch(
  projectRoot: string,
  id: string,
  patch: Patch,
): Promise<ApplyPatchResult> {
  const storage = new Storage(projectRoot);
  const previous = await storage.read(id);
  if (!previous) return { record: null };

  const updated = await storage.patch(id, patch);
  if (!updated) return { record: null };

  // Title transition. PatchSchema collapses empty input to null in
  // Storage, so the comparison here is against the post-normalized
  // value the row actually stored.
  if (patch.title !== undefined && previous.title !== updated.title) {
    await recordAuditEvent(projectRoot, {
      conversationId: id,
      actor: 'user',
      action: 'conversation_renamed',
      payload: { from: previous.title, to: updated.title },
    });
  }

  // Archive toggle. Two distinct actions so the History → Activity feed
  // reads cleanly ("archived" vs "unarchived").
  if (patch.archived !== undefined && previous.archived !== updated.archived) {
    await recordAuditEvent(projectRoot, {
      conversationId: id,
      actor: 'user',
      action: updated.archived ? 'conversation_archived' : 'conversation_unarchived',
      payload: {},
    });
  }

  return { record: updated };
}

export interface BulkArchiveResult {
  /** Ids whose archived flag flipped to the requested value. */
  updated: string[];
  /**
   * Ids the storage layer couldn't find or that were already at the
   * requested value (idempotent — the dock doesn't surface a separate
   * "already archived" error).
   */
  skipped: string[];
}

/**
 * Archive or unarchive a batch of conversations. The dock's bulk-archive
 * action calls through this; the audit log gets a single
 * `conversations_bulk_archived` / `conversations_bulk_unarchived` row
 * naming every affected id, regardless of batch size.
 *
 * Storage.patch already emits a `conversations_changed` project event
 * per row — the dock invalidates `['conversations']` once per render
 * frame thanks to TanStack Query's coalescing, so N emits collapses to
 * one refetch downstream.
 */
export async function applyBulkArchive(
  projectRoot: string,
  ids: string[],
  archived: boolean,
): Promise<BulkArchiveResult> {
  const storage = new Storage(projectRoot);
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const id of ids) {
    const previous = await storage.read(id);
    if (!previous || previous.archived === archived) {
      skipped.push(id);
      continue;
    }
    const next = await storage.patch(id, { archived });
    if (next) {
      updated.push(id);
    } else {
      skipped.push(id);
    }
  }

  if (updated.length > 0) {
    await recordAuditEvent(projectRoot, {
      conversationId: null,
      actor: 'user',
      action: archived ? 'conversations_bulk_archived' : 'conversations_bulk_unarchived',
      payload: { ids: updated, count: updated.length },
    });
  }

  return { updated, skipped };
}
