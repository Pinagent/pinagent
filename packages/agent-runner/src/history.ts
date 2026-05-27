// SPDX-License-Identifier: Apache-2.0
/**
 * `searchHistory` — server-side full-text search over resolved
 * conversations. Backs the dock's History route once the user types in
 * the search input.
 *
 * v1 uses SQLite LIKE with `%query%` against five columns: comment,
 * note, branch, anchor file, anchor selector. Good enough for a typical
 * project (<10k conversations); FTS5 is the natural next step once a
 * project starts feeling the LIKE scan, and the query shape here is
 * compatible with swapping in `match` against an FTS5 virtual table.
 *
 * Status filter: 'all' means any resolved conversation (worktreeState
 * landed | discarded, OR status wontfix — see status-derive in the
 * dock for the full mapping). 'landed' / 'discarded' narrow further.
 */
import { and, conversations, eq, inArray, like, or, widgetAnchors } from '@pinagent/db';
import type { SQL } from 'drizzle-orm';
import { getDb } from './db/client';

export type HistoryStatusFilter = 'all' | 'landed' | 'discarded';

export interface HistorySearchOpts {
  query: string;
  status?: HistoryStatusFilter;
  /** Cap result count to bound payload. Default 50. */
  limit?: number;
}

export type MatchedField = 'comment' | 'note' | 'branch' | 'anchor' | 'selector';

export interface HistorySearchHit {
  id: string;
  comment: string;
  status: 'fixed' | 'wontfix' | 'pending' | 'deferred';
  worktreeState: 'none' | 'active' | 'landed' | 'discarded';
  branch: string | null;
  file: string | null;
  line: number | null;
  col: number | null;
  selector: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Which columns matched the query — helps the dock label hits. */
  matchedFields: MatchedField[];
  /** Trimmed excerpt around the comment match. Empty if no comment match. */
  snippet: string;
}

const MAX_QUERY_LEN = 200;
const SNIPPET_RADIUS = 40;

export async function searchHistory(
  projectRoot: string,
  opts: HistorySearchOpts,
): Promise<HistorySearchHit[]> {
  const trimmed = opts.query.trim();
  if (trimmed.length === 0) return [];
  const query = trimmed.slice(0, MAX_QUERY_LEN);
  const limit = Math.min(opts.limit ?? 50, 200);

  // Drizzle's `like()` doesn't expose ESCAPE in this version, so we
  // leave `%` and `_` in the query as literal wildcards. Harmless for
  // search UX: a query containing `%` just matches more broadly than
  // the user typed; never under-matches. Real LIKE escaping comes with
  // the FTS5 swap that's already shaped on the horizon.
  const pattern = `%${query}%`;

  // "Resolved" predicate: anything past the active stage. Mirrors the
  // dock's status-derive: worktreeState landed/discarded OR status
  // wontfix (inline-mode rows that the agent marked unfixable).
  const statusFilter = opts.status ?? 'all';
  const resolvedPredicates: SQL[] = [];
  if (statusFilter === 'landed') {
    resolvedPredicates.push(eq(conversations.worktreeState, 'landed'));
  } else if (statusFilter === 'discarded') {
    const orExpr = or(
      eq(conversations.worktreeState, 'discarded'),
      eq(conversations.status, 'wontfix'),
    );
    if (orExpr) resolvedPredicates.push(orExpr);
  } else {
    const orExpr = or(
      inArray(conversations.worktreeState, ['landed', 'discarded']),
      eq(conversations.status, 'wontfix'),
    );
    if (orExpr) resolvedPredicates.push(orExpr);
  }

  const matchPredicate = or(
    like(conversations.comment, pattern),
    like(conversations.note, pattern),
    like(conversations.branch, pattern),
    like(widgetAnchors.file, pattern),
    like(widgetAnchors.selector, pattern),
  );
  if (!matchPredicate) return [];

  const where = and(...resolvedPredicates, matchPredicate);
  const db = getDb(projectRoot);
  const rows = await db
    .select()
    .from(conversations)
    .leftJoin(widgetAnchors, eq(conversations.id, widgetAnchors.conversationId))
    .where(where)
    .limit(limit);

  const lowerQuery = query.toLowerCase();
  return rows.map((row) => {
    const c = row.conversations;
    const a = row.widget_anchors;
    const matched: MatchedField[] = [];
    if (c.comment.toLowerCase().includes(lowerQuery)) matched.push('comment');
    if (c.note?.toLowerCase().includes(lowerQuery)) matched.push('note');
    if (c.branch?.toLowerCase().includes(lowerQuery)) matched.push('branch');
    if (a?.file?.toLowerCase().includes(lowerQuery)) matched.push('anchor');
    if (a?.selector?.toLowerCase().includes(lowerQuery)) matched.push('selector');

    return {
      id: c.id,
      comment: c.comment,
      status: c.status,
      worktreeState: c.worktreeState,
      branch: c.branch,
      file: a?.file ?? null,
      line: a?.line ?? null,
      col: a?.col ?? null,
      selector: a?.selector ?? '',
      url: a?.url ?? '',
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      resolvedAt: c.resolvedAt?.toISOString() ?? null,
      matchedFields: matched,
      snippet: matched.includes('comment') ? snippetAround(c.comment, lowerQuery) : '',
    };
  });
}

/**
 * Take a comment and return ~80 chars of context around the first
 * match, with ellipses for trimmed sides. Lets the History row show
 * "…leading text [match] trailing…" without dumping the whole comment.
 */
function snippetAround(text: string, lowerNeedle: string): string {
  const idx = text.toLowerCase().indexOf(lowerNeedle);
  if (idx < 0) return text.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + lowerNeedle.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}
