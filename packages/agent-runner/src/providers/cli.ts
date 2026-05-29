// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentEvent } from '@pinagent/shared';
import { nanoid } from 'nanoid';
import { summariseToolInput } from '../agent-render';
import type { AgentProvider, AgentRunRequest, ProviderRunItem } from './types';

/**
 * Bring-your-own-model provider: wrap an arbitrary agentic CLI (Codex,
 * aider, opencode, Cline headless, a shell script, …) and translate its
 * stdout into Pinagent's `AgentEvent` stream.
 *
 * The wrapped CLI owns its own agentic loop and edits files directly in
 * `req.cwd`. We don't intercept its tool calls — we surface its narration
 * to the widget and let its on-disk edits land in the project (or
 * worktree) exactly as the Claude provider's edits do.
 *
 * Configuration (env, read per-run so a dev-server restart isn't needed):
 *
 * - `PINAGENT_AGENT_CLI_COMMAND`  (required) the command to run. Either a
 *   JSON array (`["aider","--yes-always"]`) or a space-separated string
 *   (`aider --yes-always`). The first element is the executable.
 * - `PINAGENT_AGENT_CLI_PROMPT`   `arg` (default) appends the prompt as the
 *   final argv; `stdin` writes it to the child's stdin and closes it.
 * - `PINAGENT_AGENT_CLI_FORMAT`   `text` (default) treats each stdout line
 *   as assistant text; `stream-json` parses each line as JSON and maps a
 *   pragmatic subset of common agent event shapes.
 * - `PINAGENT_AGENT_CLI_MODEL`    label for the `init` event (defaults to
 *   the executable name). Cosmetic — drives the widget's model chip.
 *
 * The child inherits the parent env plus `PINAGENT_PROJECT_ROOT`,
 * `PINAGENT_FEEDBACK_ID`, and `PINAGENT_RESUME_SESSION` so an MCP-aware
 * CLI (or a wrapper script) can connect to the pinagent MCP server, fetch
 * the feedback, and call `resolve_feedback` itself.
 */
export class CliAgentProvider implements AgentProvider {
  readonly id = 'cli';

