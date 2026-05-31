// SPDX-License-Identifier: Apache-2.0
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Storage } from './storage';

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
 */
export async function startFeedbackWatcher(
  storage: Storage,
  mcp: Server,
  log: (msg: string) => void,
): Promise<void> {
  // Seed the "already seen" set so we only push events for items
  // that arrive AFTER the session starts.
  const seen = new Set<string>();
  try {
    for (const rec of await storage.list()) seen.add(rec.id);
  } catch {
    // Empty / not-yet-migrated DB is fine — we'll discover items on
    // the first poll.
  }

  log(`channel watcher started (polling SQLite, ${seen.size} pre-existing item(s) ignored)`);

  // Fire-and-forget poll loop for the life of the process.
  void (async () => {
    while (true) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      let items: Awaited<ReturnType<typeof storage.list>>;
      try {
        items = await storage.list();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`watcher poll failed: ${msg}`);
        continue;
      }
      for (const rec of items) {
        if (seen.has(rec.id)) continue;
        seen.add(rec.id);
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
                file: rec.file ?? '',
                line: rec.line != null ? String(rec.line) : '',
                col: rec.col != null ? String(rec.col) : '',
                selector: rec.selector,
                url: rec.url,
                ...(additional ? { additionalTargets: additional } : {}),
              },
            },
          });
          log(`pushed channel event for ${rec.id} (${rec.file ?? rec.selector})`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(`channel notify failed for ${rec.id}: ${msg}`);
        }
      }
    }
  })();
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
