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
 * `.loose()` everywhere — unknown fields survive the parse so
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
  .loose();

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
  .loose();
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationDetailSchema = ConversationSchema.extend({
  comment: z.string(),
  screenshot: z.string().nullable(),
}).loose();
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
  .loose();
export type Change = z.infer<typeof ChangeSchema>;

export const ChangeDiffSchema = z
  .object({
    diff: z.string(),
    truncated: z.boolean(),
    /**
     * Absolute path of the conversation's worktree, so the dock can open a
     * changed file at the agent's edited version. Optional for older servers.
     */
    worktreePath: z.string().optional(),
  })
  .loose();
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
  .loose();
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
  .loose();
export type PullRequest = z.infer<typeof PullRequestSchema>;

// ---------- Working copy (host branch) ----------

export const WorkingCopyFileSchema = z
  .object({
    path: z.string(),
    added: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
    status: z.enum(['modified', 'added', 'deleted', 'renamed']),
  })
  .loose();
export type WorkingCopyFile = z.infer<typeof WorkingCopyFileSchema>;

/**
 * High-level git state of the branch the dev-server runs on — the data
 * behind the dock dashboard's working-changes hero. Mirrors
 * `@pinagent/agent-runner.WorkingCopyStatus`.
 */
export const WorkingCopyStatusSchema = z
  .object({
    branch: z.string(),
    baseBranch: z.string(),
    isDefaultBranch: z.boolean(),
    filesChanged: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    files: z.array(WorkingCopyFileSchema),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    hasUpstream: z.boolean(),
    dirty: z.boolean(),
    pr: z
      .object({
        number: z.number().int(),
        url: z.string(),
        state: z.enum(['open', 'merged', 'closed', 'draft']),
      })
      .nullable(),
  })
  .loose();
export type WorkingCopyStatus = z.infer<typeof WorkingCopyStatusSchema>;

// ---------- Connections ----------

export const PresentableConnectionsSchema = z
  .object({
    github: z
      .object({
        connected: z.boolean(),
        login: z.string().nullable(),
      })
      .loose(),
    anthropic: z
      .object({
        keySet: z.boolean(),
      })
      .loose(),
  })
  .loose();
export type PresentableConnections = z.infer<typeof PresentableConnectionsSchema>;

// ---------- Settings ----------

/**
 * The three permission-mode options the dock's Settings picker exposes,
 * pinned alongside their SDK-mode equivalents and all human-facing
 * label text. Single source of truth — adding a fourth mode = one
 * append to this list, no scattered edits across the dock UI, the
 * detail-header chip, and the server-side translator.
 *
 * Consumers:
 *   - `PermissionModeSchema` below (zod enum derived from `projectMode`)
 *   - `agent-runner/settings-store` re-exports the schema/type
 *   - `agent-runner/agent.toSdkPermissionMode` looks up `sdkMode`
 *   - `widget-dock/routes/Settings.tsx` iterates this list for the
 *     picker (uses `label` + `description`)
 *   - `widget-dock/lib/permissionMode.ts` looks up the SDK→display
 *     mapping for the detail-header chip (uses `shortLabel` + `tooltip`)
 *
 * `as const` so consumers can derive literal-string types.
 */
export const PROJECT_PERMISSION_MODES = [
  {
    projectMode: 'auto',
    sdkMode: 'acceptEdits',
    label: 'Auto-accept edits',
    shortLabel: 'Auto-accept',
    description: 'Agent edits land in the worktree without confirmation.',
    tooltip: 'Auto-accept edits — tool calls run without prompting.',
  },
  {
    projectMode: 'approve',
    sdkMode: 'default',
    label: 'Require approval',
    shortLabel: 'Approval required',
    description: 'Each edit pauses for your approval before applying.',
    tooltip: 'Approval required — the agent prompts before each tool call.',
  },
  {
    projectMode: 'dry-run',
    sdkMode: 'plan',
    label: 'Dry-run only',
    shortLabel: 'Dry-run',
    description: 'Agents propose but never write. Useful for review-only setups.',
    tooltip: 'Dry-run — plan mode: the agent reasons without running tools.',
  },
] as const;

export type ProjectPermissionModeMeta = (typeof PROJECT_PERMISSION_MODES)[number];

export const PermissionModeSchema = z.enum(
  PROJECT_PERMISSION_MODES.map((m) => m.projectMode) as [
    (typeof PROJECT_PERMISSION_MODES)[number]['projectMode'],
    ...(typeof PROJECT_PERMISSION_MODES)[number]['projectMode'][],
  ],
);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const DockProjectSettingsSchema = z
  .object({
    baseBranch: z.string(),
    worktreeRetentionDays: z.number().int().nonnegative(),
    perConversationCapUsd: z.number(),
    monthlyBudgetUsd: z.number().nullable(),
    permissionMode: PermissionModeSchema,
    /**
     * If `PINAGENT_AGENT_PERMISSION_MODE` is set on the dev server, this
     * carries the resolved SDK mode that will *actually* be used at
     * spawn time — overriding the user's saved `permissionMode` above.
     * `null` when no env override is active. Read-only on the wire:
     * `ProjectSettingsPatchSchema.partial()` silently drops it on PATCH.
     *
     * Default is `null` so older servers without this field still parse
     * cleanly into the dock.
     */
    permissionModeOverride: z.string().nullable().default(null),
  })
  .loose();
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
        .loose(),
    ),
    retentionDays: z.number().int().nonnegative(),
  })
  .loose();
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
  .loose();

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
  .loose();

export type HistoryMatchedField = z.infer<typeof HistoryMatchedFieldSchema>;
export type HistorySearchHit = z.infer<typeof HistorySearchHitSchema>;