  async *run(req: AgentRunRequest): AsyncIterable<ProviderRunItem> {
    const config = resolveCliConfig(process.env);
    const sessionId = req.resume ?? nanoid(12);
    const startedAt = Date.now();

    // Emit init up front so the widget's model chip + cost badge populate
    // before any output streams. `apiKeySource: 'cli'` is non-notional, so
    // the (unknown → 0) cost renders as a real "$0.0000" rather than a
    // misleading subscription label.
    yield {
      events: [
        {
          type: 'init',
          sessionId,
          model: config.model,
          permissionMode: req.permissionMode,
          apiKeySource: 'cli',
        },
      ],
      log: `> _cli_ \`${config.argv.join(' ')}\` · session \`${sessionId}\`\n\n`,
      sessionId,
    };

    const args = [...config.argv.slice(1)];
    if (config.promptMode === 'arg') args.push(req.prompt);

    const child = spawn(config.argv[0] as string, args, {
      cwd: req.cwd,
      env: {
        ...process.env,
        PINAGENT_PROJECT_ROOT: req.projectRoot,
        PINAGENT_FEEDBACK_ID: req.feedbackId,
        PINAGENT_RESUME_SESSION: req.resume ?? '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const onAbort = () => child.kill('SIGTERM');
    if (req.abortSignal.aborted) onAbort();
    else req.abortSignal.addEventListener('abort', onAbort, { once: true });

    // A wrapped CLI may exit before reading stdin (or fail to spawn), which
    // turns our write/end into an `EPIPE`/`ERR_STREAM_DESTROYED` 'error' on
    // the stream — fatal to the dev server if unhandled. Swallow it; the
    // run's outcome is owned by the exit/error handlers below.
    child.stdin.on('error', () => {});
    try {
      if (config.promptMode === 'stdin') child.stdin.write(req.prompt);
      child.stdin.end();
    } catch {
      // Stream already destroyed (child gone) — nothing to feed it.
    }

    // Bridge the child's line-buffered stdout/stderr into an async queue we
    // can `yield` from. stderr is surfaced as text too (CLIs commonly log
    // progress there) but visually distinguished in the transcript.
    const queue = new AsyncLineQueue();
    const stdout = createInterface({ input: child.stdout });
    const stderr = createInterface({ input: child.stderr });
    stdout.on('line', (line) => queue.push({ line, stream: 'stdout' }));
    stderr.on('line', (line) => queue.push({ line, stream: 'stderr' }));

    let openStreams = 2;
    const onClose = () => {
      openStreams -= 1;
      if (openStreams === 0) queue.close();
    };
    stdout.on('close', onClose);
    stderr.on('close', onClose);

    // `error` fires when the command can't be spawned at all (ENOENT, EACCES);
    // `exit` carries either an exit `code` or a terminating `signal`. We keep
    // all three so the result can distinguish "exited non-zero" from "killed
    // by a signal" from "never started". Folding the spawn error into the
    // resolved value (rather than a closure-mutated var) keeps control-flow
    // narrowing working at the use site below.
    const exit = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      spawnError: Error | null;
    }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal, spawnError: null }));
      child.on('error', (err) =>
        resolve({
          code: null,
          signal: null,
          spawnError: err instanceof Error ? err : new Error(String(err)),
        }),
      );
    });

    let turn = 0;
    for await (const { line, stream } of queue) {
      // stderr is diagnostics, not model output: always render it as tagged
      // text (never parse it as stream-json, where a non-JSON diagnostic
      // would masquerade as untagged assistant output) and never let it tick
      // the turn counter, which tracks assistant turns for the widget footer.
      const events =
        stream === 'stderr'
          ? parseTextLine(line, stream)
          : config.format === 'stream-json'
            ? parseStreamJsonLine(line)
            : parseTextLine(line, stream);
      if (events.length === 0) continue;
      // Count assistant text chunks as turns so the widget footer ticks.
      if (stream === 'stdout' && events.some((e) => e.type === 'text')) {
        turn += 1;
        events.push({ type: 'progress', turn });
      }
      yield { events, log: renderCliLine(line, stream) };
    }

    req.abortSignal.removeEventListener('abort', onAbort);
    const { code, signal, spawnError } = await exit;
    const aborted = req.abortSignal.aborted;
    // Success is a clean exit 0 that we didn't abort and that wasn't killed by
    // a signal. A non-abort signal (SIGKILL on OOM, SIGSEGV on a crash) leaves
    // `code` null — without the signal check that would slip through as 0.
    const subtype = aborted ? 'aborted' : spawnError || signal || code !== 0 ? 'error' : 'success';
    const resultEvent: AgentEvent = {
      type: 'result',
      subtype,
      numTurns: turn,
      // A wrapped CLI rarely reports cost; we record 0 rather than guess.
      // The cap machinery still gates on turns elapsing per conversation.
      totalCostUsd: 0,
      durationMs: Date.now() - startedAt,
    };
    if (subtype !== 'success') {
      let reason: string;
      if (aborted) reason = 'run aborted';
      else if (spawnError) reason = `failed to start ${config.argv[0]}: ${spawnError.message}`;
      else if (signal) reason = `${config.argv[0]} terminated by signal ${signal}`;
      else reason = `${config.argv[0]} exited with code ${code}`;
      resultEvent.errors = [reason];
    }
    yield {
      events: [resultEvent],
      log: '\n---\n',
      isResult: true,
      resultFooter: renderCliFooter(subtype, turn, Date.now() - startedAt),
    };
  }
}

interface CliConfig {
  argv: string[];
  promptMode: 'arg' | 'stdin';
  format: 'text' | 'stream-json';
  model: string;
}

