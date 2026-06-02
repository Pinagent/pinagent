// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
// Import from the SDK-free `/pr` subpath, NOT the package root — the root
// re-exports the agent providers, which would drag the Claude Agent SDK
// into the published `pinagent-mcp` bin. See agent-runner's tsdown config.
import { openHostBranchPr } from '@pinagent/agent-runner/pr';
import { renderTranscript } from '@pinagent/shared';
import { z } from 'zod';
import { CHANNEL_INSTRUCTIONS, startFeedbackWatcher } from './channel';
import { resolveRoot } from './root';
import { isInsideRoot, StatusSchema, Storage } from './storage';

const TOOL_LIST = [
  {
    name: 'list_pending_feedback',
    description:
      'List Pinagent feedback items the developer has captured in the running Vite dev server. Returns only items with status=pending. Use this first to see what work is queued.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        since: {
          type: 'string',
          description: 'Optional ISO-8601 timestamp; only include items created after this time.',
        },
        file: {
          type: 'string',
          description: 'Optional project-relative file path filter (substring match).',
        },
      },
    },
  },
  {
    name: 'get_feedback',
    description:
      'Fetch a single feedback item by id, including the screenshot inline as an image content block.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Feedback id (10-char nanoid).' },
      },
    },
  },
  {
    name: 'resolve_feedback',
    description:
      "Mark a feedback item as fixed, wontfix, or deferred. Optionally attach a note and a commit sha. Set status='pending' to re-open.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'status'],
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'fixed', 'wontfix', 'deferred'] },
        note: { type: 'string' },
        commit_sha: { type: 'string' },
      },
    },
  },
  {
    name: 'get_source_context',
    description:
      'Read a window of source lines around a given file:line, with line numbers. Useful after get_feedback to see code surrounding the targeted element.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['file', 'line'],
      properties: {
        file: { type: 'string', description: 'Project-relative file path.' },
        line: { type: 'number', description: '1-based line number.' },
        radius: {
          type: 'number',
          description: 'Number of lines either side of `line` to include. Default 20.',
        },
      },
    },
  },
  {
    name: 'get_conversation_transcript',
    description:
      "Fetch the full persisted agent transcript for one conversation in insertion order — every event the dev-server's bus has captured for this feedback id (init, text, tool_use, tool_result, ask_user, error, result, status_changed). Useful for a spawned agent to read its own prior runs (or another agent's transcript) when reasoning about follow-ups, or to bridge transcript content into a different model. The internal `__finished` bus sentinel is excluded.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Conversation / feedback id.' },
        format: {
          type: 'string',
          enum: ['text', 'json'],
          description:
            'Output format. `text` (default) returns a readable plain-text rendering identical to `pinagent transcript`; `json` returns the raw AgentEvent array stringified for downstream parsing.',
        },
      },
    },
  },
  {
    name: 'create_pull_request',
    description:
      "Open a GitHub pull request for the branch the dev-server is currently on. FIRST summarize the branch's changes yourself — inspect the diff against the base branch (e.g. `git diff <base>...HEAD`) — then call this with a concise `title` and a GitHub-flavored-markdown `body`. If the working tree has UNCOMMITTED changes, also pass a `commit_message`: the tool will `git add -A` and commit them (so they land in the PR) before pushing. The tool pushes the current branch and opens the PR via the developer's configured GitHub token, targeting the project's configured base branch. If no token is set it pushes and returns a compare URL to open the PR manually. Returns the PR URL (or compare URL) and push status.",
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'body'],
      properties: {
        title: {
          type: 'string',
          description:
            'PR title as a Conventional Commit: `type(scope): summary` (type ∈ feat|fix|chore|docs|refactor|test|perf; scope = main area changed, e.g. dock, widget, mcp). Imperative, lowercase, <70 chars. E.g. "feat(dock): add inline diff".',
        },
        body: { type: 'string', description: 'PR description in GitHub-flavored markdown.' },
        commit_message: {
          type: 'string',
          description:
            'Commit message for uncommitted working changes. Required when the tree is dirty; the tool commits them (git add -A) before pushing. Omit when everything is already committed.',
        },
      },
    },
  },
] as const;

const ListInput = z.object({
  since: z.string().optional(),
  file: z.string().optional(),
});

const GetInput = z.object({ id: z.string() });

const ResolveInput = z.object({
  id: z.string(),
  status: StatusSchema,
  note: z.string().optional(),
  commit_sha: z.string().optional(),
});

const SourceInput = z.object({
  file: z.string(),
  line: z.number().int().min(1),
  radius: z.number().int().min(0).max(2000).optional(),
});

