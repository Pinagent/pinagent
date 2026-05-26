import {
  type Options,
  type PermissionMode,
  query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { Logger } from 'vite';

export interface AutoTriggerOptions {
  /** Working directory. Default: the resolved project root. */
  cwd?: string;
  /**
   * Permission mode passed to the Agent SDK. Default: 'acceptEdits'.
   * - 'acceptEdits': allow file edits without prompting; risky ops still prompt.
   * - 'bypassPermissions': YOLO — no prompts at all.
   * - 'default': prompt for everything (probably useless in non-interactive mode).
   * - 'plan': read-only — agent plans without editing.
   */
  permissionMode?: PermissionMode;
  /** Override the model. Defaults to whatever the SDK picks. */
  model?: string;
  /** Cap on agent turns per batch. Defaults to the SDK's default. */
  maxTurns?: number;
}

interface QueueItem {
  id: string;
  comment: string;
  file: string | null;
}

/**
 * Per-submit Claude Agent SDK runner with batching.
 *
 * Serialises runs so that two submits never race on the same files. While
 * a run is in flight, additional submits queue up; when the run completes,
 * the whole queued batch is addressed in one follow-up run.
 *
 * Requires ANTHROPIC_API_KEY (or a CLAUDE_CODE_USE_* provider env var) in
 * the dev server's environment — the SDK does not pick up CLI credentials.
 */
export class AutoTrigger {
  private readonly cwd: string;
  private readonly permissionMode: PermissionMode;
  private readonly model?: string;
  private readonly maxTurns?: number;
  private readonly logger: Logger;
  private readonly queue: QueueItem[] = [];
  private busy = false;

  constructor(opts: AutoTriggerOptions, cwd: string, logger: Logger) {
    this.cwd = opts.cwd ?? cwd;
    this.permissionMode = opts.permissionMode ?? 'acceptEdits';
    this.model = opts.model;
    this.maxTurns = opts.maxTurns;
    this.logger = logger;
  }

  enqueue(item: QueueItem): void {
    this.queue.push(item);
    this.logger.info(
      `[pinagent] queued feedback ${item.id} for auto-fix (queue depth: ${this.queue.length})`,
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

  private async runBatch(batch: QueueItem[]): Promise<void> {
    const prompt = buildPrompt(batch);
    this.logger.info(
      `[pinagent] auto-fix: running Agent SDK for ${batch.length} item(s): ${batch
        .map((b) => b.id)
        .join(', ')}`,
    );

    const options: Options = {
      cwd: this.cwd,
      permissionMode: this.permissionMode,
      settingSources: ['user', 'project', 'local'],
    };
    if (this.model) options.model = this.model;
    if (this.maxTurns != null) options.maxTurns = this.maxTurns;

    try {
      for await (const message of query({ prompt, options }) as AsyncIterable<SDKMessage>) {
        const line = renderForLogger(message);
        if (line) this.logger.info(`[pinagent:agent] ${line}`);

        if (message.type === 'result') {
          if (message.subtype === 'success') {
            this.logger.info(
              `[pinagent] auto-fix done (${batch.length} item(s), ${message.num_turns} turn${
                message.num_turns === 1 ? '' : 's'
              }, $${message.total_cost_usd.toFixed(4)})`,
            );
          } else {
            this.logger.warn(
              `[pinagent] auto-fix ended with ${message.subtype}${message.errors?.length ? `: ${message.errors.join('; ')}` : ''}`,
            );
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[pinagent] auto-fix errored: ${msg}`);
    }
  }
}

function renderForLogger(message: SDKMessage): string {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') {
        return `session ${message.session_id} · model ${message.model} · ${message.permissionMode}`;
      }
      return '';
    case 'assistant': {
      const blocks = message.message.content;
      if (!Array.isArray(blocks)) return '';
      const parts: string[] = [];
      for (const block of blocks) {
        if (block.type === 'text' && block.text.trim()) {
          parts.push(truncate(block.text.trim().replace(/\s+/g, ' '), 200));
        } else if (block.type === 'tool_use') {
          parts.push(`[${block.name}]${summariseInput(block.input)}`);
        }
      }
      return parts.join(' ');
    }
    case 'result':
      // The runBatch loop logs its own summary line; suppress duplication here.
      return '';
    default:
      return '';
  }
}

function summariseInput(input: unknown): string {
  if (input == null || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  for (const f of ['file_path', 'path', 'filePath']) {
    if (typeof obj[f] === 'string') return ` ${obj[f]}`;
  }
  if (typeof obj.command === 'string') return ` ${truncate(obj.command, 60)}`;
  return '';
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

function buildPrompt(batch: QueueItem[]): string {
  const lines: string[] = [];
  lines.push(
    'A user just submitted Pinagent feedback in their running Vite dev server. Address each item by:',
  );
  lines.push('  1) Calling the pinagent MCP tool `get_feedback` to read the comment + screenshot.');
  lines.push('  2) Optionally calling `get_source_context` to view the surrounding code.');
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
