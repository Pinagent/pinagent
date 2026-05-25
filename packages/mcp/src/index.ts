import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CHANNEL_INSTRUCTIONS, startFeedbackWatcher } from './channel';
import { resolveRoot } from './root';
import { Storage, StatusSchema, isInsideRoot } from './storage';

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

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

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
            | { type: 'text'; text: string }
            | { type: 'image'; data: string; mimeType: string }
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
          await storage.write(next);
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: true, id: next.id, status: next.status }, null, 2) }],
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

        default:
          return errorResult(`unknown tool: ${name}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return errorResult(msg);
    }
  });

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
}): string {
  const loc = r.file
    ? `${r.file}:${r.line ?? '?'}${r.col != null ? `:${r.col}` : ''}`
    : r.selector;
  return [
    `id: ${r.id}`,
    `status: ${r.status}`,
    `created: ${r.createdAt}`,
    `url: ${r.url}`,
    `viewport: ${r.viewport.w}×${r.viewport.h}`,
    `target: ${loc}`,
    '',
    'comment:',
    r.comment,
  ].join('\n');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[pinagent-mcp] fatal:', err);
  process.exit(1);
});