const TranscriptInput = z.object({
  id: z.string(),
  format: z.enum(['text', 'json']).optional(),
});

const CreatePrInput = z.object({
  title: z.string().min(1),
  body: z.string(),
  commit_message: z.string().optional(),
});

/**
 * Boot the Pinagent stdio MCP server. Resolves once the server is connected
 * to stdio and the channel watcher is running; never returns under normal
 * operation (the transport keeps the event loop alive).
 *
 * Exposed so `@pinagent/cli`'s `pinagent mcp` subcommand can drive the server
 * in-process. The package's `bin` entry calls this directly via the auto-start
 * block at the bottom of this file.
 */
export async function startMcpServer(): Promise<void> {
  await main();
}

async function main() {
  const root = resolveRoot(process.env, process.cwd());
  // eslint-disable-next-line no-console
  console.error(`[pinagent-mcp] project root: ${root}`);
  const storage = new Storage(root);

  const server = new Server(
    { name: 'pinagent', version: '0.0.1' },
    {
      capabilities: {
        tools: {},
        // Channel capability — only takes effect when Claude Code is launched
        // with `--dangerously-load-development-channels server:pinagent`.
        // Without that flag, the notifications are silently dropped and the
        // tools below still work in pull mode.
        experimental: { 'claude/channel': {} },
      },
      instructions: CHANNEL_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_LIST }));

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    callTool(
      storage,
      root,
      req.params.name,
      (req.params.arguments ?? {}) as Record<string, unknown>,
    ),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error('[pinagent-mcp] ready on stdio');

  // Start the channel watcher after the server is connected so notifications
  // have a transport to write to.
  await startFeedbackWatcher(storage, server, (msg) => {
    // eslint-disable-next-line no-console
    console.error(`[pinagent-mcp:channel] ${msg}`);
  });
}

/**
 * Dispatch a single MCP tool call against the given storage + project root.
 * Extracted from the request handler so the tool logic — especially the
 * `get_source_context` path-traversal guards — is unit-testable without
 * standing up a stdio transport. Returns the same content/`isError` shape
 * the MCP SDK expects; never throws (all errors funnel through
 * `errorResult`).
 */
