// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
// Type-only: keeps the public `resolvePermissionMode`/`toSdkPermissionMode`
// signatures stable without pulling the SDK into this module at runtime.
// The actual SDK call lives behind the provider abstraction (./providers).
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { activeRuns as activeRunsTable } from '@pinagent/db';
import { isNotionalCost } from '@pinagent/shared';
import { eq } from 'drizzle-orm';
import { resolveRunPermissionMode, type SpawnAgentMode } from './agent-permission';
import { rejectAsk } from './ask-user';
import { getOrCreateBus } from './bus';
import { getDb } from './db/client';
import { appendLog } from './git-utils';
import { emitProjectChange } from './project-events';
import { type AgentPermissionMode, type AgentRunRequest, resolveProvider } from './providers';
import { SettingsStore } from './settings-store';
import { type FeedbackRecord, Storage } from './storage';
import { createWorktree } from './worktree';

// Public API facade: spawn / follow-up / active-run controls live in this
// module; the worktree lifecycle, read-side stats, and permission/mode
// resolution were split into focused siblings but are re-exported here so
// `./agent` stays the single import surface for consumers and test mocks.
export {
  resolveAgentMode,
  resolvePermissionMode,
  resolvePermissionModeOverride,
  type SpawnAgentMode,
  toSdkPermissionMode,
} from './agent-permission';
export {
  type BulkReopenResult,
  discardWorktree,
  type LandResult,
  mergeWorktree,
  reopenConversation,
  reopenConversations,
} from './worktree';
export {
  computeWorktreeDiff,
  computeWorktreePreview,
  computeWorktreeStats,
  countWorktreeChanges,
  type WorktreeDiff,
  type WorktreeStats,
} from './worktree-stats';

interface AgentContext {
  projectRoot: string;
  feedback: FeedbackRecord;
  mode: SpawnAgentMode;
}

interface ActiveRun {
  abort: AbortController;
}

/**
 * In-flight runs LOCAL TO THIS CONTEXT. The AbortController is a
 * process-bound object — there's no way to serialise it across
 * contexts/processes, so we keep the per-context Map. Cross-context
 * `interruptRun` calls reach the owning context via `process.emit`
 * (see INTERRUPT_EVENT below), which all contexts in the same Node
 * process share.
 *
 * Cross-context "is a run in flight?" visibility is handled separately
 * by the `active_runs` SQLite table — see `hasActiveRun` below.
 */
const activeRuns = new Map<string, ActiveRun>();

/**
 * Cross-context signalling channel for interrupts. The WS server can
 * land in a different context than the one running the SDK loop (Next 16
 * Turbopack, Vite 8 environments), so the in-memory `activeRuns` Map in
 * the WS server's context wouldn't see the entry. Node's `process`
 * EventEmitter is shared across all contexts in one process, so emit-ing
 * here reliably reaches the owning context's listener (registered in
 * `runQuery`). Same idea as the SQLite-backed bus, but for a transient
 * signal rather than a stream — no persistence needed.
 */
const INTERRUPT_EVENT = 'pinagent:interrupt';

async function recordActiveRun(projectRoot: string, feedbackId: string): Promise<void> {
  try {
    const db = getDb(projectRoot);
    await db
      .insert(activeRunsTable)
      .values({
        conversationId: feedbackId,
        startedAt: new Date(),
        currentTurn: 1,
      })
      .onConflictDoUpdate({
        target: activeRunsTable.conversationId,
        set: { startedAt: new Date() },
      });
    // The run is now in flight; nudge project subscribers so the widget's
    // running-agents tray re-fetches and surfaces this conversation as
    // `working` (an inline-mode run is otherwise indistinguishable from an
    // idle `(pending, none)` row — see `deriveDockStatus`'s isRunning axis).
    emitProjectChange({ type: 'conversations_changed' });
  } catch {
    // FK violation or transient DB error — the run itself is still
    // tracked in-process via `activeRuns`; cross-context visibility
    // degrades to "broken" but the run proceeds.
  }
}

async function clearActiveRun(projectRoot: string, feedbackId: string): Promise<void> {
  try {
    const db = getDb(projectRoot);
    await db.delete(activeRunsTable).where(eq(activeRunsTable.conversationId, feedbackId));
    // Run finished — re-fetch so the tray drops the row back to its
    // persisted status (or out of the tray entirely for inline runs).
    emitProjectChange({ type: 'conversations_changed' });
  } catch {
    // Same rationale as recordActiveRun.
  }
}