/** Parse the CLI provider config out of the environment, validating it. */
function resolveCliConfig(env: NodeJS.ProcessEnv): CliConfig {
  const raw = env.PINAGENT_AGENT_CLI_COMMAND?.trim();
  if (!raw) {
    throw new Error(
      'PINAGENT_AGENT_CLI_COMMAND is required when PINAGENT_AGENT_PROVIDER=cli. ' +
        'Set it to the agent CLI to run, e.g. PINAGENT_AGENT_CLI_COMMAND=\'["aider","--yes-always"]\'.',
    );
  }
  let argv: string[];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.some((a) => typeof a !== 'string')) {
        throw new Error('not a string array');
      }
      argv = parsed;
    } catch (err) {
      throw new Error(
        `PINAGENT_AGENT_CLI_COMMAND looked like JSON but failed to parse as a string array: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    argv = raw.split(/\s+/).filter(Boolean);
  }
  if (argv.length === 0) {
    throw new Error('PINAGENT_AGENT_CLI_COMMAND resolved to an empty command');
  }

  const promptMode = env.PINAGENT_AGENT_CLI_PROMPT === 'stdin' ? 'stdin' : 'arg';
  const format = env.PINAGENT_AGENT_CLI_FORMAT === 'stream-json' ? 'stream-json' : 'text';
  const model = env.PINAGENT_AGENT_CLI_MODEL?.trim() || (argv[0] as string);
  return { argv, promptMode, format, model };
}

/** Plain-text mode: every non-blank line is assistant narration. */
function parseTextLine(line: string, stream: 'stdout' | 'stderr'): AgentEvent[] {
  if (!line.trim()) return [];
  // stderr lines are kept as text so the user sees CLI progress, but a
  // bare diagnostic shouldn't masquerade as model output — tag it.
  const text = stream === 'stderr' ? `[stderr] ${line}` : line;
  return [{ type: 'text', text }];
}

/**
 * stream-json mode: best-effort mapping of the common shapes emitted by
 * agentic CLIs. Unknown/unparseable lines fall back to raw text so output
 * is never silently dropped.
 */
function parseStreamJsonLine(line: string): AgentEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return [{ type: 'text', text: line }];
  }
  if (obj == null || typeof obj !== 'object') return [{ type: 'text', text: line }];
  const o = obj as Record<string, unknown>;

  // Direct text fields seen across CLIs: { text }, { content: "..." },
  // { delta: "..." }, { delta: { text } }.
  const direct =
    pickString(o.text) ?? pickString(o.content) ?? pickString(o.delta) ?? deltaText(o.delta);
  if (direct) return [{ type: 'text', text: direct }];

  // Anthropic-style nested message: { message: { content: [{type,text|name}] } }.
  const message = o.message;
  if (message && typeof message === 'object') {
    const blocks = (message as { content?: unknown }).content;
    if (Array.isArray(blocks)) return blocksToEvents(blocks);
  }
  // Top-level content array: { content: [{type,text}] }.
  if (Array.isArray(o.content)) return blocksToEvents(o.content);

  // A lone tool-call object: { type: 'tool_use'|'tool_call', name, input }.
  const type = pickString(o.type);
  if ((type === 'tool_use' || type === 'tool_call') && typeof o.name === 'string') {
    return [{ type: 'tool_use', name: o.name, summary: summariseToolInput(o.name, o.input) }];
  }

  return [{ type: 'text', text: line }];
}

function blocksToEvents(blocks: unknown[]): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const block of blocks) {
    if (block == null || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      out.push({ type: 'text', text: b.text });
    } else if ((b.type === 'tool_use' || b.type === 'tool_call') && typeof b.name === 'string') {
      out.push({
        type: 'tool_use',
        name: b.name,
        summary: summariseToolInput(b.name, b.input),
      });
    } else if (b.type === 'tool_result') {
      out.push({ type: 'tool_result', ok: !(b as { is_error?: boolean }).is_error });
    }
  }
  return out;
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

function deltaText(v: unknown): string | null {
  if (v && typeof v === 'object') return pickString((v as { text?: unknown }).text);
  return null;
}

function renderCliLine(line: string, stream: 'stdout' | 'stderr'): string {
  if (!line.trim()) return '';
  return stream === 'stderr' ? `> \`${line}\`\n` : `${line}\n`;
}

function renderCliFooter(subtype: string, turns: number, durationMs: number): string {
  const lines = [
    subtype === 'success'
      ? `**Outcome:** success (${turns} chunk${turns === 1 ? '' : 's'})`
      : `**Outcome:** \`${subtype}\``,
    '**Cost:** n/a (external CLI)',
    `**Duration:** ${(durationMs / 1000).toFixed(1)}s`,
  ];
  return lines.join('  \n');
}

/**
 * Minimal async iterable backed by a push queue. `readline` is push-based
 * (`'line'` events) but our provider is pull-based (`for await`), so this
 * buffers lines until the consumer asks for them and resolves cleanly when
 * the underlying streams close.
 */
class AsyncLineQueue implements AsyncIterable<{ line: string; stream: 'stdout' | 'stderr' }> {
  private buffer: { line: string; stream: 'stdout' | 'stderr' }[] = [];
  private resolvers: ((
    v: IteratorResult<{ line: string; stream: 'stdout' | 'stderr' }>,
  ) => void)[] = [];
  private done = false;

  push(item: { line: string; stream: 'stdout' | 'stderr' }): void {
    if (this.done) return;
    const resolve = this.resolvers.shift();
    if (resolve) resolve({ value: item, done: false });
    else this.buffer.push(item);
  }

  close(): void {
    this.done = true;
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<{ line: string; stream: 'stdout' | 'stderr' }> {
    return {
      next: () => {
        const item = this.buffer.shift();
        if (item) return Promise.resolve({ value: item, done: false });
        if (this.done) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.resolvers.push(resolve));
      },
    };
  }
}