export async function callTool(
  storage: Storage,
  root: string,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    switch (name) {
      case 'list_pending_feedback': {
        const input = ListInput.parse(args);
        const items = (await storage.list()).filter((r) => r.status === 'pending');
        const filtered = items.filter((r) => {
          if (input.since && r.createdAt < input.since) return false;
          if (input.file && !(r.file ?? '').includes(input.file)) return false;
          return true;
        });
        const shaped = filtered.map((r) => ({
          id: r.id,
          comment_preview: r.comment.slice(0, 120),
          file: r.file,
          line: r.line,
          url: r.url,
          created_at: r.createdAt,
        }));
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ items: shaped }, null, 2),
            },
          ],
        };
      }

      case 'get_feedback': {
        const input = GetInput.parse(args);
        const rec = await storage.read(input.id);
        if (!rec) return errorResult(`feedback ${input.id} not found`);
        const pretty = formatFeedback(rec);
        const png = await storage.readScreenshot(rec);
        const content: Array<
          { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
        > = [{ type: 'text', text: pretty }];
        if (png) {
          content.push({
            type: 'image',
            data: png.toString('base64'),
            mimeType: 'image/png',
          });
        }
        return { content };
      }

      case 'resolve_feedback': {
        const input = ResolveInput.parse(args);
        const rec = await storage.read(input.id);
        if (!rec) return errorResult(`feedback ${input.id} not found`);

        const next = { ...rec };
        next.status = input.status;
        if (input.note !== undefined) next.note = input.note;
        if (input.commit_sha !== undefined) next.commitSha = input.commit_sha;
        if (input.status === 'pending') {
          next.resolvedAt = null;
        } else if (!next.resolvedAt) {
          next.resolvedAt = new Date().toISOString();
        }
        // Inline-mode runs have no worktree to Land/Discard, so the
        // dock would otherwise leave them stuck in `readyToLand`. Treat
        // the agent's own resolution as the terminal event in that
        // case. Real worktrees (`active`) keep their state — the user
        // still drives Land/Discard from the dock.
        if (next.worktreeState === 'none') {
          if (input.status === 'fixed') next.worktreeState = 'landed';
          else if (input.status === 'wontfix') next.worktreeState = 'discarded';
        }
        await storage.write(next);
        // Drop a row in the audit log so the dock's History → Activity
        // feed shows the agent's resolution. Best-effort: any failure
        // here is swallowed by the helper itself.
        await storage.recordAuditEvent({
          conversationId: next.id,
          actor: 'agent',
          action: 'conversation_resolved_by_agent',
          payload: {
            status: next.status,
            previousStatus: rec.status,
            ...(next.worktreeState !== rec.worktreeState
              ? { worktreeState: next.worktreeState, previousWorktreeState: rec.worktreeState }
              : {}),
            ...(input.note !== undefined ? { note: input.note } : {}),
            ...(input.commit_sha !== undefined ? { commitSha: input.commit_sha } : {}),
          },
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, id: next.id, status: next.status }, null, 2),
            },
          ],
        };
      }

      case 'get_source_context': {
        const input = SourceInput.parse(args);
        if (input.file.includes('..')) return errorResult('path traversal not allowed');
        const abs = isAbsolute(input.file) ? input.file : resolve(root, input.file);
        if (!isInsideRoot(root, abs)) return errorResult('path outside project root');
        let text: string;
        try {
          text = await readFile(abs, 'utf8');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return errorResult(`cannot read ${input.file}: ${msg}`);
        }
        const lines = text.split(/\r?\n/);
        const radius = input.radius ?? 20;
        const start = Math.max(1, input.line - radius);
        const end = Math.min(lines.length, input.line + radius);
        const pad = String(end).length;
        const window: string[] = [];
        for (let i = start; i <= end; i++) {
          const marker = i === input.line ? '>' : ' ';
          const lineText = lines[i - 1] ?? '';
          window.push(`${marker} ${String(i).padStart(pad, ' ')} | ${lineText}`);
        }
        return {
          content: [
            {
              type: 'text',
              text: `${input.file} (lines ${start}-${end}, target ${input.line}):\n\n${window.join('\n')}`,
            },
          ],
        };
      }

      case 'get_conversation_transcript': {
        const input = TranscriptInput.parse(args);
        const rec = await storage.read(input.id);
        if (!rec) return errorResult(`conversation ${input.id} not found`);
        const events = await storage.listMessages(input.id);
        const format = input.format ?? 'text';
        const text = format === 'json' ? JSON.stringify(events, null, 2) : renderTranscript(events);
        return { content: [{ type: 'text', text }] };
      }

      case 'create_pull_request': {
        const input = CreatePrInput.parse(args);
        const result = await openHostBranchPr(root, {
          title: input.title,
          body: input.body,
          ...(input.commit_message ? { commitMessage: input.commit_message } : {}),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          ...(result.ok ? {} : { isError: true }),
        };
      }

      default:
        return errorResult(`unknown tool: ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return errorResult(msg);
  }
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

function formatFeedback(r: {
  id: string;
  comment: string;
  file: string | null;
  line: number | null;
  col: number | null;
  selector: string;
  url: string;
  viewport: { w: number; h: number };
  status: string;
  createdAt: string;
  component?: string | null;
  componentPath?: string[] | null;
  instanceIndex?: number | null;
  instanceTotal?: number | null;
  instanceFingerprint?: string | null;
}): string {
  const loc = r.file ? `${r.file}:${r.line ?? '?'}${r.col != null ? `:${r.col}` : ''}` : r.selector;
  const lines = [
    `id: ${r.id}`,
    `status: ${r.status}`,
    `created: ${r.createdAt}`,
    `url: ${r.url}`,
    `viewport: ${r.viewport.w}×${r.viewport.h}`,
    `target: ${loc}`,
  ];
  if (r.component) lines.push(`component: <${r.component}>`);
  if (r.componentPath && r.componentPath.length > 1) {
    lines.push(`component path: ${r.componentPath.join(' › ')}`);
  }
  // Loop-instance disambiguation: the file:line is shared across N
  // rendered instances; point the agent at the one the user clicked.
  if (r.instanceTotal && r.instanceTotal > 1) {
    lines.push(
      `instance: clicked #${(r.instanceIndex ?? 0) + 1} of ${r.instanceTotal} sharing this location`,
    );
    if (r.instanceFingerprint) lines.push(`instance content: ${r.instanceFingerprint}`);
  }
  lines.push('', 'comment:', r.comment);
  return lines.join('\n');
}

// Auto-start when invoked as a script (bin entry). Skipped when imported as
// a library — `@pinagent/cli`'s `pinagent mcp` subcommand imports
// `startMcpServer` and drives the lifecycle itself.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[pinagent-mcp] fatal:', err);
    process.exit(1);
  });
}