/**
 * Run an isolated Claude Agent SDK query for a single freshly-submitted
 * feedback record. Kicks off in the background; the route handler resolves
 * its POST as soon as this returns "started", not when the agent finishes.
 *
 * Log file at `.pinagent/logs/<id>.md` accumulates the transcript across
 * the initial run plus any follow-up turns the user sends over WS.
 */
export async function spawnAgent(ctx: AgentContext): Promise<void> {
  if (ctx.mode === false) return;

  const logsDir = join(ctx.projectRoot, '.pinagent', 'logs');
  await mkdir(logsDir, { recursive: true });
  const logPath = join(logsDir, `${ctx.feedback.id}.md`);

  // Cost cap check runs BEFORE worktree creation so a refused spawn
  // doesn't leave orphaned worktrees on disk. Initial spawns rarely
  // breach (running total is 0 for a brand-new conversation), but a
  // re-spawn against an existing feedback id would.
  const capCheck = await checkCostCaps(ctx.projectRoot, ctx.feedback.id);
  if (!capCheck.ok) {
    await getOrCreateBus(ctx.feedback.id, ctx.projectRoot).publish({
      type: 'error',
      message: capCheck.reason,
    });
    await appendLog(logPath, `\n> [pinagent] spawn refused: ${capCheck.reason}\n`);
    return;
  }

  let cwd = ctx.projectRoot;
  const startedAt = new Date().toISOString();

  if (ctx.mode === 'worktree') {
    try {
      cwd = await createWorktree(ctx.projectRoot, ctx.feedback.id, logPath);
    } catch (err) {
      await appendLog(
        logPath,
        `${renderHeader(ctx, cwd, startedAt, /* worktreeReady */ false)}\n> [pinagent] worktree creation failed: ${stringifyErr(err)}\n`,
      );
      return;
    }
  }

  await appendLog(logPath, renderHeader(ctx, cwd, startedAt, /* worktreeReady */ true));

  const prompt = buildInitialPrompt(ctx.feedback, ctx.mode, cwd);
  const permissionMode = await resolveRunPermissionMode(ctx.projectRoot);

  // Fire and forget. The route handler awaits spawnAgent only for the
  // worktree-creation + header-write phase — once we hand off to runQuery
  // the SDK loop owns the rest.
  void runQuery({
    projectRoot: ctx.projectRoot,
    feedbackId: ctx.feedback.id,
    cwd,
    logPath,
    prompt,
    isInitial: true,
    permissionMode,
  });
}

/**
 * Send a follow-up message into the existing conversation for `feedbackId`.
 * Resumes the prior SDK session so the agent keeps full context. Resolves
 * once the new turn has been started, not when it finishes.
 *
 * Refuses if there's no prior session (the feedback was never spawn-mode).
 *
 * The widget queues follow-ups client-side and flushes the next one the
 * instant it sees the prior turn's `result` event. That flush can reach us
 * a few ms BEFORE the just-finished run has torn down its `active_runs`
 * row (the teardown's `clearActiveRun` runs in `runQuery`'s finally, after
 * the `result` was already published). The widget only ever has one turn
 * in flight, so a lingering active run here is that finishing turn — not a
 * parallel one — so we briefly wait for it to clear rather than bouncing
 * the follow-up back. A bounced follow-up is effectively dropped: the
 * widget re-queues it but has no further turn-end event to re-flush it on,
 * so the agent appears to "just end" without addressing the follow-up.
 */
