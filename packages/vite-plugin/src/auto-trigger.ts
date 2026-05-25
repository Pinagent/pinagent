import { spawn } from 'node:child_process';
import type { Logger } from 'vite';

export interface AutoTriggerOptions {
  /** Command to invoke. Default: 'claude'. */
  command?: string;
  /** Working directory. Default: the resolved project root. */
  cwd?: string;
  /**
   * Permission mode passed to claude. Default: 'acceptEdits'.
   * - 'acceptEdits': allow file edits without prompting; risky ops still prompt.
   * - 'bypassPermissions': YOLO — no prompts at all.
   * - 'default': prompt for everything (probably useless in non-interactive mode).
   */
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'auto';
  /** Extra args passed to the command. */
  extraArgs?: string[];
}

interface QueueItem {
  id: string;
  comment: string;
  file: string | null;
}

export class AutoTrigger {
  private readonly cmd: string;
  private readonly cwd: string;
  private readonly permissionMode: string;
  private readonly extraArgs: string[];
  private readonly logger: Logger;
  private readonly queue: QueueItem[] = [];
  private busy = false;

  constructor(opts: AutoTriggerOptions, cwd: string, logger: Logger) {
    this.cmd = opts.command ?? 'claude';
    this.cwd = opts.cwd ?? cwd;
    this.permissionMode = opts.permissionMode ?? 'acceptEdits';
    this.extraArgs = opts.extraArgs ?? [];
    this.logger = logger;
  }

  enqueue(item: QueueItem): void {
    this.queue.push(item);
    this.logger.info(
      `[pinpoint] queued feedback ${item.id} for auto-fix (queue depth: ${this.queue.length})`,
    );
    this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy) return;
    if (this.queue.length === 0) return;
    this.busy = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.queue.length);
        await this.runBatch(batch);
      }
    } finally {
      this.busy = false;
    }
  }

  private runBatch(batch: QueueItem[]): Promise<void> {
    const prompt = buildPrompt(batch);
    // extraArgs go FIRST so flags like ['--model', 'sonnet'] precede the
    // positional `-p PROMPT`.
    const args = [...this.extraArgs, '-p', prompt, '--permission-mode', this.permissionMode];

    this.logger.info(
      `[pinpoint] auto-fix: spawning ${this.cmd} for ${batch.length} item(s): ${batch
        .map((b) => b.id)
        .join(', ')}`,
    );

    return new Promise((resolve) => {
      const child = spawn(this.cmd, args, {
        cwd: this.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trimEnd();
        if (text) this.logger.info(`[pinpoint:claude] ${text}`);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trimEnd();
        if (text) this.logger.warn(`[pinpoint:claude!] ${text}`);
      });

      child.on('error', (err) => {
        this.logger.warn(
          `[pinpoint] auto-fix failed to spawn '${this.cmd}': ${err.message}. ` +
            'Is the claude CLI on PATH?',
        );
        resolve();
      });
      child.on('exit', (code) => {
        if (code === 0) {
          this.logger.info(`[pinpoint] auto-fix done (${batch.length} item(s))`);
        } else {
          this.logger.warn(`[pinpoint] auto-fix exited with code ${code}`);
        }
        resolve();
      });
    });
  }
}

function buildPrompt(batch: QueueItem[]): string {
  const lines: string[] = [];
  lines.push(
    'A user just submitted Pinpoint feedback in their running Vite dev server. Address each item by:',
  );
  lines.push('  1) Calling the pinpoint MCP tool `get_feedback` to read the comment + screenshot.');
  lines.push(
    '  2) Optionally calling `get_source_context` to view the surrounding code.',
  );
  lines.push(
    '  3) Editing the relevant file(s) to address the request. Be conservative; only change what the comment asks for.',
  );
  lines.push(
    "  4) Calling `resolve_feedback` with status='fixed' (or 'wontfix' with a note if you can't apply it).",
  );
  lines.push('');
  lines.push(`Items to address (${batch.length}):`);
  for (const item of batch) {
    const where = item.file ? ` — ${item.file}` : '';
    const preview = item.comment.replace(/\s+/g, ' ').slice(0, 120);
    lines.push(`  - id=${item.id}${where} — "${preview}"`);
  }
  return lines.join('\n');
}
