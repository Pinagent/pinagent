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
import {
  renderInitFooter,
  renderMessage,
  renderResultFooter,
  summariseToolInput,
} from './agent-render';
import { ASK_USER_TOOL_NAME, createAskUserMcpServer, rejectAsk } from './ask-user';
import { type AgentEvent, getOrCreateBus } from './event-bus';
import { type FeedbackRecord, Storage } from './storage';

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
 * One in-flight SDK run per feedback id. The WS interrupt handler reads
 * this; the multi-turn handler rejects a `user_message` if a run is
 * already going (no queueing yet — phase F if we need it).
 */
// Singleton across module re-evaluations (see event-bus.ts). The
// WS interrupt handler and the multi-turn user_message handler both
// look up activeRuns; if the route module re-evaluates between an
// agent run starting and a user clicking Stop, a fresh activeRuns
// Map would lose the entry and interrupt would no-op.
const ACTIVE_RUNS_SYMBOL = Symbol.for('pinagent.agent.activeRuns');
const activeRuns: Map<string, ActiveRun> =
  ((globalThis as Record<symbol, unknown>)[ACTIVE_RUNS_SYMBOL] as
    | Map<string, ActiveRun>
    | undefined) ?? new Map<string, ActiveRun>();
(globalThis as Record<symbol, unknown>)[ACTIVE_RUNS_SYMBOL] = activeRuns;

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
  if (activeRuns.has(feedbackId)) {
    throw new Error('a turn is already in progress for this feedback');
  }

  const projectRoot = process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) throw new Error(`feedback not found: ${feedbackId}`);
  if (!rec.agentSessionId) {
    throw new Error('no prior agent session — only spawn-mode submissions support follow-ups');
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

  void runQuery({
    projectRoot,
    feedbackId,
    cwd,
    logPath,
    prompt: content,
    isInitial: false,
    resume: rec.agentSessionId,
  });
}

/**
 * True iff an SDK run is currently in flight for this feedback id.
 * Lightweight read for code that needs to know without mutating
 * anything (tests, status pings, future health endpoints).
 */
export function hasActiveRun(feedbackId: string): boolean {
  return activeRuns.has(feedbackId);
}

/**
 * Abort an in-flight run for `feedbackId`. Returns false if nothing is
 * running. The SDK should propagate the abort through its tool loop and
 * exit the iterator; consumeStream catches the abort error and writes a
 * minimal footer.
 */
export function interruptRun(feedbackId: string): boolean {
  const run = activeRuns.get(feedbackId);
  if (!run) return false;
  run.abort.abort();
  return true;
}

interface RunQueryOpts {
  projectRoot: string;
  feedbackId: string;
  cwd: string;
  logPath: string;
  prompt: string;
  isInitial: boolean;
  resume?: string;
}

async function runQuery(opts: RunQueryOpts): Promise<void> {
  const permissionMode = resolvePermissionMode(process.env);
  const abort = new AbortController();
  activeRuns.set(opts.feedbackId, { abort });

  // The `ask_user` tool can block for up to 10 min waiting for a human
  // response. SDK MCP tool calls time out at 60s by default; bump it to
  // ~12 min to cover the full ASK_TTL window in ask-user.ts.
  const env: Record<string, string | undefined> = {
    ...process.env,
    PINAGENT_PROJECT_ROOT: opts.projectRoot,
    CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: '720000',
  };

  const sdkOptions: Options = {
    cwd: opts.cwd,
    permissionMode,
    env,
    settingSources: ['user', 'project', 'local'],
    abortController: abort,
    mcpServers: {
      'pinagent-ask-user': createAskUserMcpServer(opts.feedbackId),
    },
    allowedTools: [ASK_USER_TOOL_NAME],
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

      for (const ev of toAgentEvents(message)) bus.publish(ev);

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
        // reload-time scan.
        try {
          const storage = new Storage(opts.projectRoot);
          const rec = await storage.read(opts.feedbackId);
          if (rec && rec.status !== 'pending') {
            bus.publish({
              type: 'status_changed',
              status: rec.status,
              note: rec.note,
              commitSha: rec.commitSha,
              resolvedAt: rec.resolvedAt,
            });
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
    bus.publish({ type: 'error', message: msg });
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

  await appendLog(
    logPath,
    `> [pinagent] landed onto \`${targetBranch}\`${commitSha ? ` as \`${commitSha.slice(0, 12)}\`` : ''}\n`,
  );

  return { ok: true, ...(commitSha ? { commitSha } : {}) };
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
  return { ok: true };
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

interface GitCapture {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Variant of `runGit` for commands whose non-zero exit codes are
 * meaningful (e.g. `git merge` returns 1 on conflict, not an error). Never
 * rejects on a non-zero exit — only on spawn errors. Captures stdout so we
 * can parse SHAs, branch names, and conflict file lists.
 */
function runGitCapture(cwd: string, args: string[]): Promise<GitCapture> {
  return new Promise((res, rej) => {
    const child = spawn('git', args, { cwd, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.on('error', rej);
    child.on('exit', (code) => res({ code: code ?? -1, stdout, stderr }));
  });
}

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