export async function runFollowUpTurn(feedbackId: string, content: string): Promise<void> {
  const projectRoot = process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
  if (!(await waitForRunToClear(feedbackId, projectRoot))) {
    throw new Error('a turn is already in progress for this feedback');
  }

  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) throw new Error(`feedback not found: ${feedbackId}`);
  if (!rec.agentSessionId) {
    throw new Error('no prior agent session — only spawn-mode submissions support follow-ups');
  }

  const capCheck = await checkCostCaps(projectRoot, feedbackId);
  if (!capCheck.ok) {
    // Publish to the bus so every dock subscribed to this conversation
    // sees the refusal — `sendError` only goes to the originating
    // socket. Then throw so the WS handler still surfaces the message
    // to the originating client immediately.
    await getOrCreateBus(feedbackId, projectRoot).publish({
      type: 'error',
      message: capCheck.reason,
    });
    throw new Error(capCheck.reason);
  }

  // If the original run used a worktree and it's still there, resume in
  // it. Otherwise fall back to the project root. This is robust to the
  // user flipping `spawnAgent: 'worktree' ↔ 'inline'` between runs.
  const worktreePath = join(projectRoot, '.pinagent', 'worktrees', feedbackId);
  const cwd = existsSync(worktreePath) ? worktreePath : projectRoot;

  const logsDir = join(projectRoot, '.pinagent', 'logs');
  await mkdir(logsDir, { recursive: true });
  const logPath = join(logsDir, `${feedbackId}.md`);

  await appendLog(
    logPath,
    `\n## Follow-up turn · ${new Date().toISOString()}\n\n> **User**\n> \n> ${content
      .split('\n')
      .join('\n> ')}\n\n`,
  );

  const permissionMode = await resolveRunPermissionMode(projectRoot);

  void runQuery({
    projectRoot,
    feedbackId,
    cwd,
    logPath,
    prompt: content,
    isInitial: false,
    permissionMode,
    resume: rec.agentSessionId,
  });
}

/**
 * True iff an SDK run is currently in flight for this feedback id, in
 * ANY context. Reads the `active_runs` SQLite row inserted by
 * `runQuery`. Local-Map check is cheap and short-circuits the common
 * case where the run was started in the same context.
 */
export async function hasActiveRun(feedbackId: string, projectRoot?: string): Promise<boolean> {
  if (activeRuns.has(feedbackId)) return true;
  const root = projectRoot ?? process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
  try {
    const db = getDb(root);
    const rows = await db
      .select()
      .from(activeRunsTable)
      .where(eq(activeRunsTable.conversationId, feedbackId))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Longest a follow-up waits for the prior turn's cleanup to land. */
const FOLLOWUP_RUN_CLEAR_TIMEOUT_MS = 3_000;
/** How often `waitForRunToClear` re-checks the `active_runs` row. */
const FOLLOWUP_RUN_CLEAR_POLL_MS = 25;

/**
 * Wait (bounded) for any in-flight run for `feedbackId` to finish, polling
 * `hasActiveRun`. Returns true once it's clear, or false if the timeout
 * elapses with a run still active. Returns true immediately when nothing is
 * in flight — the common case — so this is cheap. See `runFollowUpTurn` for
 * why a follow-up tolerates a briefly-lingering run rather than bouncing it.
 */
async function waitForRunToClear(feedbackId: string, projectRoot: string): Promise<boolean> {
  const deadline = Date.now() + FOLLOWUP_RUN_CLEAR_TIMEOUT_MS;
  while (await hasActiveRun(feedbackId, projectRoot)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, FOLLOWUP_RUN_CLEAR_POLL_MS));
  }
  return true;
}

/**
 * Abort an in-flight run for `feedbackId`. Returns true if the run
 * either lives in this context (local abort) OR lives in some other
 * context in this process (cross-context signal sent via `process.emit`
 * — the owning context's listener will call `abort` on its
 * AbortController). Returns false if no SQLite row exists for an
 * active run, i.e. nothing was actually in flight.
 *
 * The SDK propagates the abort through its tool loop and exits the
 * iterator; `consumeStream` catches the abort error and writes a
 * minimal footer.
 */
export async function interruptRun(feedbackId: string, projectRoot?: string): Promise<boolean> {
  const local = activeRuns.get(feedbackId);
  if (local) {
    local.abort.abort();
    return true;
  }
  // Not local — was the run started in another context? Check SQLite.
  // We still emit the event regardless; the owning context's listener
  // will pick it up. SQLite check governs the return value so callers
  // (the WS error frame) can distinguish "no run at all" from "run
  // in a different context".
  const root = projectRoot ?? process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
  let exists = false;
  try {
    const db = getDb(root);
    const rows = await db
      .select()
      .from(activeRunsTable)
      .where(eq(activeRunsTable.conversationId, feedbackId))
      .limit(1);
    exists = rows.length > 0;
  } catch {
    exists = false;
  }
  if (!exists) return false;
  process.emit(INTERRUPT_EVENT as Parameters<typeof process.emit>[0], feedbackId as never);
  return true;
}

interface RunQueryOpts {
  projectRoot: string;
  feedbackId: string;
  cwd: string;
  logPath: string;
  prompt: string;
  isInitial: boolean;
  permissionMode: PermissionMode;
  resume?: string;
}

