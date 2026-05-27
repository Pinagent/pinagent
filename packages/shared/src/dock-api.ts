// SPDX-License-Identifier: Apache-2.0
/**
 * Zod schemas for the dock's HTTP boundary. The widget-dock package's
 * LocalTransport uses these to parse responses before handing them to
 * React; the server side (agent-runner via vite-plugin / next-plugin)
 * is free to use the same schemas to typecheck its return values.
 *
 * Phase 7 lays the pattern with two newer endpoints (audit-log,
 * history search) and the foundational Conversation shape; the older
 * endpoints (changes, branches, prs, connections, settings) will
 * follow in a subsequent pass.
 *
 * `.passthrough()` everywhere — unknown fields survive the parse so
 * additions to a payload don't break old dock builds.
 */
import { z } from 'zod';

// ---------- Audit log ----------

export const AuditActorSchema = z.enum(['agent', 'user', 'system']);

export const AuditEventSchema = z
  .object({
    id: z.string(),
    conversationId: z.string().nullable(),
    actor: AuditActorSchema,
    action: z.string(),
    payload: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
  })
  .passthrough();

export type AuditActor = z.infer<typeof AuditActorSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ---------- History search ----------

export const HistoryMatchedFieldSchema = z.enum([
  'comment',
  'note',
  'branch',
  'anchor',
  'selector',
]);

export const HistorySearchHitSchema = z
  .object({
    id: z.string(),
    comment: z.string(),
    status: z.enum(['fixed', 'wontfix', 'pending', 'deferred']),
    worktreeState: z.enum(['none', 'active', 'landed', 'discarded']),
    branch: z.string().nullable(),
    file: z.string().nullable(),
    line: z.number().nullable(),
    col: z.number().nullable(),
    selector: z.string(),
    url: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    resolvedAt: z.string().nullable(),
    matchedFields: z.array(HistoryMatchedFieldSchema),
    snippet: z.string(),
  })
  .passthrough();

export type HistoryMatchedField = z.infer<typeof HistoryMatchedFieldSchema>;
export type HistorySearchHit = z.infer<typeof HistorySearchHitSchema>;
