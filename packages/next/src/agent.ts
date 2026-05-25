import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FeedbackRecord } from './storage';

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
 * Spawn an isolated agent for a single feedback record.
 * Returns immediately — the child process is detached and runs to completion
 * in the background. Errors/output land in .pinpoint/logs/<id>.log.
 */
export async function spawnAgent(ctx: AgentContext): Promise<void> {
  if (ctx.mode === false) return;

  const logsDir = join(ctx.projectRoot, '.pinpoint', 'logs');
  await mkdir(logsDir, { recursive: true });
  const logPath = join(logsDir, `${ctx.feedback.id}.log`);

  let cwd = ctx.projectRoot;
  if (ctx.mode === 'worktree') {
    try {
      cwd = await createWorktree(ctx.projectRoot, ctx.feedback.id, logPath);
    } catch (err) {
      await appendLog(logPath, `[pinpoint] worktree creation failed: ${stringifyErr(err)}\n`);
      return;
    }
  }

  const prompt = buildPrompt(ctx.feedback, ctx.mode, cwd);
  await appendLog(
    logPath,
    `[pinpoint] spawning agent for ${ctx.feedback.id} (mode=${ctx.mode})\n` +
      `[pinpoint] cwd: ${cwd}\n` +
      `[pinpoint] PINPOINT_PROJECT_ROOT: ${ctx.projectRoot}\n\n`,
  );

  const logHandle = await open(logPath, 'a');
  const child = spawn(
    'claude',
    [
      '-p',
      prompt,
      '--permission-mode',
      process.env.PINPOINT_AGENT_PERMISSION_MODE ?? 'acceptEdits',
    ],
    {
      cwd,
      detached: true,
      stdio: ['ignore', logHandle.fd, logHandle.fd],
      // The agent MUST talk to the main project's MCP server so all agents
      // share one feedback store. PINPOINT_PROJECT_ROOT pins this even when
      // the agent's cwd is a worktree.
      env: {
        ...process.env,
        PINPOINT_PROJECT_ROOT: ctx.projectRoot,
      },
    },
  );
  // Close our handle so it's owned by the child only.
  await logHandle.close();
  child.unref();
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
