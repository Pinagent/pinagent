// SPDX-License-Identifier: Apache-2.0
/**
 * `pinagent list` and `pinagent resolve` — headless access to the
 * feedback queue over the dev-server's HTTP API, so the whole loop
 * (see what's queued → mark it resolved) is drivable from a terminal or
 * script without opening the dock or an MCP session.
 *
 *   - `list`    → GET   /__pinagent/feedback
 *   - `resolve` → PATCH /__pinagent/feedback/:id
 *
 * As in `init.ts`/`transcript.ts`, the pure pieces (argv parsers, the
 * table renderer) are split from the fetchers so the unit tests can pin
 * behaviour without standing up an HTTP server; the e2e test exercises
 * the real middleware.
 */
import { z } from 'zod';
import { baseUrl, ID_RE, requestJson, resolveServerUrl } from './http';

const STATUSES = ['pending', 'fixed', 'wontfix', 'deferred'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * Shallow projection the `GET /__pinagent/feedback` endpoint returns.
 * Lenient (`.passthrough()`, every field optional) so a server that
 * adds columns doesn't break an older CLI — we only read what we render.
 */
const FeedbackRowSchema = z
  .object({
    id: z.string(),
    comment: z.string().optional(),
    title: z.string().nullable().optional(),
    file: z.string().nullable().optional(),
    line: z.number().nullable().optional(),
    status: z.string().optional(),
    archived: z.boolean().optional(),
    branch: z.string().nullable().optional(),
    messageCount: z.number().nullable().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();
export type FeedbackRow = z.infer<typeof FeedbackRowSchema>;

const ListResponseSchema = z.array(FeedbackRowSchema);

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export interface ListArgs {
  serverUrl: string;
  status: Status | null;
  file: string | null;
  /** Include archived rows (hidden by default — they're resolved noise). */
  all: boolean;
  json: boolean;
}

/**
 * Parse argv for `pinagent list`. Pure so the argv handling is unit
 * testable without the fetch. `--status` is validated against the known
 * set up front so a typo fails fast instead of silently matching nothing.
 */
export function parseListArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ListArgs | { error: string } {
  let serverUrl: string | null = null;
  let status: Status | null = null;
  let file: string | null = null;
  let all = false;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--all' || arg === '-a') {
      all = true;
    } else if (arg === '--status') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return { error: '--status requires a value' };
      if (!(STATUSES as readonly string[]).includes(next)) {
        return { error: `invalid --status "${next}" (expected ${STATUSES.join(' | ')})` };
      }
      status = next as Status;
      i++;
    } else if (arg === '--file') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return { error: '--file requires a value' };
      file = next;
      i++;
    } else if (arg === '--server' || arg === '-s') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return { error: '--server requires a value' };
      serverUrl = next;
      i++;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  return { serverUrl: resolveServerUrl(serverUrl, env), status, file, all, json };
}

export async function fetchFeedbackList(serverUrl: string): Promise<FeedbackRow[]> {
  const body = await requestJson(`${baseUrl(serverUrl)}/__pinagent/feedback`);
  const parsed = ListResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`unexpected /__pinagent/feedback response shape: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Apply the client-side `--status` / `--file` / `--all` filters. */
export function filterFeedback(rows: FeedbackRow[], args: ListArgs): FeedbackRow[] {
  return rows.filter((r) => {
    if (!args.all && r.archived) return false;
    if (args.status && r.status !== args.status) return false;
    if (args.file && !(r.file ?? '').includes(args.file)) return false;
    return true;
  });
}

/** Human label for a row: explicit title, else first line of the comment. */
function rowLabel(r: FeedbackRow): string {
  const raw = (r.title ?? r.comment ?? '').trim();
  const firstLine = raw.split('\n', 1)[0] ?? '';
  return firstLine || '(no comment)';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Render the feedback list as an aligned plain-text table. Pure: takes
 * the already-filtered rows so the test can pin the layout without a
 * server. Empty input yields a friendly marker rather than a blank line.
 */
export function renderFeedbackList(rows: FeedbackRow[]): string {
  if (rows.length === 0) return 'No feedback found.\n';

  const cols = rows.map((r) => ({
    id: r.id,
    status: r.status ?? 'pending',
    loc: r.file ? `${r.file}${r.line != null ? `:${r.line}` : ''}` : '—',
    label: truncate(rowLabel(r), 60),
  }));

  const w = (key: 'id' | 'status' | 'loc') =>
    Math.max(key.toUpperCase().length, ...cols.map((c) => c[key].length));
  const wId = w('id');
  const wStatus = w('status');
  const wLoc = w('loc');

  const line = (id: string, status: string, loc: string, label: string) =>
    `${id.padEnd(wId)}  ${status.padEnd(wStatus)}  ${loc.padEnd(wLoc)}  ${label}`;

  const out = [line('ID', 'STATUS', 'LOCATION', 'COMMENT')];
  for (const c of cols) out.push(line(c.id, c.status, c.loc, c.label));
  out.push('', `${rows.length} item(s).`);
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

export interface ResolveArgs {
  id: string;
  status: Status;
  note: string | null;
  commitSha: string | null;
  serverUrl: string;
  json: boolean;
}

/**
 * Parse argv for `pinagent resolve <id> --status <s>`. `--status` is
 * required (the whole point of the command) and validated against the
 * known set; `pending` is permitted so a row can be re-opened.
 */
export function parseResolveArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ResolveArgs | { error: string } {
  let id: string | null = null;
  let status: Status | null = null;
  let note: string | null = null;
  let commitSha: string | null = null;
  let serverUrl: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--status') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return { error: '--status requires a value' };
      if (!(STATUSES as readonly string[]).includes(next)) {
        return { error: `invalid --status "${next}" (expected ${STATUSES.join(' | ')})` };
      }
      status = next as Status;
      i++;
    } else if (arg === '--note') {
      const next = argv[i + 1];
      if (next === undefined) return { error: '--note requires a value' };
      note = next;
      i++;
    } else if (arg === '--commit') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return { error: '--commit requires a value' };
      commitSha = next;
      i++;
    } else if (arg === '--server' || arg === '-s') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return { error: '--server requires a value' };
      serverUrl = next;
      i++;
    } else if (arg && !arg.startsWith('-') && id === null) {
      id = arg;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  if (!id) return { error: 'missing required <id> argument' };
  if (!ID_RE.test(id)) return { error: `invalid id "${id}"` };
  if (!status) return { error: 'missing required --status <pending|fixed|wontfix|deferred>' };
  return { id, status, note, commitSha, serverUrl: resolveServerUrl(serverUrl, env), json };
}

export async function patchFeedbackStatus(args: ResolveArgs): Promise<FeedbackRow> {
  const patch: Record<string, unknown> = { status: args.status };
  if (args.note !== null) patch.note = args.note;
  if (args.commitSha !== null) patch.commitSha = args.commitSha;
  const body = await requestJson(
    `${baseUrl(args.serverUrl)}/__pinagent/feedback/${encodeURIComponent(args.id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
  const parsed = FeedbackRowSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(`unexpected PATCH response shape: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function renderResolveResult(row: FeedbackRow): string {
  const loc = row.file ? ` (${row.file}${row.line != null ? `:${row.line}` : ''})` : '';
  return `✓ ${row.id} → ${row.status ?? 'pending'}${loc}\n`;
}
