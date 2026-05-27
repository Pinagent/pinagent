// SPDX-License-Identifier: Apache-2.0
/**
 * `applyConversationPatch` — single entry point both plugins call when
 * the dock PATCHes `/__pinagent/feedback/:id`. Wraps Storage.patch with
 * audit emission for the human-facing transitions: rename, archive,
 * unarchive. Other fields (status, worktreeState, etc.) flow through
 * unaudited because they have their own emit sites elsewhere
 * (mergeWorktree, discardWorktree, MCP resolve).
 *
 * Reads the previous record once before patching so diffs are exact;
 * the cost is one extra SELECT, dwarfed by the audit INSERT itself.
 */
import { recordAuditEvent } from './audit-log';
import { type FeedbackRecord, type Patch, Storage } from './storage';

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
