// SPDX-License-Identifier: Apache-2.0
/**
 * The channel watcher polls each served project's SQLite store and pushes a
 * `notifications/claude/channel` event per new pending item. Driven against
 * real temp DBs with a fake MCP server that records notifications.
 */
import { realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFeedbackWatcher } from '../src/channel';
import { ProjectSet } from '../src/projects';
import { initProjectDb, seedConversation } from './helpers/seed-db';

interface Pushed {
  method: string;
  params: { content: string; meta: Record<string, string> };
}

let base: string;
let web: string;
let mobile: string;
let abort: AbortController;
let pushed: Pushed[];
const fakeServer = () =>
  ({
    notification: async (n: Pushed) => {
      pushed.push(n);
    },
  }) as unknown as Server;

beforeEach(async () => {
  base = realpathSync(await mkdtemp(join(tmpdir(), 'pa-channel-')));
  web = join(base, 'apps', 'web');
  mobile = join(base, 'apps', 'mobile');
  await initProjectDb(web);
  await initProjectDb(mobile);
  abort = new AbortController();
  pushed = [];
});

afterEach(async () => {
  abort.abort();
  await rm(base, { recursive: true, force: true });
});

const waitFor = async (cond: () => boolean, ms = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for channel event');
    await new Promise((r) => setTimeout(r, 10));
  }
};

const noop = () => {};

describe('startFeedbackWatcher (single root)', () => {
  it('pushes new items with the classic meta and ignores the backlog', async () => {
    seedConversation(web, { id: 'cv_backlog1', file: 'src/Old.tsx' });
    await startFeedbackWatcher(ProjectSet.single(web), fakeServer(), noop, {
      pollMs: 20,
      signal: abort.signal,
    });
    seedConversation(web, { id: 'cv_newitem1', comment: 'hi', file: 'src/New.tsx', line: 7 });
    await waitFor(() => pushed.length > 0);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.params.content).toBe('hi');
    expect(pushed[0]!.params.meta).toEqual({
      id: 'cv_newitem1',
      file: 'src/New.tsx',
      line: '7',
      col: '',
      selector: 'div',
      url: 'http://localhost:3000/',
    });
  });
});

describe('startFeedbackWatcher (multi root)', () => {
  it('watches every root and tags events with project, root and absolute file', async () => {
    seedConversation(mobile, { id: 'cv_backlog2' });
    const set = ProjectSet.fromConfig({ multi: true, roots: [web, mobile], workspaceRoot: null });
    await startFeedbackWatcher(set, fakeServer(), noop, { pollMs: 20, signal: abort.signal });
    seedConversation(mobile, { id: 'cv_mobnew01', file: 'src/Tab.tsx', line: 3 });
    seedConversation(web, { id: 'cv_webnew01', file: 'src/Nav.tsx', line: 9 });
    await waitFor(() => pushed.length >= 2);
    const byId = Object.fromEntries(pushed.map((p) => [p.params.meta.id, p.params.meta]));
    expect(Object.keys(byId).sort()).toEqual(['cv_mobnew01', 'cv_webnew01']);
    expect(byId.cv_mobnew01).toMatchObject({
      project: 'mobile',
      root: mobile,
      file: 'src/Tab.tsx',
      absFile: join(mobile, 'src/Tab.tsx'),
      line: '3',
    });
    expect(byId.cv_webnew01).toMatchObject({ project: 'web', root: web });
  });

  it('pushes the first comment of an app discovered after startup', async () => {
    const set = ProjectSet.fromConfig(
      { multi: true, roots: [], workspaceRoot: base },
      { rescanMs: 0 },
    );
    await startFeedbackWatcher(set, fakeServer(), noop, { pollMs: 20, signal: abort.signal });
    const late = join(base, 'apps', 'late');
    await initProjectDb(late);
    seedConversation(late, { id: 'cv_late0002', file: 'src/X.tsx' });
    await waitFor(() => pushed.length > 0);
    expect(pushed[0]!.params.meta).toMatchObject({ id: 'cv_late0002', project: 'apps/late' });
  });
});
