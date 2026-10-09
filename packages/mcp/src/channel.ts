// SPDX-License-Identifier: Apache-2.0
import { resolve } from 'node:path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Project, ProjectSet } from './projects';

const POLL_MS = 500;

/**
 * Push a `notifications/claude/channel` event to the Claude Code
 * session for each new pending feedback that lands in the SQLite
 * store.
 *
 * v1 used `fs.watch` on `.pinagent/feedback/`. v2 uses SQLite as the
 * source of truth, and there's no portable cross-process change
 * notification for SQLite — so this is a half-second poll. Cheap
 * (one SELECT per tick) and good enough for interactive feedback.
 *
 * Silently no-ops if Claude Code wasn't started with
 * `--dangerously-load-development-channels server:pinagent`.
 *
 * A multi-root server polls every project's DB in the same loop and tags
 * each event with the project it came from.
 */
export async function startFeedbackWatcher(
  projects: ProjectSet,
  mcp: Server,
  log: (msg: string) => void,
  opts: { pollMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? POLL_MS;
  // Seed the "already seen" set so we only push events for items
  // that arrive AFTER the session starts. Keys are root-qualified: each
  // project has its own DB, and the id namespace is per-DB.
  const startedAt = Date.now();
  const seen = new Set<string>();
  const watched = new Set<string>();
  const key = (p: Project, id: string) => `${p.root}\0${id}`;

  // `initial` projects ignore their whole existing backlog (the classic
  // behaviour). A project discovered mid-session — an app whose dev server
  // first ran after we started — only ignores what predates the session, so
  // the comment that created its `.pinagent/` still gets pushed.
  const seed = async (p: Project, initial: boolean) => {
    watched.add(p.root);
    try {
      for (const rec of await p.storage.list()) {
        if (initial || Date.parse(rec.createdAt) < startedAt) seen.add(key(p, rec.id));
      }
    } catch {
      // Empty / not-yet-migrated DB is fine — we'll discover items on
      // the first poll.
    }
  };
  for (const p of projects.list()) await seed(p, true);

  log(
    projects.multi
      ? `channel watcher started (polling ${watched.size} SQLite store(s), ${seen.size} pre-existing item(s) ignored)`
      : `channel watcher started (polling SQLite, ${seen.size} pre-existing item(s) ignored)`,
  );

  // Fire-and-forget poll loop for the life of the process.
  void (async () => {
    while (!opts.signal?.aborted) {
      await new Promise((r) => setTimeout(r, pollMs));
      if (opts.signal?.aborted) return;
      for (const p of projects.list()) {
        if (!watched.has(p.root)) {
          await seed(p, false);
          log(`watching new project ${p.name} (${p.root})`);
        }
        await pollProject(p);
      }
    }
  })();

  async function pollProject(p: Project): Promise<void> {
    let items: Awaited<ReturnType<typeof p.storage.list>>;
    try {
      items = await p.storage.list();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`watcher poll failed${projects.multi ? ` for ${p.name}` : ''}: ${msg}`);
      return;
    }
    for (const rec of items) {
      if (seen.has(key(p, rec.id))) continue;
      seen.add(key(p, rec.id));
      if (rec.status !== 'pending') continue;

      // Cmd/Ctrl-click multi-select: the one comment applies to every
      // picked element. The channel meta is a flat string map, so encode
      // the extras as a compact `file:line:col` (or selector) list that
      // the agent can act on alongside the primary file/line/col.
      const additional = (rec.additionalAnchors ?? [])
        .map((a) =>
          a.file ? `${a.file}:${a.line ?? '?'}${a.col != null ? `:${a.col}` : ''}` : a.selector,
        )
        .join(', ');

      try {
        await mcp.notification({
          method: 'notifications/claude/channel',
          params: {
            content: rec.comment,
            meta: {
              id: rec.id,
              // Multi-root: `file` stays relative to the app it came from,
              // so say which app (`project`, `root`) and give the absolute
              // path — the session's cwd is usually the monorepo root.
              ...(projects.multi ? { project: p.name, root: p.root } : {}),
              file: rec.file ?? '',
              ...(projects.multi && rec.file ? { absFile: resolve(p.root, rec.file) } : {}),
              line: rec.line != null ? String(rec.line) : '',
              col: rec.col != null ? String(rec.col) : '',
              selector: rec.selector,
              url: rec.url,
              ...(additional ? { additionalTargets: additional } : {}),
            },
          },
        });
        log(
          `pushed channel event for ${rec.id} (${projects.multi ? `${p.name}: ` : ''}${rec.file ?? rec.selector})`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`channel notify failed for ${rec.id}: ${msg}`);
      }
    }
  }
}

