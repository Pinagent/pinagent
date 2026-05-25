import { existsSync, mkdirSync } from 'node:fs';
import { watch } from 'node:fs/promises';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ID_RE, type Storage } from './storage';

/**
 * Watch the feedback directory and push a `notifications/claude/channel` event
 * to the Claude Code session each time a new feedback record lands on disk.
 *
 * The channel notification is silently dropped if Claude Code wasn't started
 * with `--dangerously-load-development-channels server:pinpoint`, so this is
 * safe to enable unconditionally.
 */
export async function startFeedbackWatcher(
  storage: Storage,
  mcp: Server,
  log: (msg: string) => void,
): Promise<void> {
  if (!existsSync(storage.feedbackDir)) {
    mkdirSync(storage.feedbackDir, { recursive: true });
  }

  // Seed the "already seen" set with whatever's on disk at startup. We only
  // want to push events for items that arrive AFTER the session is running.
  const seen = new Set<string>();
  try {
    for (const rec of await storage.list()) {
      seen.add(rec.id);
    }
  } catch {
    // ignore — empty dir is fine
  }

  log(
    `channel watcher started on ${storage.feedbackDir} (${seen.size} pre-existing item(s) ignored)`,
  );

  // Fire-and-forget: this async loop runs for the life of the process.
  void (async () => {
    try {
      for await (const event of watch(storage.feedbackDir)) {
        const name = event.filename;
        if (!name || !name.endsWith('.json') || name.endsWith('.tmp.json')) continue;
        const id = name.slice(0, -'.json'.length);
        if (!ID_RE.test(id)) continue;
        if (seen.has(id)) continue;

        // Atomic rename should make this unnecessary, but if the writer is
        // mid-rename, a tiny delay avoids a partial read.
        await new Promise((r) => setTimeout(r, 25));
        const rec = await storage.read(id);
        if (!rec) continue;
        seen.add(id);
        if (rec.status !== 'pending') continue;

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
              },
            },
          });
          log(`pushed channel event for ${rec.id} (${rec.file ?? rec.selector})`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(`channel notify failed for ${rec.id}: ${msg}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`watcher exited: ${msg}`);
    }
  })();
}

export const CHANNEL_INSTRUCTIONS = [
  'You have a Pinpoint channel registered. Pinpoint feedback events arrive as:',
  '',
  '  <channel source="pinpoint" id="..." file="src/Foo.tsx" line="42" col="7" url="..." selector="...">',
  '  the developer\'s comment text',
  '  </channel>',
  '',
  'When you receive one of these events, act on it without waiting for further instructions:',
  '  1. Call the pinpoint MCP tool `get_feedback` with the id from the tag — this returns',
  '     the full comment plus a screenshot of what the developer selected.',
  '  2. Make the requested code change. Be conservative: only change what the comment asks for.',
  '     The `file`, `line`, and `col` attributes on the tag point directly at the JSX element',
  '     the developer clicked, so start there.',
  '  3. Call `resolve_feedback` with status="fixed" and a short note describing what you did.',
  '     If you cannot apply the change, use status="wontfix" with an explanation.',
  '',
  'Multiple events may arrive together. Handle them in order.',
].join('\n');