/**
 * Gate every new turn (initial spawn + follow-ups) on the cost caps in
 * the project's settings. The cap is breached when the *running total*
 * is already at or above the cap — that lets the first-ever turn run
 * freely (totalCostUsd starts at 0) but blocks the next turn once
 * spending has caught up.
 *
 * Returns `{ ok: true }` when within both caps, or `{ ok: false, reason }`
 * with a user-facing message. Callers emit the message on the bus so
 * every subscriber sees it, and refuse to actually start the turn.
 */
async function checkCostCaps(
  projectRoot: string,
  feedbackId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const settings = await new SettingsStore(projectRoot).read();
  const storage = new Storage(projectRoot);
  // On a `claude login` (OAuth) subscription the SDK reports notional
  // cost — billed against the subscription quota, never charged. The cap
  // still gates work (a proxy for "how much agent runtime to allow"), but
  // the breach message must not claim money was "spent". Mirrors the
  // dock's `isNotionalCost` relabeling.
  const notional = isNotionalCost(await storage.readApiKeySource(feedbackId));
  const conversationCost = await storage.computeConversationCost(feedbackId);
  if (conversationCost >= settings.perConversationCapUsd) {
    const spent = formatCapSpend(conversationCost, settings.perConversationCapUsd, notional);
    return {
      ok: false,
      reason: `per-conversation cost cap reached: ${spent}. Raise the cap in Settings or resolve this conversation.`,
    };
  }
  if (settings.monthlyBudgetUsd !== null) {
    const monthlySpend = await storage.computeMonthlySpend(new Date());
    if (monthlySpend >= settings.monthlyBudgetUsd) {
      const spent = formatCapSpend(monthlySpend, settings.monthlyBudgetUsd, notional);
      return {
        ok: false,
        reason: `monthly budget reached: ${spent} this month. Raise the budget in Settings.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Format the `<used> of <cap>` fragment of a cap-breach message. For
 * notional (subscription) runs the amount is API-equivalent and was never
 * billed, so we say so rather than "spent".
 */
function formatCapSpend(used: number, cap: number, notional: boolean): string {
  const usedUsd = `$${used.toFixed(2)}`;
  const capUsd = `$${cap.toFixed(2)}`;
  return notional
    ? `≈${usedUsd} of ${capUsd} API-equivalent (subscription — not billed)`
    : `${usedUsd} of ${capUsd} spent`;
}

async function runQuery(opts: RunQueryOpts): Promise<void> {
  const { permissionMode } = opts;
  const abort = new AbortController();
  activeRuns.set(opts.feedbackId, { abort });

  // Register the cross-context interrupt listener BEFORE awaiting
  // anything async, so an interrupt fired between `activeRuns.set` and
  // the next tick still reaches us.
  const onInterrupt = (id: string) => {
    if (id === opts.feedbackId) abort.abort();
  };
  process.on(INTERRUPT_EVENT, onInterrupt);

  // Record cross-context visibility into SQLite. Fire-and-forget — if the
  // INSERT lags slightly behind a follow-up `hasActiveRun` check the
  // window is tiny and the local-Map check covers same-context callers.
  void recordActiveRun(opts.projectRoot, opts.feedbackId);

  // Pick the agent backend (Claude Agent SDK by default, a wrapped CLI
  // when PINAGENT_AGENT_PROVIDER=cli). The provider owns the backend
  // specifics; consumeStream below treats its output uniformly.
  const provider = resolveProvider(process.env);
  const request: AgentRunRequest = {
    projectRoot: opts.projectRoot,
    feedbackId: opts.feedbackId,
    cwd: opts.cwd,
    prompt: opts.prompt,
    isInitial: opts.isInitial,
    permissionMode: permissionMode as AgentPermissionMode,
    resume: opts.resume,
    abortSignal: abort.signal,
  };

  try {
    await consumeStream(opts, provider.run(request));
  } finally {
    activeRuns.delete(opts.feedbackId);
    process.off(INTERRUPT_EVENT, onInterrupt);
    // Await (don't fire-and-forget) so the `active_runs` row is gone before
    // this run is considered finished — a follow-up the widget flushes off
    // this turn's `result` then sees a clear slot instead of racing the
    // delete. `waitForRunToClear` still absorbs any residual lag.
    await clearActiveRun(opts.projectRoot, opts.feedbackId);
    // Any ask_user calls still hanging die with the run; otherwise the
    // SDK Promise would wait until ASK_TTL with no UI to answer.
    rejectAsk(opts.feedbackId, 'agent run ended');
    // NOTE: we intentionally do NOT call finishBus here. The bus persists
    // across turns within a single feedback conversation so follow-up
    // events keep flowing to the same WS subscribers. The widget knows
    // each turn ended from the `result` event it emits.
  }
}

/**
 * Drive one provider run: publish its events to the bus, append its log
 * chunks to the transcript, persist the session id, and finalize the
 * resolution block. Provider-neutral — every backend funnels through the
 * same `ProviderRunItem` stream, so cost/session/status handling is shared.
 */
async function consumeStream(
  opts: RunQueryOpts,
  stream: AsyncIterable<import('./providers').ProviderRunItem>,
): Promise<void> {
  let sessionRecorded = false;
  let resultRendered = false;
  const bus = getOrCreateBus(opts.feedbackId);

  try {
    for await (const item of stream) {
      if (!sessionRecorded && item.sessionId) {
        sessionRecorded = true;
        await persistSessionId(opts.projectRoot, opts.feedbackId, item.sessionId);
      }

      for (const ev of item.events ?? []) await bus.publish(ev);

      if (item.isResult) {
        resultRendered = true;
        if (item.log) await appendLog(opts.logPath, item.log);
        if (opts.isInitial) {
          await appendResolution(
            opts.projectRoot,
            opts.feedbackId,
            opts.logPath,
            item.resultFooter ?? null,
          );
        } else if (item.resultFooter) {
          await appendLog(opts.logPath, `\n${item.resultFooter}\n`);
        }
        // If the agent flipped this feedback out of `pending` (e.g. via the
        // MCP `resolve_feedback` tool), fan that out to the widget so its
        // cache catches up immediately instead of waiting on a reload-time
        // scan. The MCP server lives in a child process, so its SQLite
        // write doesn't trigger our in-process project-events bus — we
        // re-emit `conversations_changed` here to invalidate the dock's
        // list/Changes/History caches.
        try {
          const storage = new Storage(opts.projectRoot);
          const rec = await storage.read(opts.feedbackId);
          if (rec && rec.status !== 'pending') {
            await bus.publish({
              type: 'status_changed',
              status: rec.status,
              note: rec.note,
              commitSha: rec.commitSha,
              resolvedAt: rec.resolvedAt,
            });
            emitProjectChange({ type: 'conversations_changed' });
          }
        } catch {
          // Status sync is best-effort — the widget's terminal-event
          // handler (on 'result') already covers the common cases.
        }
        continue;
      }

      if (item.log) await appendLog(opts.logPath, item.log);
    }
  } catch (err) {
    const msg = stringifyErr(err);
    await bus.publish({ type: 'error', message: msg });
    await appendLog(opts.logPath, `\n> [pinagent] agent stream errored: ${msg}\n`);
  } finally {
    if (!resultRendered && opts.isInitial) {
      // Initial runs always get a resolution block, even on abort, so the
      // log doesn't end mid-stream. Follow-ups don't (the initial block
      // was already written).
      await appendResolution(opts.projectRoot, opts.feedbackId, opts.logPath, null);
    }
  }
}

async function persistSessionId(
  projectRoot: string,
  feedbackId: string,
  sessionId: string,
): Promise<void> {
  try {
    const storage = new Storage(projectRoot);
    await storage.patch(feedbackId, { agentSessionId: sessionId });
  } catch {
    // Best-effort; the feedback record may have been deleted.
  }
}

function stringifyErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function renderHeader(
  ctx: AgentContext,
  cwd: string,
  startedAt: string,
  worktreeReady: boolean,
): string {
  const rec = ctx.feedback;
  const where = rec.file
    ? `${rec.file}:${rec.line ?? '?'}${rec.col != null ? `:${rec.col}` : ''}`
    : rec.selector;
  const branchLine = ctx.mode === 'worktree' && worktreeReady ? `branch: pinagent/${rec.id}\n` : '';

  return [
    '---',
    `id: ${rec.id}`,
    `mode: ${ctx.mode}`,
    `target: ${where}`,
    `url: ${rec.url}`,
    `started: ${startedAt}`,
    `cwd: ${cwd}`,
    branchLine.trimEnd(),
    '---',
    '',
    `# Pinagent feedback \`${rec.id}\``,
    '',
    `**Target:** \`${where}\`  `,
    `**URL:** ${rec.url}  `,
    `**Mode:** ${ctx.mode}${ctx.mode === 'worktree' && worktreeReady ? `  ·  **Branch:** \`pinagent/${rec.id}\`` : ''}`,
    '',
    '> **Comment**',
    '> ',
    `> ${rec.comment.split('\n').join('\n> ')}`,
    '',
    '## Agent output',
    '',
    '',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

async function appendResolution(
  projectRoot: string,
  feedbackId: string,
  logPath: string,
  footer: string | null,
): Promise<void> {
  const storage = new Storage(projectRoot);
  const updated = await storage.read(feedbackId);
  const finishedAt = new Date().toISOString();

  const lines: string[] = [];
  lines.push('');
  lines.push('## Resolution');
  lines.push('');
  lines.push(`**Finished:** ${finishedAt}  `);

  if (footer) {
    lines.push(footer);
  } else {
    lines.push('> Stream ended without a `result` message.');
  }

  if (!updated) {
    lines.push('');
    lines.push('> Feedback record disappeared between spawn and exit.');
  } else {
    lines.push(`**Status:** \`${updated.status}\``);
    if (updated.resolvedAt) {
      lines.push(`**Resolved at:** ${updated.resolvedAt}`);
    }
    if (updated.commitSha) {
      lines.push(`**Commit:** \`${updated.commitSha}\``);
    }
    if (updated.agentSessionId) {
      lines.push(`**Session:** \`${updated.agentSessionId}\``);
    }
    if (updated.note) {
      lines.push('');
      lines.push('### Note from agent');
      lines.push('');
      lines.push(updated.note);
    }
    if (updated.status === 'pending') {
      lines.push('');
      lines.push(
        '> ⚠️  Agent exited without calling `resolve_feedback`. The record is still pending.',
      );
    }
  }
  lines.push('');

  await appendLog(logPath, lines.join('\n'));
}