export const CHANNEL_INSTRUCTIONS = [
  'You have a Pinagent channel registered. Pinagent feedback events arrive as:',
  '',
  '  <channel source="pinagent" id="..." file="src/Foo.tsx" line="42" col="7" url="..." selector="...">',
  "  the developer's comment text",
  '  </channel>',
  '',
  'When you receive one of these events, act on it without waiting for further instructions:',
  '  1. Call the pinagent MCP tool `get_feedback` with the id from the tag — this returns',
  '     the full comment plus a screenshot of what the developer selected.',
  '  2. Make the requested code change. Be conservative: only change what the comment asks for.',
  '     The `file`, `line`, and `col` attributes on the tag point directly at the JSX element',
  '     the developer clicked, so start there.',
  '  3. Call `resolve_feedback` with status="fixed" and a short note describing what you did.',
  '     If you cannot apply the change, use status="wontfix" with an explanation.',
  '',
  'If the tag carries an `additionalTargets` attribute (a comma-separated list of',
  'file:line locations), the developer multi-selected several elements and the one',
  'comment applies to ALL of them — address the primary `file`/`line` target AND',
  'every location in `additionalTargets` before resolving.',
  '',
  'Multiple events may arrive together. Handle them in order.',
].join('\n');

/**
 * Instructions for a server covering several projects (one per app). Same
 * flow as `CHANNEL_INSTRUCTIONS`; the tag additionally says which app the
 * comment came from, and `file` must be read relative to that app.
 */
export const MULTI_CHANNEL_INSTRUCTIONS = [
  'You have a Pinagent channel registered. This one server covers several Pinagent',
  'projects (one per app, each with its own feedback store). Feedback events arrive as:',
  '',
  '  <channel source="pinagent" id="..." project="apps/web" root="/abs/path/apps/web" file="src/Foo.tsx" absFile="/abs/path/apps/web/src/Foo.tsx" line="42" col="7" url="..." selector="...">',
  "  the developer's comment text",
  '  </channel>',
  '',
  '`project` names the app the developer clicked in and `root` is its absolute directory.',
  '`file` (and every entry in `additionalTargets`) is relative to `root`, NOT to your',
  'working directory — open `absFile`, or join `root` + `file`.',
  '',
  'When you receive one of these events, act on it without waiting for further instructions:',
  '  1. Call the pinagent MCP tool `get_feedback` with the id from the tag — this returns',
  '     the full comment plus a screenshot of what the developer selected. The id is looked',
  '     up across every project, so you do not need to pick one.',
  '  2. Make the requested code change. Be conservative: only change what the comment asks for.',
  '     The `absFile`, `line`, and `col` attributes on the tag point directly at the JSX element',
  '     the developer clicked, so start there.',
  '  3. Call `resolve_feedback` with status="fixed" and a short note describing what you did.',
  '     If you cannot apply the change, use status="wontfix" with an explanation.',
  '',
  'If the tag carries an `additionalTargets` attribute (a comma-separated list of',
  'file:line locations, relative to `root`), the developer multi-selected several elements',
  'and the one comment applies to ALL of them — address the primary target AND every',
  'location in `additionalTargets` before resolving.',
  '',
  '`list_pending_feedback` aggregates every project and labels each item with its `project`.',
  'For `get_source_context`, pass an absolute path (or `project` plus a root-relative file);',
  '`create_pull_request` needs `project` when more than one project is served.',
  '',
  'Multiple events may arrive together. Handle them in order.',
].join('\n');
