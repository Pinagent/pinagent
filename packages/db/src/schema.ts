// SPDX-License-Identifier: Apache-2.0
/**
 * Pinagent persistent state. Shared between the dev-side server
 * (`better-sqlite3` via `@pinagent/next-plugin/db/client`) and the browser
 * cache (`@sqlite.org/sqlite-wasm` via `@pinagent/widget/db/client`).
 *
 * Server-side is the source of truth: it owns the agent runs, log
 * files, and worktrees. The browser store mirrors only the
 * conversations the current page cares about and is rebuilt from
 * server state if it ever diverges.
 *
 * Naming follows the v2 plan (`pinagent-v2-plan.md` §4.2). When you
 * change a column here, run `pnpm --filter @pinagent/db drizzle:gen`
 * to produce a new migration; the server applies migrations on
 * connect.
 */
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * One row per pinagent comment a developer submits. id is the nanoid
 * (matches the existing flat-file feedback id) so we can migrate
 * piecemeal without rewriting IDs.
 *
 * `status` mirrors what the MCP server writes today via `Storage.patch`
 * (`pending` / `fixed` / `wontfix` / `deferred`). `agentSessionId` is
 * the Claude Agent SDK session id we resume on follow-up turns.
 */
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  /**
   * Comment text the developer wrote when submitting. Kept here in
   * addition to the original feedback JSON so SQLite-only readers
   * (browser cache) have it without a round-trip.
   */
  comment: text('comment').notNull(),
  /** SDK session id, set after the first agent run. */
  agentSessionId: text('agent_session_id'),
  status: text('status', { enum: ['pending', 'fixed', 'wontfix', 'deferred'] })
    .notNull()
    .default('pending'),
  /** Optional note left by the agent on resolve. */
  note: text('note'),
  /** Optional commit sha if the agent committed its fix. */
  commitSha: text('commit_sha'),
  /** When spawn mode is `worktree`, the git branch the agent ran in. */
  branch: text('branch'),
  /** When spawn mode is `worktree`, the absolute worktree path. */
  worktreePath: text('worktree_path'),
  /**
   * Lifecycle of the worktree itself, orthogonal to `status` (which
   * tracks the developer's intent toward the feedback). `none` for
   * inline-mode rows that never created a worktree; `active` while the
   * worktree exists on disk; `landed` after a successful merge into
   * the project's HEAD branch; `discarded` after the developer threw
   * the work away. Once non-`active`, Land/Discard controls are hidden.
   */
  worktreeState: text('worktree_state', {
    enum: ['none', 'active', 'landed', 'discarded'],
  })
    .notNull()
    .default('none'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
});

/**
 * DOM anchor metadata captured at pick time so the widget can
 * re-anchor itself across HMR / reloads (v2 plan Phase G). One row per
 * conversation.
 *
 * `clickX` / `clickY` are the cursor position relative to the target
 * element's top-left — preserved through scrolls and layout shifts the
 * same way the live widget does it.
 */
export const widgetAnchors = sqliteTable('widget_anchors', {
  conversationId: text('conversation_id')
    .primaryKey()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  /** From the `data-pa-loc` build-time attribute. */
  file: text('file'),
  line: integer('line'),
  col: integer('col'),
  /** CSS-selector fallback for when `data-pa-loc` isn't available. */
  selector: text('selector').notNull(),
  clickX: integer('click_x'),
  clickY: integer('click_y'),
  viewportW: integer('viewport_w'),
  viewportH: integer('viewport_h'),
  /** From `navigator.userAgent` at pick time. Mostly for debugging. */
  userAgent: text('user_agent'),
});

/**
 * Append-only transcript of agent events. One row per AgentEvent
 * (init / text / tool_use / tool_result / ask_user / error / result)
 * plus user messages typed in the widget (`role: 'user'`).
 *
 * `turn` increments per agent turn so we can group events for replay
 * and for the "Turn N" sections in the markdown log file.
 *
 * Note: the source-of-truth for live event streaming is still the
 * in-memory event bus (`packages/shared/src/event-bus.ts`). The SQLite
 * table is the durable record + the browser cache. Bus → SQLite
 * write-through happens in Phase 2 of this migration.
 */
export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  turn: integer('turn').notNull(),
  /**
   * Discriminator. Matches AgentEvent.type plus `'user'` for typed
   * follow-ups. Keep as text (not an enum) so adding new event types
   * doesn't require a migration.
   */
  role: text('role').notNull(),
  /** Full event payload as JSON — kept opaque so schema evolves freely. */
  content: text('content', { mode: 'json' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * One row per in-flight SDK run. Server-only — the browser doesn't
 * need to know which runs are active, only their event stream.
 *
 * `awaitingAskId` is set whenever the `ask_user` tool is blocking on a
 * human response; lets the widget render the pending question
 * authoritatively even on a fresh page load.
 */
export const activeRuns = sqliteTable('active_runs', {
  conversationId: text('conversation_id')
    .primaryKey()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  currentTurn: integer('current_turn').notNull(),
  awaitingAskId: text('awaiting_ask_id'),
  lastError: text('last_error'),
});

/**
 * One row per GitHub PR the dock's compose flow has opened. Populated
 * by `composePullRequest` on the success path and read by the dock's
 * PRs route. The `state` column starts as `open` and is intended to be
 * reconciled against the GitHub API by a future refresh job — the
 * write path here only knows about creation.
 *
 * `conversationIds` is stored as a JSON array of the feedback ids the
 * compose flow bundled into the PR, mirroring what
 * `ComposeOpts.feedbackIds` carried in.
 */
export const pullRequests = sqliteTable('pull_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** GitHub PR number (unique within the repo). */
  number: integer('number').notNull(),
  /** Octokit's `html_url` — what the dock links out to. */
  url: text('url').notNull(),
  /** Compose branch name pushed for this PR. */
  branch: text('branch').notNull(),
  /** Target branch the PR merges into. */
  baseBranch: text('base_branch').notNull(),
  title: text('title').notNull(),
  /**
   * PR body (markdown). Kept so the dock can show a preview without
   * round-tripping GitHub.
   */
  body: text('body').notNull().default(''),
  state: text('state', { enum: ['open', 'merged', 'closed', 'draft'] })
    .notNull()
    .default('open'),
  /** Feedback/conversation ids bundled into this PR. */
  conversationIds: text('conversation_ids', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`('[]')`),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

/**
 * Append-only audit trail of meaningful project actions. Backs the
 * History route's Activity tab. Rows are derived from explicit emit
 * sites (Storage.create, mergeWorktree, discardWorktree,
 * composePullRequest); the table isn't a generic event sink and isn't
 * trying to mirror every WS event.
 *
 * `conversationId` is nullable so project-wide events (e.g. future
 * settings changes) can live here too, but every action emitted today
 * has one. `action` is kept as text — not an enum — so new actions can
 * land without a migration. `payload` is opaque JSON, shaped per-action
 * (e.g. `{ branch, commitSha }` for `conversation_landed`).
 */
export const auditEvents = sqliteTable('audit_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id'),
  actor: text('actor', { enum: ['agent', 'user', 'system'] }).notNull(),
  action: text('action').notNull(),
  payload: text('payload', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`('{}')`),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type WidgetAnchor = typeof widgetAnchors.$inferSelect;
export type NewWidgetAnchor = typeof widgetAnchors.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type ActiveRun = typeof activeRuns.$inferSelect;
export type NewActiveRun = typeof activeRuns.$inferInsert;
export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