function buildInitialPrompt(rec: FeedbackRecord, mode: SpawnAgentMode, cwd: string): string {
  const where = rec.file
    ? `${rec.file}:${rec.line ?? '?'}${rec.col != null ? `:${rec.col}` : ''}`
    : rec.selector;

  const worktreeContext =
    mode === 'worktree'
      ? [
          '',
          'You are working in a FRESH git worktree at:',
          `  ${cwd}`,
          `on branch pinagent/${rec.id} (forked from current HEAD).`,
          '',
          'Make edits freely. DO NOT commit — the developer will review your',
          'changes by diffing this branch against main.',
        ].join('\n')
      : '';

  const componentLine = rec.component ? `Component: <${rec.component}>` : '';
  const componentPathLine =
    rec.componentPath && rec.componentPath.length > 1
      ? `Component path: ${rec.componentPath.join(' › ')}`
      : '';
  // When the target's file:line is shared by several rendered instances
  // (a `.map()`), the bare location is ambiguous. Tell the agent which
  // instance was clicked and how to recognise it, so it edits the right
  // list item rather than the first match.
  const instanceNote =
    rec.instanceTotal && rec.instanceTotal > 1
      ? [
          '',
          `Heads up: this target's source location is rendered ${rec.instanceTotal} times`,
          `(likely a list/.map()). The developer clicked instance #${
            (rec.instanceIndex ?? 0) + 1
          } of ${rec.instanceTotal}.`,
          rec.instanceFingerprint ? `That instance's content: ${rec.instanceFingerprint}` : '',
          `The file:line points at the *shared* JSX literal — edit there, but use the`,
          `screenshot and the content above to act on the correct item if the change is`,
          `instance-specific (e.g. its data source) rather than the markup itself.`,
        ]
          .filter((l) => l !== '')
          .join('\n')
      : '';

  return [
    'A developer submitted Pinagent feedback. Address it autonomously.',
    '',
    `Feedback id: ${rec.id}`,
    `Target: ${where}`,
    componentLine,
    componentPathLine,
    `Comment: "${rec.comment.replace(/\s+/g, ' ').slice(0, 200)}"`,
    instanceNote,
    worktreeContext,
    '',
    'Workflow:',
    '  1. Call the pinagent MCP tool `get_feedback` with the id above —',
    '     it returns the full comment plus a screenshot of what the user',
    '     selected.',
    '  2. Optionally call `get_source_context` to see code around the target.',
    '  3. Edit the file(s) to address the request. Be conservative: only',
    '     change what the comment asks for.',
    '  4. Call `resolve_feedback` with status="fixed" and a one-sentence',
    '     note describing what you changed. Use status="wontfix" with a',
    '     reason if you cannot apply the change.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}
