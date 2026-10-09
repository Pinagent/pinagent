// SPDX-License-Identifier: Apache-2.0
/**
 * One MCP server serving several project roots (a monorepo with several
 * wired apps). Each root has its own real `.pinagent/db.sqlite`; the tools
 * must aggregate listings, route id-addressed calls to the DB holding the
 * id, and make every file path resolvable from outside the app.
 *
 * The single-root contract is covered by call-tool.test.ts (unchanged) plus
 * the `single-root regression` block at the bottom of this file.
 */
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callTool, dispatchTool, toolList } from '../src/index';
import { ProjectSet } from '../src/projects';
import { Storage } from '../src/storage';
import { initProjectDb, readStatus, seedConversation, seedMessages } from './helpers/seed-db';

let base: string;
let web: string;
let mobile: string;

beforeEach(async () => {
  // realpath so macOS's /var -> /private/var symlink doesn't break equality.
  base = realpathSync(await mkdtemp(join(tmpdir(), 'pa-multi-')));
  web = join(base, 'apps', 'web');
  mobile = join(base, 'apps', 'mobile');
  await initProjectDb(web);
  await initProjectDb(mobile);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const multiSet = () =>
  ProjectSet.fromConfig({ multi: true, roots: [web, mobile], workspaceRoot: null });

type Result = Awaited<ReturnType<typeof dispatchTool>>;
const textOf = (res: Result): string => {
  const block = res.content.find((c) => c.type === 'text');
  return block && 'text' in block ? block.text : '';
};

describe('ProjectSet naming', () => {
  it('labels explicit roots relative to their common ancestor', () => {
    expect(
      multiSet()
        .list()
        .map((p) => [p.name, p.root]),
    ).toEqual([
      ['web', web],
      ['mobile', mobile],
    ]);
  });

  it('labels relative to the workspace root when one is configured', () => {
    const set = ProjectSet.fromConfig({ multi: true, roots: [], workspaceRoot: base });
    expect(set.list().map((p) => p.name)).toEqual(['apps/mobile', 'apps/web']);
  });

  it('labels a lone explicit root by its basename', () => {
    const set = ProjectSet.fromConfig({ multi: true, roots: [web], workspaceRoot: null });
    expect(set.list().map((p) => p.name)).toEqual(['web']);
  });
});

describe('multi-root list_pending_feedback', () => {
  beforeEach(() => {
    seedConversation(web, { id: 'cv_web00001', file: 'src/Header.tsx', createdAtMs: 3_000 });
    seedConversation(mobile, { id: 'cv_mob00001', file: 'src/Tab.tsx', createdAtMs: 1_000 });
    seedConversation(mobile, { id: 'cv_mob00002', status: 'fixed', file: 'src/Tab.tsx' });
  });

  it('merges every project oldest-first and labels each item', async () => {
    const res = await dispatchTool(multiSet(), 'list_pending_feedback', {});
    const parsed = JSON.parse(textOf(res));
    expect(parsed.projects).toEqual([
      { name: 'web', root: web },
      { name: 'mobile', root: mobile },
    ]);
    expect(parsed.items).toEqual([
      expect.objectContaining({
        id: 'cv_mob00001',
        project: 'mobile',
        project_root: mobile,
        file: 'src/Tab.tsx',
        abs_file: join(mobile, 'src/Tab.tsx'),
      }),
      expect.objectContaining({
        id: 'cv_web00001',
        project: 'web',
        project_root: web,
        abs_file: join(web, 'src/Header.tsx'),
      }),
    ]);
  });

  it('filters by project name or absolute root', async () => {
    for (const project of ['web', web]) {
      const res = await dispatchTool(multiSet(), 'list_pending_feedback', { project });
      expect(JSON.parse(textOf(res)).items.map((i: { id: string }) => i.id)).toEqual([
        'cv_web00001',
      ]);
    }
  });

  it('errors on an unknown project, naming the valid ones', async () => {
    const res = await dispatchTool(multiSet(), 'list_pending_feedback', { project: 'nope' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('unknown project "nope"');
    expect(textOf(res)).toContain('web');
    expect(textOf(res)).toContain('mobile');
  });

  it('matches the file filter against the absolute path too', async () => {
    const res = await dispatchTool(multiSet(), 'list_pending_feedback', {
      file: 'apps/mobile/',
    });
    expect(JSON.parse(textOf(res)).items.map((i: { id: string }) => i.id)).toEqual(['cv_mob00001']);
  });
});

describe('multi-root id routing', () => {
  it('get_feedback finds an id in a non-first root and names its project', async () => {
    seedConversation(mobile, {
      id: 'cv_mob00003',
      comment: 'bigger tap target',
      file: 'a.tsx',
      line: 4,
    });
    const res = await dispatchTool(multiSet(), 'get_feedback', { id: 'cv_mob00003' });
    expect(res.isError).toBeUndefined();
    const text = textOf(res);
    expect(text).toContain('bigger tap target');
    expect(text).toContain('project: mobile');
    expect(text).toContain(`project root: ${mobile}`);
    expect(text).toContain('target: a.tsx:4');
    expect(text).toContain(`target (absolute): ${join(mobile, 'a.tsx')}:4`);
  });

  it('reports a missing id across every project', async () => {
    const res = await dispatchTool(multiSet(), 'get_feedback', { id: 'cv_missing1' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('not found in any pinagent project');
  });

  it('reports an id present in two DBs as ambiguous, and `project` resolves it', async () => {
    seedConversation(web, { id: 'cv_dupe0001', comment: 'from web' });
    seedConversation(mobile, { id: 'cv_dupe0001', comment: 'from mobile' });
    const amb = await dispatchTool(multiSet(), 'get_feedback', { id: 'cv_dupe0001' });
    expect(amb.isError).toBe(true);
    expect(textOf(amb)).toContain('more than one project (web, mobile)');

    const picked = await dispatchTool(multiSet(), 'get_feedback', {
      id: 'cv_dupe0001',
      project: 'mobile',
    });
    expect(textOf(picked)).toContain('from mobile');
  });

  it('resolve_feedback writes only to the DB that holds the id', async () => {
    seedConversation(web, { id: 'cv_web00002' });
    seedConversation(mobile, { id: 'cv_mob00004' });
    const res = await dispatchTool(multiSet(), 'resolve_feedback', {
      id: 'cv_mob00004',
      status: 'fixed',
    });
    expect(JSON.parse(textOf(res))).toMatchObject({ ok: true, status: 'fixed', project: 'mobile' });
    expect(readStatus(mobile, 'cv_mob00004')).toBe('fixed');
    expect(readStatus(web, 'cv_web00002')).toBe('pending');
    expect(readStatus(web, 'cv_mob00004')).toBeUndefined();
  });

  it('get_conversation_transcript reads the owning DB', async () => {
    seedConversation(mobile, { id: 'cv_mobtr001' });
    seedMessages(mobile, 'cv_mobtr001', ['hello from mobile']);
    const res = await dispatchTool(multiSet(), 'get_conversation_transcript', {
      id: 'cv_mobtr001',
    });
    expect(textOf(res)).toContain('hello from mobile');

    const missing = await dispatchTool(multiSet(), 'get_conversation_transcript', {
      id: 'cv_nothere1',
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('conversation cv_nothere1 not found');
  });

  it('an id living in an app discovered after startup is still found', async () => {
    let t = 0;
    const set = ProjectSet.fromConfig(
      { multi: true, roots: [], workspaceRoot: base },
      { now: () => t },
    );
    expect(set.list()).toHaveLength(2);
    const late = join(base, 'apps', 'late');
    await initProjectDb(late);
    seedConversation(late, { id: 'cv_late0001' });
    t += 1; // well inside the rescan window — the miss forces a fresh scan
    const res = await dispatchTool(set, 'get_feedback', { id: 'cv_late0001' });
    expect(res.isError).toBeUndefined();
    expect(textOf(res)).toContain('project: apps/late');
  });
});

describe('multi-root get_source_context', () => {
  beforeEach(async () => {
    await mkdir(join(web, 'src'), { recursive: true });
    await mkdir(join(mobile, 'src'), { recursive: true });
    await writeFile(join(web, 'src', 'Only.tsx'), 'web line 1\nweb line 2', 'utf8');
    await writeFile(join(web, 'src', 'Both.tsx'), 'web both', 'utf8');
    await writeFile(join(mobile, 'src', 'Both.tsx'), 'mobile both', 'utf8');
  });

  it('accepts an absolute path inside a served root and labels the output absolutely', async () => {
    const abs = join(mobile, 'src', 'Both.tsx');
    const res = await dispatchTool(multiSet(), 'get_source_context', { file: abs, line: 1 });
    expect(res.isError).toBeUndefined();
    expect(textOf(res)).toContain(`${abs} (lines 1-1, target 1)`);
    expect(textOf(res)).toContain('mobile both');
  });

  it('resolves a relative path that exists in exactly one project', async () => {
    const res = await dispatchTool(multiSet(), 'get_source_context', {
      file: 'src/Only.tsx',
      line: 2,
    });
    expect(textOf(res)).toContain('web line 2');
  });

  it('refuses to guess when a relative path exists in several projects', async () => {
    const res = await dispatchTool(multiSet(), 'get_source_context', {
      file: 'src/Both.tsx',
      line: 1,
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('more than one project');
    const scoped = await dispatchTool(multiSet(), 'get_source_context', {
      file: 'src/Both.tsx',
      line: 1,
      project: 'mobile',
    });
    expect(textOf(scoped)).toContain('mobile both');
  });

  it('keeps the traversal and outside-root guards', async () => {
    const dots = await dispatchTool(multiSet(), 'get_source_context', {
      file: '../web/src/Only.tsx',
      line: 1,
      project: 'mobile',
    });
    expect(textOf(dots)).toContain('path traversal not allowed');

    const outside = await dispatchTool(multiSet(), 'get_source_context', {
      file: '/etc/hosts',
      line: 1,
    });
    expect(outside.isError).toBe(true);
    expect(textOf(outside)).toContain('outside every pinagent project root');

    const scopedOutside = await dispatchTool(multiSet(), 'get_source_context', {
      file: join(web, 'src', 'Only.tsx'),
      line: 1,
      project: 'mobile',
    });
    expect(textOf(scopedOutside)).toContain('path outside project root');
  });
});

describe('multi-root create_pull_request', () => {
  it('requires `project` when several projects are served', async () => {
    const res = await dispatchTool(multiSet(), 'create_pull_request', { title: 't', body: 'b' });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain('needs `project`');
  });

  it('routes to the selected project root', async () => {
    // Temp dirs are not git repos — the PR helper's first check proves which
    // root it was handed without touching any real remote.
    const res = await dispatchTool(multiSet(), 'create_pull_request', {
      title: 't',
      body: 'b',
      project: 'web',
    });
    expect(textOf(res)).toContain('not a git repository');
  });
});

describe('toolList', () => {
  it('is the unchanged single-root list when not multi', () => {
    const tools = toolList(false);
    expect(tools.map((t) => t.name)).toEqual([
      'list_pending_feedback',
      'get_feedback',
      'resolve_feedback',
      'get_source_context',
      'get_conversation_transcript',
      'create_pull_request',
    ]);
    for (const t of tools) {
      expect(Object.keys(t.inputSchema.properties)).not.toContain('project');
    }
  });

  it('adds an optional `project` parameter to every tool when multi', () => {
    for (const t of toolList(true)) {
      expect(t.inputSchema.properties).toHaveProperty('project');
      expect(t.inputSchema.required ?? []).not.toContain('project');
    }
  });
});

describe('single-root regression', () => {
  it('callTool output carries no project fields and keeps the classic errors', async () => {
    seedConversation(web, { id: 'cv_single01', file: 'src/A.tsx', line: 3 });
    const storage = new Storage(web);
    const list = JSON.parse(textOf(await callTool(storage, web, 'list_pending_feedback', {})));
    expect(Object.keys(list)).toEqual(['items']);
    expect(Object.keys(list.items[0])).toEqual([
      'id',
      'comment_preview',
      'file',
      'line',
      'url',
      'created_at',
    ]);

    const got = textOf(await callTool(storage, web, 'get_feedback', { id: 'cv_single01' }));
    expect(got).not.toContain('project');
    expect(got).not.toContain('absolute');

    const missing = await callTool(storage, web, 'get_feedback', { id: 'cv_missing9' });
    expect(textOf(missing)).toBe('feedback cv_missing9 not found');

    // A stray `project` argument is ignored, not rejected.
    const ignored = await callTool(storage, web, 'get_feedback', {
      id: 'cv_single01',
      project: 'whatever',
    });
    expect(ignored.isError).toBeUndefined();

    const resolved = JSON.parse(
      textOf(
        await callTool(storage, web, 'resolve_feedback', { id: 'cv_single01', status: 'fixed' }),
      ),
    );
    expect(resolved).toEqual({ ok: true, id: 'cv_single01', status: 'fixed' });
  });

  it('a single-root set never sees ids from other DBs', async () => {
    seedConversation(mobile, { id: 'cv_mobonly1' });
    const res = await dispatchTool(ProjectSet.single(web), 'get_feedback', { id: 'cv_mobonly1' });
    expect(textOf(res)).toBe('feedback cv_mobonly1 not found');
  });
});
