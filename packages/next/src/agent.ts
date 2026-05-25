import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { query, type Options, type PermissionMode, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { renderInitFooter, renderMessage, renderResultFooter } from './agent-render';
import { Storage, type FeedbackRecord } from './storage';

export type SpawnAgentMode = 'worktree' | 'inline' | false;

export function resolveAgentMode(env: NodeJS.ProcessEnv): SpawnAgentMode {
  const v = env.PINPOINT_SPAWN_AGENT;
  if (v === 'worktree' || v === 'inline') return v;
  return false;
}

interface AgentContext {
  projectRoot: string;
  feedback: FeedbackRecord;
  mode: SpawnAgentMode;
}

/**
 * Run an isolated Claude Agent SDK query for a single feedback record.
 *
 * Returns once the agent loop has been kicked off in the background. The
 * stream is consumed asynchronously and rendered to a markdown report at
 * `.pinpoint/logs/<id>.md`:
 *
 *   ---
 *   # Pinpoint feedback <id>
 *   <header: target, comment, branch, started_at>
 *
 *   ## Agent output
 *   <SDK-rendered transcript: text, tool chips, errors>
 *
 *   ## Resolution            ← appended once the result message arrives
 *   <status, note, finished_at, tokens, cost>
 *
 * Unlike the v1 detached `claude -p` model, the SDK runs in-process. If the
 * dev server exits mid-fix, the agent loop dies and the log ends mid-stream;
 * the feedback record stays `pending` so the next launch can re-pick it up.
 */
export async function spawnAgent(ctx: AgentContext): Promise<void> {
  if (ctx.mode === false) return;

  const logsDir = join(ctx.projectRoot, '.pinpoint', 'logs');
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
        renderHeader(ctx, cwd, startedAt, /* worktreeReady */ false) +
          `\n> [pinpoint] worktree creation failed: ${stringifyErr(err)}\n`,
      );
      return;
    }
  }

  await appendLog(logPath, renderHeader(ctx, cwd, startedAt, /* worktreeReady */ true));

  const prompt = buildPrompt(ctx.feedback, ctx.mode, cwd);
  const permissionMode = resolvePermissionMode(process.env);

  // The MCP server resolves PINPOINT_PROJECT_ROOT for storage. In worktree
  // mode, cwd is a sibling of the main repo, so the env var must explicitly
  // pin it back to the real project root. `env` REPLACES the SDK subprocess
  // environment (per SDK docs), so spread process.env to keep PATH, HOME,
  // ANTHROPIC_API_KEY, etc.
  const env: Record<string, string | undefined> = {
    ...process.env,
    PINPOINT_PROJECT_ROOT: ctx.projectRoot,
  };

  const options: Options = {
    cwd,
    permissionMode,
    env,
    // Load .mcp.json (and settings) from the worktree / project. The widget
    // depends on the pinpoint MCP server being reachable.
    settingSources: ['user', 'project', 'local'],
  };

  // Fire the stream consumer in the background so spawnAgent resolves with
  // "kicked off" semantics, matching the v1 fire-and-forget contract.
  void consumeStream(ctx, logPath, prompt, options);
}

async function consumeStream(
  ctx: AgentContext,
  logPath: string,
  prompt: string,
  options: Options,
): Promise<void> {
  let sessionId: string | null = null;
  let sessionRecorded = false;
  let resultRendered = false;

  try {
    for await (const message of query({ prompt, options }) as AsyncIterable<SDKMessage>) {
      if (!sessionId && 'session_id' in message && typeof message.session_id === 'string') {
        sessionId = message.session_id;
      }
      if (!sessionRecorded && sessionId) {
        sessionRecorded = true;
        await persistSessionId(ctx.projectRoot, ctx.feedback.id, sessionId);
      }

      if (message.type === 'system' && message.subtype === 'init') {
        await appendLog(logPath, renderInitFooter(message));
        continue;
      }

      if (message.type === 'result') {
        resultRendered = true;
        await appendLog(logPath, renderMessage(message));
        await appendResolution(ctx.projectRoot, ctx.feedback.id, logPath, message);
        continue;
      }

      const chunk = renderMessage(message);
      if (chunk) await appendLog(logPath, chunk);
    }
  } catch (err) {
    await appendLog(
      logPath,
      `\n> [pinpoint] agent stream errored: ${stringifyErr(err)}\n`,
    );
  }

  if (!resultRendered) {
    // Stream ended without a `result` message — write a minimal footer so
    // the log isn't open-ended.
    await appendResolution(ctx.projectRoot, ctx.feedback.id, logPath, null);
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
  // Verify projectRoot is a git repo before doing anything destructive.
  if (!existsSync(join(projectRoot, '.git'))) {
    throw new Error('project root is not a git repository');
  }

  const worktreeDir = join(projectRoot, '.pinpoint', 'worktrees');
  await mkdir(worktreeDir, { recursive: true });
  const worktreePath = join(worktreeDir, feedbackId);
  const branch = `pinpoint/${feedbackId}`;

  // `git worktree add -b <branch> <path>` creates the branch from current HEAD
  // and checks it out at <path>. If the directory already exists, git refuses;
  // we don't try to recover (caller should clean up first).
  await runGit(projectRoot, ['worktree', 'add', '-b', branch, worktreePath], logPath);
  return worktreePath;
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
        appendLog(logPath, `[pinpoint:git] git ${args.join(' ')} → exit ${code}\n${stderr}\n`).catch(
          () => {},
        );
        rej(new Error(`git ${args.join(' ')} exited ${code}: ${stderr.trim()}`));
      }
    });
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

function resolvePermissionMode(env: NodeJS.ProcessEnv): PermissionMode {
  const v = env.PINPOINT_AGENT_PERMISSION_MODE;
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
  const branchLine =
    ctx.mode === 'worktree' && worktreeReady ? `branch: pinpoint/${rec.id}\n` : '';

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
    `# Pinpoint feedback \`${rec.id}\``,
    '',
    `**Target:** \`${where}\`  `,
    `**URL:** ${rec.url}  `,
    `**Mode:** ${ctx.mode}${ctx.mode === 'worktree' && worktreeReady ? `  ·  **Branch:** \`pinpoint/${rec.id}\`` : ''}`,
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

function buildPrompt(rec: FeedbackRecord, mode: SpawnAgentMode, cwd: string): string {
  const where = rec.file
    ? `${rec.file}:${rec.line ?? '?'}${rec.col != null ? `:${rec.col}` : ''}`
    : rec.selector;

  const worktreeContext =
    mode === 'worktree'
      ? [
          '',
          'You are working in a FRESH git worktree at:',
          `  ${cwd}`,
          `on branch pinpoint/${rec.id} (forked from current HEAD).`,
          '',
          'Make edits freely. DO NOT commit — the developer will review your',
          'changes by diffing this branch against main.',
        ].join('\n')
      : '';

  return [
    'A developer submitted Pinpoint feedback. Address it autonomously.',
    '',
    `Feedback id: ${rec.id}`,
    `Target: ${where}`,
    `Comment: "${rec.comment.replace(/\s+/g, ' ').slice(0, 200)}"`,
    worktreeContext,
    '',
    'Workflow:',
    '  1. Call the pinpoint MCP tool `get_feedback` with the id above —',
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
