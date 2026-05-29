// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Options,
  type PermissionMode,
  query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { activeRuns as activeRunsTable } from '@pinagent/db';
import { type AgentEvent, isNotionalCost } from '@pinagent/shared';
import { eq } from 'drizzle-orm';
import {
  renderInitFooter,
  renderMessage,
  renderResultFooter,
  summariseToolInput,
} from './agent-render';
import { ASK_USER_TOOL_NAME, createAskUserMcpServer, rejectAsk } from './ask-user';
import { recordAuditEvent } from './audit-log';
import { getOrCreateBus } from './bus';
import { getDb } from './db/client';
import { runGitCapture } from './git-utils';
import { emitProjectChange } from './project-events';
import { SecretsStore } from './secrets-store';
import {
  PROJECT_PERMISSION_MODES,
  type PermissionMode as ProjectPermissionMode,
  SettingsStore,
} from './settings-store';
import { type FeedbackRecord, Storage } from './storage';

/**
 * @pinagent/mcp tool names the spawned agent needs to do its job:
 *
 * - `get_feedback`         — fetch the full feedback record incl. screenshot
 * - `resolve_feedback`     — mark fixed/wontfix/deferred when done
 * - `get_source_context`   — read a window of source around file:line
 * - `list_pending_feedback`— rarely needed by a spawned agent (it knows its
 *                            own id), included for parity with pull mode
 *
 * They are surfaced to the SDK via the user's `.mcp.json` (loaded by
 * `settingSources: ['user', 'project', 'local']`). Allowlisting them
 * makes the spawned agent auto-accept the calls instead of timing out
 * waiting for a non-existent permission prompt.
 */
const PINAGENT_MCP_TOOLS = [
  'mcp__pinagent__get_feedback',
  'mcp__pinagent__resolve_feedback',
  'mcp__pinagent__get_source_context',
  'mcp__pinagent__list_pending_feedback',
];

export type SpawnAgentMode = 'worktree' | 'inline' | false;

/**
 * Resolve the spawn mode from env. The new default (V2) is `'inline'` —
 * SDK-backed per-submit agent with streaming back to the widget. Worktree
 * mode is opt-in; `'off'` (or the legacy `'false'`) disables spawning so
 * channel-mode / pull-mode setups don't get a redundant agent per submit.
 */
export function resolveAgentMode(env: NodeJS.ProcessEnv): SpawnAgentMode {
  const v = env.PINAGENT_SPAWN_AGENT;
  if (v === 'worktree') return 'worktree';
  if (v === 'off' || v === 'false') return false;
  // 'inline', unset, or any unrecognised value falls through to the V2 default.
  return 'inline';
}

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
 * Refuses if there's no prior session (the feedback was never spawn-mode)
 * or a turn is already in flight (no input queueing yet).
 */
