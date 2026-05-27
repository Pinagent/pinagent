// SPDX-License-Identifier: Apache-2.0
/**
 * Zod schemas for the dock's HTTP boundary. The widget-dock package's
 * LocalTransport uses these to parse responses before handing them to
 * React; the server side (agent-runner via vite-plugin / next-plugin)
 * is free to use the same schemas to typecheck its return values.
 *
 * Phase 7b expanded the coverage to every read endpoint the dock hits.
 * Write endpoints (mutations) reuse the same response schemas.
 *
 * `.passthrough()` everywhere — unknown fields survive the parse so
 * additions to a payload don't break old dock builds.
 */
import { z } from 'zod';

// ---------- Shared primitives ----------

/** Dock-rendered status. Mirrors @pinagent/ui's StatusKey. */
export const StatusKeySchema = z.enum([
  'pending',
  'working',
  'awaitingClarification',
  'readyToLand',
  'landed',
  'discarded',
  'error',
  'anchorLost',
]);
export type StatusKey = z.infer<typeof StatusKeySchema>;

const AnchorSchema = z
  .object({
    loc: z.string(),
    selector: z.string(),
    snippet: z.string(),
  })
  .passthrough();

// ---------- Conversation list ----------

export const ConversationSchema = z
  .object({
    id: z.string(),
    shortId: z.string(),
    title: z.string(),
    status: StatusKeySchema,
    page: z.string(),
    anchor: AnchorSchema,
    branch: z.string(),
    updatedAt: z.string(),
    lastMessage: z.string(),
    messageCount: z.number().int().nonnegative(),
  })
  .passthrough();
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationDetailSchema = ConversationSchema.extend({
  comment: z.string(),
  screenshot: z.string().nullable(),
}).passthrough();
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

// ---------- Changes ----------

export const ChangeSchema = z
  .object({
    id: z.string(),
    conversationId: z.string(),
    conversationTitle: z.string(),
    status: z.enum(['readyToLand', 'pending', 'landed', 'error']),
    branch: z.string(),
    filesChanged: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    preview: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();
export type Change = z.infer<typeof ChangeSchema>;

export const ChangeDiffSchema = z
  .object({
    diff: z.string(),
    truncated: z.boolean(),
  })
  .passthrough();
export type ChangeDiff = z.infer<typeof ChangeDiffSchema>;

// ---------- Branches ----------

export const BranchSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    conversationId: z.string().nullable(),
    conversationTitle: z.string().nullable(),
    createdAt: z.string(),
    lastActivity: z.string(),
    state: z.enum(['clean', 'uncommitted', 'behind-base']),
    diskMb: z.number().nullable(),
  })
  .passthrough();
export type Branch = z.infer<typeof BranchSchema>;

// ---------- Pull requests ----------

export const PullRequestSchema = z
  .object({
    id: z.string(),
    number: z.number().int(),
    title: z.string(),
    state: z.enum(['open', 'merged', 'closed', 'draft']),
    branch: z.string(),
    baseBranch: z.string(),
    url: z.string(),
    updatedAt: z.string(),
    conversationIds: z.array(z.string()),
  })
  .passthrough();
export type PullRequest = z.infer<typeof PullRequestSchema>;

// ---------- Connections ----------

export const PresentableConnectionsSchema = z
  .object({
    github: z
      .object({
        connected: z.boolean(),
        login: z.string().nullable(),
      })
      .passthrough(),
    anthropic: z
      .object({
        keySet: z.boolean(),
      })
      .passthrough(),
  })
  .passthrough();
export type PresentableConnections = z.infer<typeof PresentableConnectionsSchema>;

// ---------- Settings ----------

export const PermissionModeSchema = z.enum(['auto', 'approve', 'dry-run']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const DockProjectSettingsSchema = z
  .object({
    baseBranch: z.string(),
    worktreeRetentionDays: z.number().int().nonnegative(),
    perConversationCapUsd: z.number(),
    monthlyBudgetUsd: z.number().nullable(),
    permissionMode: PermissionModeSchema,
  })
  .passthrough();
export type DockProjectSettings = z.infer<typeof DockProjectSettingsSchema>;

// ---------- Prune result ----------

export const PruneStaleResultSchema = z
  .object({
    pruned: z.array(z.string()),
    failed: z.array(
      z
        .object({
          feedbackId: z.string(),
          error: z.string(),
        })
        .passthrough(),
    ),
    retentionDays: z.number().int().nonnegative(),
  })
  .passthrough();
export type PruneStaleResult = z.infer<typeof PruneStaleResultSchema>;

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
