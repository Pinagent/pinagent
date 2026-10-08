// SPDX-License-Identifier: Apache-2.0
/**
 * Monorepo permission scope for the spawned Claude agent.
 *
 * Regression: in a monorepo the agent's `cwd` is the app subdirectory, so a
 * read of a sibling workspace package (`<repo>/packages/ui/...`) is outside
 * the working directory and needs a permission prompt — which a headless run
 * silently denies. The agent then burned ~10 tool calls retrying the read
 * before giving up. `buildSdkOptions` now hands the SDK the enclosing repo
 * root via `additionalDirectories`.
 *
 * Pinned here, against real throwaway repos:
 *   - an app subdir of a git repo gets the git toplevel
 *   - a pinagent worktree (cwd == its own toplevel) gets nothing — never the
 *     primary checkout
 *   - without git, a pnpm / npm-workspaces marker is the fallback
 *   - `cwd` itself, `~`, and anything at or above `~` are never granted
 *   - the provider passes the result to `query()`, and dry-run still installs
 *     its deny gate alongside it
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/claude-agent-sdk')>(
    '@anthropic-ai/claude-agent-sdk',
  );
  return { ...actual, query: vi.fn() };
});

type WorkspaceRootMod = typeof import('../src/workspace-root');
type ProviderMod = typeof import('../src/providers/claude-code');
type SdkMod = typeof import('@anthropic-ai/claude-agent-sdk');

let resolveDirs: WorkspaceRootMod['resolveWorkspaceAdditionalDirectories'];
let providerMod: ProviderMod;
let sdk: SdkMod;

let base: string;
const priorHome = process.env.HOME;

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

async function makeGitMonorepo(name: string): Promise<{ repo: string; app: string }> {
  const repo = join(base, name);
  const app = join(repo, 'apps', 'web');
  await mkdir(app, { recursive: true });
  await mkdir(join(repo, 'packages', 'ui'), { recursive: true });
  await writeFile(join(repo, 'packages', 'ui', 'index.ts'), 'export {};\n');
  await writeFile(join(app, 'page.tsx'), 'export {};\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  return { repo, app };
}

beforeAll(async () => {
  // realpath: macOS tmpdir is a /var → /private/var symlink and git reports
  // the resolved path; the helper normalizes, so compare against that too.
  base = await realpath(await mkdtemp(join(tmpdir(), 'pa-wsroot-')));
  ({ resolveWorkspaceAdditionalDirectories: resolveDirs } = await import('../src/workspace-root'));
  providerMod = await import('../src/providers/claude-code');
  sdk = await import('@anthropic-ai/claude-agent-sdk');
});

afterEach(() => {
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('resolveWorkspaceAdditionalDirectories', () => {
  it('grants the git toplevel when cwd is an app subdirectory', async () => {
    const { repo, app } = await makeGitMonorepo('git-mono');
    expect(await resolveDirs(app)).toEqual([repo]);
  });

  it('grants nothing when cwd is already the git toplevel', async () => {
    const { repo } = await makeGitMonorepo('git-root');
    expect(await resolveDirs(repo)).toEqual([]);
  });

  it("grants nothing for a linked worktree — never the primary checkout's root", async () => {
    // Mirrors createWorktree: <projectRoot>/.pinagent/worktrees/<id>, nested
    // inside the primary checkout.
    const { repo } = await makeGitMonorepo('git-wt');
    const wt = join(repo, '.pinagent', 'worktrees', 'fb1');
    git(repo, 'worktree', 'add', '-q', '-b', 'pinagent/fb1', wt);
    expect(await resolveDirs(wt)).toEqual([]);
    // A subdir of the worktree resolves to the worktree root, not `repo`.
    expect(await resolveDirs(join(wt, 'apps', 'web'))).toEqual([wt]);
  });

  it('does not climb from a worktree into a primary checkout with a workspace marker', async () => {
    // The git toplevel (== cwd) is rejected; the marker fallback must not
    // then walk up out of .pinagent/worktrees into the primary checkout.
    const { repo } = await makeGitMonorepo('git-wt-marker');
    await writeFile(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    const wt = join(repo, '.pinagent', 'worktrees', 'fb2');
    git(repo, 'worktree', 'add', '-q', '-b', 'pinagent/fb2', wt);
    expect(await resolveDirs(wt)).toEqual([]);
  });

  it('falls back to a pnpm-workspace.yaml marker without git', async () => {
    const root = join(base, 'pnpm-mono');
    const app = join(root, 'apps', 'web');
    await mkdir(app, { recursive: true });
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    expect(await resolveDirs(app)).toEqual([root]);
  });

  it('falls back to a package.json "workspaces" marker without git', async () => {
    const root = join(base, 'npm-mono');
    const app = join(root, 'apps', 'web');
    await mkdir(app, { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
    // A plain package.json without `workspaces` in between is not a root.
    await writeFile(join(root, 'apps', 'package.json'), JSON.stringify({ name: 'x' }));
    expect(await resolveDirs(app)).toEqual([root]);
  });

  it('grants nothing outside a repo or workspace', async () => {
    const lone = join(base, 'lone', 'app');
    await mkdir(lone, { recursive: true });
    expect(await resolveDirs(lone)).toEqual([]);
  });

  it('never grants the home directory (e.g. a dotfiles repo at ~)', async () => {
    const { repo, app } = await makeGitMonorepo('home-repo');
    process.env.HOME = repo;
    expect(await resolveDirs(app)).toEqual([]);
    // Nor a workspace marker that sits at ~.
    const home = join(base, 'home-marker');
    const app2 = join(home, 'apps', 'web');
    await mkdir(app2, { recursive: true });
    await writeFile(join(home, 'pnpm-workspace.yaml'), 'packages: []\n');
    process.env.HOME = home;
    expect(await resolveDirs(app2)).toEqual([]);
  });

  it('fails soft on a missing cwd', async () => {
    expect(await resolveDirs(join(base, 'does-not-exist'))).toEqual([]);
  });
});

describe('ClaudeCodeProvider → query() options', () => {
  async function captureOptions(
    cwd: string,
    permissionMode: 'acceptEdits' | 'plan',
  ): Promise<NonNullable<Parameters<SdkMod['query']>[0]['options']>> {
    let captured: Parameters<SdkMod['query']>[0] | undefined;
    (sdk.query as Mock).mockImplementation((params: Parameters<SdkMod['query']>[0]) => {
      captured = params;
      return (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          total_cost_usd: 0,
          duration_ms: 0,
        } as unknown as SDKMessage;
      })();
    });
    const provider = new providerMod.ClaudeCodeProvider();
    for await (const _ of provider.run({
      projectRoot: cwd,
      feedbackId: 'fb-wsroot',
      cwd,
      prompt: 'hi',
      isInitial: true,
      permissionMode,
      abortSignal: new AbortController().signal,
    })) {
      // drain
    }
    expect(captured?.options).toBeDefined();
    return captured!.options!;
  }

  it('passes the monorepo root as additionalDirectories', async () => {
    const { repo, app } = await makeGitMonorepo('provider-mono');
    const opts = await captureOptions(app, 'acceptEdits');
    expect(opts.cwd).toBe(app);
    expect(opts.additionalDirectories).toEqual([repo]);
  });

  it('omits additionalDirectories when cwd is the repo root', async () => {
    const { repo } = await makeGitMonorepo('provider-root');
    const opts = await captureOptions(repo, 'acceptEdits');
    expect(opts).not.toHaveProperty('additionalDirectories');
  });

  it('keeps the dry-run deny gate alongside the widened scope', async () => {
    const { repo, app } = await makeGitMonorepo('provider-plan');
    const opts = await captureOptions(app, 'plan');
    expect(opts.additionalDirectories).toEqual([repo]);
    const ctx = { signal: new AbortController().signal, toolUseID: 't' };
    const edit = await opts.canUseTool!(
      'Edit',
      { file_path: join(repo, 'packages', 'ui', 'index.ts') },
      ctx,
    );
    expect(edit.behavior).toBe('deny');
  });
});