export async function runFollowUpTurn(feedbackId: string, content: string): Promise<void> {
  const projectRoot = process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
  if (await hasActiveRun(feedbackId, projectRoot)) {
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
 * Resolve the SDK permission mode for a run. Precedence:
 *   `PINAGENT_AGENT_PERMISSION_MODE` env override > project settings
 *   (`.pinagent/config.json` permissionMode) > default.
 * The env override is kept so CI / power users can bypass the dock UI
 * without editing the settings file.
 */
async function resolveRunPermissionMode(projectRoot: string): Promise<PermissionMode> {
  const override = resolvePermissionModeOverride(process.env);
  if (override) return override;
  const settings = await new SettingsStore(projectRoot).read();
  return toSdkPermissionMode(settings.permissionMode);
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

  // The `ask_user` tool can block for up to 10 min waiting for a human
  // response. SDK MCP tool calls time out at 60s by default; bump it to
  // ~12 min to cover the full ASK_TTL window in ask-user.ts.
  const env: Record<string, string | undefined> = {
    ...process.env,
    PINAGENT_PROJECT_ROOT: opts.projectRoot,
    CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '720000',
  };

  // Dock-stored Anthropic key (set via Connections route) wins over an
  // existing env var so the user can override CI-style auth without
  // restarting the dev-server. No-op when the user hasn't set one.
  const storedKey = await new SecretsStore(opts.projectRoot).getAnthropicKey();
  if (storedKey) env.ANTHROPIC_API_KEY = storedKey;

  const sdkOptions: Options = {
    cwd: opts.cwd,
    permissionMode,
    env,
    settingSources: ['user', 'project', 'local'],
    abortController: abort,
    mcpServers: {
      'pinagent-ask-user': createAskUserMcpServer(opts.feedbackId),
    },
    allowedTools: [ASK_USER_TOOL_NAME, ...PINAGENT_MCP_TOOLS],
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: [
        '',
        'You are running inside Pinagent, a tool that lets developers click a UI',
        'element in the browser and leave a comment for you to act on. The user',
        'is watching your output stream into a small widget pane next to the',
        'element they clicked.',
        '',
        `If you need clarification mid-task, call the \`${ASK_USER_TOOL_NAME}\``,
        'tool with a clear question (and optional `options` for closed-ended',
        'answers). Prefer asking over guessing on ambiguous requirements.',
      ].join('\n'),
    },
  };
  if (opts.resume) sdkOptions.resume = opts.resume;

  try {
    await consumeStream(opts, sdkOptions);
  } finally {
    activeRuns.delete(opts.feedbackId);
    process.off(INTERRUPT_EVENT, onInterrupt);
    void clearActiveRun(opts.projectRoot, opts.feedbackId);
    // Any ask_user calls still hanging die with the run; otherwise the
    // SDK Promise would wait until ASK_TTL with no UI to answer.
    rejectAsk(opts.feedbackId, 'agent run ended');
    // NOTE: we intentionally do NOT call finishBus here. The bus persists
    // across turns within a single feedback conversation so follow-up
    // events keep flowing to the same WS subscribers. The widget knows
    // each turn ended from the `result` event it emits.
  }
}

async function consumeStream(opts: RunQueryOpts, sdkOptions: Options): Promise<void> {
  let sessionId: string | null = null;
  let sessionRecorded = false;
  let resultRendered = false;
  // Live turn counter for this run. Each `assistant` SDK message is one
  // model turn, so we count them and publish a `progress` event the
  // widget can surface in real time. Resets per run (a follow-up starts
  // its own consumeStream), matching the per-run `numTurns` the SDK
  // reports on the terminal `result` message.
  let turn = 0;
  const bus = getOrCreateBus(opts.feedbackId);

  try {
    for await (const message of query({
      prompt: opts.prompt,
      options: sdkOptions,
    }) as AsyncIterable<SDKMessage>) {
      if (!sessionId && 'session_id' in message && typeof message.session_id === 'string') {
        sessionId = message.session_id;
      }
      if (!sessionRecorded && sessionId) {
        sessionRecorded = true;
        await persistSessionId(opts.projectRoot, opts.feedbackId, sessionId);
      }

      for (const ev of toAgentEvents(message)) await bus.publish(ev);

      // One assistant message = one model turn. Publish the running
      // count so the widget's footer ticks up live, ahead of the
      // authoritative `numTurns` on the final `result`.
      if (message.type === 'assistant') {
        turn += 1;
        await bus.publish({ type: 'progress', turn });
      }

      if (message.type === 'system' && message.subtype === 'init') {
        await appendLog(opts.logPath, renderInitFooter(message));
        continue;
      }

      if (message.type === 'result') {
        resultRendered = true;
        await appendLog(opts.logPath, renderMessage(message));
        if (opts.isInitial) {
          await appendResolution(opts.projectRoot, opts.feedbackId, opts.logPath, message);
        } else {
          await appendLog(opts.logPath, `\n${renderResultFooter(message)}\n`);
        }
        // If the agent flipped this feedback out of `pending` via the
        // MCP `resolve_feedback` tool, fan that out to the widget so
        // its cache catches up immediately instead of waiting on a
        // reload-time scan. The MCP server lives in a child process, so
        // its SQLite write doesn't trigger our in-process project-events
        // bus — we re-emit `conversations_changed` here to invalidate
        // the dock's list/Changes/History caches.
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

      const chunk = renderMessage(message);
      if (chunk) await appendLog(opts.logPath, chunk);
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

function toAgentEvents(message: SDKMessage): AgentEvent[] {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') {
        return [
          {
            type: 'init',
            sessionId: message.session_id,
            model: message.model,
            permissionMode: message.permissionMode,
            apiKeySource: message.apiKeySource,
          },
        ];
      }
      return [];
    case 'assistant': {
      const out: AgentEvent[] = [];
      const blocks = message.message?.content;
      if (!Array.isArray(blocks)) return out;
      for (const block of blocks) {
        if (block.type === 'text' && block.text.trim()) {
          out.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          // ask_user calls are surfaced by the tool handler itself (it
          // publishes an 'ask_user' event with the question). Suppress
          // the bare tool_use chip so the widget doesn't render a
          // duplicate "[ask_user]" line alongside the form.
          if (block.name === ASK_USER_TOOL_NAME) continue;
          out.push({
            type: 'tool_use',
            name: block.name,
            summary: summariseToolInput(block.name, block.input),
          });
        }
      }
      if (message.error) {
        out.push({ type: 'error', message: `assistant error: ${message.error}` });
      }
      return out;
    }
    case 'user': {
      const out: AgentEvent[] = [];
      const blocks = message.message?.content;
      if (!Array.isArray(blocks)) return out;
      for (const block of blocks) {
        if (
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: string }).type === 'tool_result'
        ) {
          out.push({ type: 'tool_result', ok: !(block as { is_error?: boolean }).is_error });
        }
      }
      return out;
    }
    case 'result': {
      const event: AgentEvent = {
        type: 'result',
        subtype: message.subtype,
        numTurns: message.num_turns,
        totalCostUsd: message.total_cost_usd,
        durationMs: message.duration_ms,
      };
      if (message.subtype !== 'success' && Array.isArray(message.errors)) {
        event.errors = message.errors;
      }
      return [event];
    }
    default:
      return [];
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

async function createWorktree(
  projectRoot: string,
  feedbackId: string,
  logPath: string,
): Promise<string> {
  if (!existsSync(join(projectRoot, '.git'))) {
    throw new Error('project root is not a git repository');
  }

  const worktreeDir = join(projectRoot, '.pinagent', 'worktrees');
  await mkdir(worktreeDir, { recursive: true });
  const worktreePath = join(worktreeDir, feedbackId);
  const branch = `pinagent/${feedbackId}`;

  await runGit(projectRoot, ['worktree', 'add', '-b', branch, worktreePath], logPath);

  // Persist so the widget can read `worktreeState='active'` and surface
  // Land/Discard controls without polling the filesystem, and so a TTL
  // sweep on next startup can find this row.
  try {
    const storage = new Storage(projectRoot);
    await storage.patch(feedbackId, {
      branch,
      worktreePath,
      worktreeState: 'active',
    });
  } catch {
    // Best-effort. The worktree is real on disk regardless; the widget
    // can recover state from the next reload via the full record.
  }

  return worktreePath;
}

export interface LandResult {
  ok: boolean;
  /** Merge commit sha on success. */
  commitSha?: string;
  /** Conflicted files when `ok` is false because of a merge conflict. */
  conflicts?: string[];
  /** Human-readable failure reason when `ok` is false for any other cause. */
  error?: string;
}

/**
 * Land the agent's worktree onto the project's current HEAD branch.
 *
 * The agent intentionally does not commit (see `buildInitialPrompt`) so the
 * developer can review the diff before landing; we stage and commit on its
 * behalf as a single squash here. On merge conflict the merge is aborted —
 * the worktree is left intact so the user can resolve manually and retry.
 *
 * Should be called via `merge-queue.ts` so concurrent landings on the same
 * project serialize cleanly.
 */
export async function mergeWorktree(
  projectRoot: string,
  feedbackId: string,
  logPath: string,
): Promise<LandResult> {
  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) return { ok: false, error: `feedback not found: ${feedbackId}` };
  if (!rec.worktreePath || !rec.branch) {
    return {
      ok: false,
      error: 'this conversation has no worktree (inline-mode submission)',
    };
  }
  if (rec.worktreeState !== 'active') {
    return { ok: false, error: `cannot land: worktree state is ${rec.worktreeState}` };
  }
  if (!existsSync(rec.worktreePath)) {
    return { ok: false, error: `worktree no longer exists at ${rec.worktreePath}` };
  }
  if (!existsSync(join(projectRoot, '.git'))) {
    return { ok: false, error: 'project root is not a git repository' };
  }

  await appendLog(logPath, `\n## Land · ${new Date().toISOString()}\n\n`);

  const head = await runGitCapture(projectRoot, ['symbolic-ref', '--short', 'HEAD']);
  if (head.code !== 0) {
    return {
      ok: false,
      error: `cannot resolve project HEAD branch (detached?): ${head.stderr.trim()}`,
    };
  }
  const targetBranch = head.stdout.trim();
  if (targetBranch === rec.branch) {
    return { ok: false, error: `project HEAD is already on ${rec.branch}; nothing to land` };
  }

  // Commit any uncommitted edits on the worktree's branch. The agent
  // leaves work uncommitted by design; landing = "accept these changes".
  const status = await runGitCapture(rec.worktreePath, ['status', '--porcelain']);
  if (status.code !== 0) {
    return { ok: false, error: `git status failed in worktree: ${status.stderr.trim()}` };
  }
  if (status.stdout.trim()) {
    const add = await runGitCapture(rec.worktreePath, ['add', '-A']);
    if (add.code !== 0) {
      return { ok: false, error: `git add failed: ${add.stderr.trim()}` };
    }
    const commit = await runGitCapture(rec.worktreePath, [
      'commit',
      '-m',
      formatLandCommitMessage(rec),
    ]);
    if (commit.code !== 0) {
      const combined = `${commit.stdout}\n${commit.stderr}`;
      if (!/nothing to commit/.test(combined)) {
        return {
          ok: false,
          error: `git commit failed: ${commit.stderr.trim() || commit.stdout.trim()}`,
        };
      }
    }
  }

  // No-op if the branch has nothing diverging from target (agent made
  // no changes). Still treat as landed so the UI clears the controls.
  const ahead = await runGitCapture(projectRoot, [
    'rev-list',
    '--count',
    `${targetBranch}..${rec.branch}`,
  ]);
  if (ahead.code !== 0) {
    return { ok: false, error: `cannot compare branches: ${ahead.stderr.trim()}` };
  }
  if (Number(ahead.stdout.trim()) === 0) {
    await appendLog(logPath, '> [pinagent] no changes to land\n');
    await cleanupWorktreeFiles(rec.worktreePath, rec.branch, projectRoot, logPath);
    await storage.patch(feedbackId, { worktreeState: 'landed' });
    await recordAuditEvent(projectRoot, {
      conversationId: feedbackId,
      actor: 'user',
      action: 'conversation_landed',
      payload: { branch: rec.branch, target: targetBranch, noop: true },
    });
    return { ok: true };
  }

  const merge = await runGitCapture(projectRoot, ['merge', '--no-ff', '--no-edit', rec.branch]);
  if (merge.code !== 0) {
    const conflicted = await runGitCapture(projectRoot, ['diff', '--name-only', '--diff-filter=U']);
    const conflicts = conflicted.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    await runGitCapture(projectRoot, ['merge', '--abort']);
    await appendLog(
      logPath,
      `> [pinagent] merge into \`${targetBranch}\` failed: ${conflicts.length} conflicted file(s)\n${conflicts.map((c) => `>   - \`${c}\`\n`).join('')}\n`,
    );
    return { ok: false, conflicts };
  }

  const sha = await runGitCapture(projectRoot, ['rev-parse', 'HEAD']);
  const commitSha = sha.code === 0 ? sha.stdout.trim() : undefined;

  await cleanupWorktreeFiles(rec.worktreePath, rec.branch, projectRoot, logPath);
  await storage.patch(feedbackId, {
    worktreeState: 'landed',
    ...(commitSha ? { commitSha } : {}),
  });
  await recordAuditEvent(projectRoot, {
    conversationId: feedbackId,
    actor: 'user',
    action: 'conversation_landed',
    payload: {
      branch: rec.branch,
      target: targetBranch,
      ...(commitSha ? { commitSha } : {}),
    },
  });

  await appendLog(
    logPath,
    `> [pinagent] landed onto \`${targetBranch}\`${commitSha ? ` as \`${commitSha.slice(0, 12)}\`` : ''}\n`,
  );

  return { ok: true, ...(commitSha ? { commitSha } : {}) };
}

/**
 * Reverse a landed/discarded conversation: put it back in the active
 * list so the user can follow up with the agent. We reset
 * `worktreeState` to `'none'` and `status` to `'pending'`; we do NOT
 * recreate the worktree (it was cleaned up at land/discard time and
 * the developer's actual changes have either already merged or were
 * thrown away). For inline-mode runs that's all that's needed — the
 * user can immediately send a follow-up. For ex-worktree runs the
 * conversation is conceptually inline-mode from this point forward.
 *
 * Refuses on conversations that aren't already resolved so a stray
 * client click can't reset a still-active worktree.
 */
export async function reopenConversation(
  projectRoot: string,
  feedbackId: string,
  logPath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) return { ok: false, error: `feedback not found: ${feedbackId}` };
  if (rec.worktreeState !== 'landed' && rec.worktreeState !== 'discarded') {
    return {
      ok: false,
      error: `cannot reopen: worktree state is ${rec.worktreeState} (expected landed or discarded)`,
    };
  }

  await appendLog(logPath, `\n## Reopen · ${new Date().toISOString()}\n\n`);
  await storage.patch(feedbackId, { worktreeState: 'none', status: 'pending' });
  await recordAuditEvent(projectRoot, {
    conversationId: feedbackId,
    actor: 'user',
    action: 'conversation_reopened',
    payload: {
      previousWorktreeState: rec.worktreeState,
      previousStatus: rec.status,
    },
  });
  return { ok: true };
}

export interface BulkReopenResult {
  /** Conversation ids that flipped back to pending/none. */
  reopened: string[];
  /** Ids the storage layer couldn't reopen (not landed/discarded, missing, etc). */
  failed: { feedbackId: string; error: string }[];
}

/**
 * Bulk re-open a batch of resolved conversations from the History
 * view's multi-select. Each id goes through the existing per-row
 * `reopenConversation` so the worktree-state flip + per-row
 * `conversation_reopened` audit emission stay intact; this function
 * adds ONE summary `conversations_bulk_reopened` event covering the
 * batch.
 */
export async function reopenConversations(
  projectRoot: string,
  feedbackIds: string[],
): Promise<BulkReopenResult> {
  const reopened: string[] = [];
  const failed: { feedbackId: string; error: string }[] = [];

  for (const id of feedbackIds) {
    const logPath = join(projectRoot, '.pinagent', 'logs', `${id}.md`);
    await mkdir(join(projectRoot, '.pinagent', 'logs'), { recursive: true });
    try {
      const result = await reopenConversation(projectRoot, id, logPath);
      if (result.ok) reopened.push(id);
      else failed.push({ feedbackId: id, error: result.error });
    } catch (e) {
      failed.push({ feedbackId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (reopened.length > 0) {
    await recordAuditEvent(projectRoot, {
      conversationId: null,
      actor: 'user',
      action: 'conversations_bulk_reopened',
      payload: { ids: reopened, count: reopened.length },
    });
  }

  return { reopened, failed };
}

/**
 * Throw away the worktree and its branch without merging. Idempotent —
 * tolerates a missing worktree or branch (the user may have cleaned
 * them up manually).
 */
export async function discardWorktree(
  projectRoot: string,
  feedbackId: string,
  logPath: string,
): Promise<{ ok: true }> {
  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) return { ok: true };

  await appendLog(logPath, `\n## Discard · ${new Date().toISOString()}\n\n`);

  if (rec.worktreePath && rec.branch) {
    await cleanupWorktreeFiles(rec.worktreePath, rec.branch, projectRoot, logPath);
  }
  await storage.patch(feedbackId, { worktreeState: 'discarded' });
  await recordAuditEvent(projectRoot, {
    conversationId: feedbackId,
    actor: 'user',
    action: 'conversation_discarded',
    payload: rec.branch ? { branch: rec.branch } : {},
  });
  return { ok: true };
}

/**
 * Diff summary for a worktree vs a base ref. Used by the dock's Changes
 * view to render filesChanged / additions / deletions per conversation
 * without the dock having to learn git itself.
 *
 * `filesChanged` includes both committed and uncommitted changes (we
 * `git add -A` mentally — the worktree-state machine will commit them
 * during `mergeWorktree` anyway, so showing them as part of the diff
 * matches what `Land` will produce).
 *
 * Returns null when the worktree path doesn't exist or git fails. The
 * caller treats that as "unknown" and omits the row from the changes
 * list rather than showing zeroes.
 */
export interface WorktreeStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export async function computeWorktreeStats(
  worktreePath: string,
  baseRef: string,
): Promise<WorktreeStats | null> {
  if (!existsSync(worktreePath)) return null;
  // `--shortstat` gives us the one-line summary we want, e.g.
  //   " 3 files changed, 27 insertions(+), 9 deletions(-)"
  // Compare against the merge-base of baseRef so renames + cherry-picks
  // count once. Fall back to a plain diff against baseRef if merge-base
  // can't be computed (worktree was created off a branch that's since
  // been deleted, etc).
  const mb = await runGitCapture(worktreePath, ['merge-base', baseRef, 'HEAD']);
  const compareTo = mb.code === 0 ? mb.stdout.trim() : baseRef;
  // Include both committed (`HEAD..compareTo` semantics) and the working
  // tree by passing only `compareTo` — `git diff <ref>` diffs the
  // working tree against <ref>, picking up uncommitted edits too.
  const diff = await runGitCapture(worktreePath, ['diff', '--shortstat', compareTo]);
  if (diff.code !== 0) return null;
  const line = diff.stdout.trim();
  if (!line) return { filesChanged: 0, additions: 0, deletions: 0 };
  return parseShortStat(line);
}

/**
 * One-line preview of the first changed hunk for a worktree. Drives
 * the dock's Changes list row, which renders this as a truncated
 * monospace line under the stats. Returns '' for worktrees with no
 * changes (or only binary/rename-only diffs that don't have a
 * `+`/`-` content line to surface).
 */
const PREVIEW_MAX_CHARS = 140;
export async function computeWorktreePreview(
  worktreePath: string,
  baseRef: string,
): Promise<string> {
  if (!existsSync(worktreePath)) return '';
  const mb = await runGitCapture(worktreePath, ['merge-base', baseRef, 'HEAD']);
  const compareTo = mb.code === 0 ? mb.stdout.trim() : baseRef;
  // `--unified=0` strips context lines so the first content line we see
  // is an actual change. Capped via `--stat-count` equivalents — we don't
  // need the whole diff, just enough to find the first `+`/`-` line.
  // `git diff` doesn't have a head-style flag, so we rely on the early
  // return below to stop scanning once we have a hit.
  const result = await runGitCapture(worktreePath, [
    'diff',
    '--no-color',
    '--unified=0',
    compareTo,
  ]);
  if (result.code !== 0) return '';
  for (const line of result.stdout.split('\n')) {
    // Skip diff headers (--- a/x, +++ b/x) and metadata. Real content
    // lines are exactly one `+` or `-` followed by the source.
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (!line.startsWith('+') && !line.startsWith('-')) continue;
    const trimmed =
      line.length > PREVIEW_MAX_CHARS ? `${line.slice(0, PREVIEW_MAX_CHARS - 1)}…` : line;
    return trimmed;
  }
  return '';
}

export interface WorktreeDiff {
  /** Unified diff text. Possibly truncated — see `truncated`. */
  diff: string;
  /** True when the source diff exceeded the cap and `diff` was cut short. */
  truncated: boolean;
}

/**
 * Capture the full unified diff of a worktree against its base ref —
 * the data the Changes view's expand-to-diff UI renders. Capped at a
 * generous-but-bounded size so an accidental megabyte of churn doesn't
 * lock up the dock when the user expands a row.
 *
 * Mirrors `computeWorktreeStats`'s base-resolution shape so the diff
 * and the stats line up for any given conversation.
 */
const DIFF_CAP_BYTES = 512 * 1024;

export async function computeWorktreeDiff(
  worktreePath: string,
  baseRef: string,
): Promise<WorktreeDiff | null> {
  if (!existsSync(worktreePath)) return null;
  const mb = await runGitCapture(worktreePath, ['merge-base', baseRef, 'HEAD']);
  const compareTo = mb.code === 0 ? mb.stdout.trim() : baseRef;
  const result = await runGitCapture(worktreePath, ['diff', '--no-color', compareTo]);
  if (result.code !== 0) return null;
  if (result.stdout.length <= DIFF_CAP_BYTES) {
    return { diff: result.stdout, truncated: false };
  }
  // Truncate on a line boundary so the renderer never sees a half-hunk.
  const cut = result.stdout.lastIndexOf('\n', DIFF_CAP_BYTES);
  return {
    diff: result.stdout.slice(0, cut >= 0 ? cut : DIFF_CAP_BYTES),
    truncated: true,
  };
}

function parseShortStat(line: string): WorktreeStats {
  // Format: " N files changed, X insertions(+), Y deletions(-)"
  // Any of files/insertions/deletions can be missing if zero.
  const files = /(\d+)\s+files?\s+changed/.exec(line);
  const ins = /(\d+)\s+insertions?\(\+\)/.exec(line);
  const del = /(\d+)\s+deletions?\(-\)/.exec(line);
  return {
    filesChanged: files ? Number(files[1]) : 0,
    additions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}

/**
 * Count files with uncommitted changes in a worktree (`git status --porcelain`
 * line count). Returns `null` if the worktree path doesn't exist or `git`
 * fails — the caller treats that as "unknown" rather than zero, so the widget
 * can omit the count from its label instead of showing a misleading "0 changes".
 */
export async function countWorktreeChanges(worktreePath: string): Promise<number | null> {
  if (!existsSync(worktreePath)) return null;
  const status = await runGitCapture(worktreePath, ['status', '--porcelain']);
  if (status.code !== 0) return null;
  const trimmed = status.stdout.trim();
  if (!trimmed) return 0;
  return trimmed.split('\n').length;
}

async function cleanupWorktreeFiles(
  worktreePath: string,
  branch: string,
  projectRoot: string,
  logPath: string,
): Promise<void> {
  if (existsSync(worktreePath)) {
    const rm = await runGitCapture(projectRoot, ['worktree', 'remove', '--force', worktreePath]);
    if (rm.code !== 0) {
      await appendLog(
        logPath,
        `> [pinagent:git] worktree remove → exit ${rm.code}\n${rm.stderr}\n`,
      );
    }
  }
  // Even if `worktree remove` succeeded, prune so `git worktree list`
  // doesn't show stale entries when the directory was already gone.
  await runGitCapture(projectRoot, ['worktree', 'prune']);

  const br = await runGitCapture(projectRoot, ['branch', '-D', branch]);
  if (br.code !== 0 && !/not found|did not match/i.test(br.stderr)) {
    await appendLog(
      logPath,
      `> [pinagent:git] branch -D ${branch} → exit ${br.code}\n${br.stderr}\n`,
    );
  }
}

function formatLandCommitMessage(rec: FeedbackRecord): string {
  const firstLine = rec.comment.split(/\r?\n/)[0]?.trim() ?? '';
  const subject = firstLine.length > 70 ? `${firstLine.slice(0, 67)}…` : firstLine;
  const where = rec.file
    ? `${rec.file}:${rec.line ?? '?'}${rec.col != null ? `:${rec.col}` : ''}`
    : rec.selector;
  return [
    `pinagent: ${subject || 'agent edit'}`,
    '',
    'Landed via pinagent.',
    '',
    `Feedback: ${rec.id}`,
    `Target:   ${where}`,
    '',
  ].join('\n');
}

function runGit(cwd: string, args: string[], logPath: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn('git', args, { cwd, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', rej);
    child.on('exit', (code) => {
      if (code === 0) {
        res();
      } else {
        appendLog(
          logPath,
          `[pinagent:git] git ${args.join(' ')} → exit ${code}\n${stderr}\n`,
        ).catch(() => {});
        rej(new Error(`git ${args.join(' ')} exited ${code}: ${stderr.trim()}`));
      }
    });
  });
}

// `runGitCapture` and its `GitCapture` type now live in ./git-utils so
// changes.ts (and the future PR-composer module) can share them
// without pulling in agent.ts's heavy SDK imports.

async function appendLog(path: string, text: string): Promise<void> {
  if (!text) return;
  const h = await open(path, 'a');
  try {
    await h.write(text);
  } finally {
    await h.close();
  }
}

function stringifyErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function resolvePermissionMode(env: NodeJS.ProcessEnv): PermissionMode {
  const v = env.PINAGENT_AGENT_PERMISSION_MODE;
  if (
    v === 'default' ||
    v === 'acceptEdits' ||
    v === 'bypassPermissions' ||
    v === 'plan' ||
    v === 'dontAsk' ||
    v === 'auto'
  ) {
    return v;
  }
  return 'acceptEdits';
}

/**
 * The active env override for permission mode, or `null` when no
 * override is set. Different shape from `resolvePermissionMode`, which
 * falls back to `'acceptEdits'` whether the env was unset or invalid —
 * callers that need to distinguish "no override" from "override → some
 * mode" (e.g. the dock's Settings UI banner) want this signal.
 */
export function resolvePermissionModeOverride(env: NodeJS.ProcessEnv): PermissionMode | null {
  if (!env.PINAGENT_AGENT_PERMISSION_MODE) return null;
  return resolvePermissionMode(env);
}

/**
 * Map the user-facing project setting to the SDK's permission-mode
 * value-space. Looks up the shared `PROJECT_PERMISSION_MODES` table so
 * the mapping stays in sync with the dock's Settings labels and the
 * detail-header chip.
 */
export function toSdkPermissionMode(mode: ProjectPermissionMode): PermissionMode {
  // `find` always hits because `mode` is typed against the literal
  // union derived from the same table; the `?? 'acceptEdits'` is just
  // a belt-and-braces fallback that satisfies the type checker.
  const meta = PROJECT_PERMISSION_MODES.find(
    (m: (typeof PROJECT_PERMISSION_MODES)[number]) => m.projectMode === mode,
  );
  return (meta?.sdkMode as PermissionMode | undefined) ?? 'acceptEdits';
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
  result: Extract<SDKMessage, { type: 'result' }> | null,
): Promise<void> {
  const storage = new Storage(projectRoot);
  const updated = await storage.read(feedbackId);
  const finishedAt = new Date().toISOString();

  const lines: string[] = [];
  lines.push('');
  lines.push('## Resolution');
  lines.push('');
  lines.push(`**Finished:** ${finishedAt}  `);

  if (result) {
    lines.push(renderResultFooter(result));
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

  return [
    'A developer submitted Pinagent feedback. Address it autonomously.',
    '',
    `Feedback id: ${rec.id}`,
    `Target: ${where}`,
    `Comment: "${rec.comment.replace(/\s+/g, ' ').slice(0, 200)}"`,
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
