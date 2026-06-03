// SPDX-License-Identifier: Apache-2.0
/**
 * Embed feedback screenshots into a GitHub PR body.
 *
 * GitHub does NOT render `data:` image URIs in PR/issue markdown, so a
 * base64-inlined screenshot would just show a broken image. The PNG has to
 * live at an http(s) URL GitHub can fetch. The cheapest way to host one from
 * a worktree (no external storage, no extra API) is to commit it onto the PR
 * branch itself and reference its `?raw=true` blob URL — once the branch is
 * pushed, the URL resolves.
 *
 * `.pinagent/` is gitignored (it holds the local DB + raw screenshots), so
 * the asset is force-added (`git add -f`) under `.pinagent/pr-assets/`. Only
 * the explicitly-added asset becomes tracked; the rest of `.pinagent/` stays
 * ignored.
 *
 * Which screenshots belong to a host-branch ("working copy") PR? Inline
 * feedback leaves no per-conversation git trail and is marked resolved the
 * moment the agent finishes — so a branch/commit can't be matched back to it.
 * Instead we use `commitSha` as a "shipped" marker: resolved feedback with a
 * screenshot and a null `commitSha` is sitting in the working copy unshipped;
 * the PR attaches it and the caller stamps the shipped commit onto it, so the
 * next PR won't re-attach it. (Worktree-mode feedback carries a `branch` and
 * its own merge commit, so it's excluded — its changes aren't in the host
 * working copy.)
 *
 * SDK-free and DB-free (git + fs only) so it can be imported from the
 * `@pinagent/agent-runner/pr` entry without bloating the `@pinagent/mcp` bin
 * — the caller supplies the records (and does the stamping) via its own
 * storage.
 */
import { access, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveOriginRemote } from './git-remote';
import { runGitCapture } from './git-utils';

/** A screenshot to attach: the asset id + its on-disk path + an optional caption. */
export interface PrScreenshot {
  /** Conversation id — names the committed asset (`<id>.png`). */
  id: string;
  /** Screenshot path relative to `.pinagent/`, e.g. `screenshots/abc.png`. */
  screenshot: string;
  /** Short caption rendered above the image (typically the developer's comment). */
  caption?: string;
}

/** The subset of a feedback record `selectUnshippedScreenshots` needs. */
export interface FeedbackForScreenshot {
  id: string;
  comment: string;
  /** 'fixed' | 'wontfix' | 'deferred' | 'pending'. */
  status: string;
  /**
   * Worktree branch — non-null for worktree-mode runs, null/absent for inline.
   * Optional because some storage facades (the MCP one) don't surface it; when
   * absent the record is treated as inline (worktree-landed feedback is still
   * excluded by its stamped `commitSha`).
   */
  branch?: string | null;
  /** The commit that shipped this feedback's fix. Null until shipped. */
  commitSha: string | null;
  /** Screenshot path relative to `.pinagent/`, or null/absent if none. */
  screenshot?: string | null;
}

// POSIX-style path for git pathspecs + URL building (NOT path.join, which
// would emit backslashes on Windows and break both git and the URL).
const ASSET_SUBDIR = '.pinagent/pr-assets';

/** First non-empty line of `comment`, trimmed and length-capped, for a caption. */
function captionFor(comment: string): string | undefined {
  const line = comment
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) return undefined;
  return line.length > 100 ? `${line.slice(0, 99)}…` : line;
}

/** Strip markdown-significant chars from alt text and cap its length. */
function altText(caption: string | undefined): string {
  const base = (caption ?? 'clicked element').replace(/[[\]]/g, '');
  return base.length > 120 ? base.slice(0, 120) : base;
}

/** Encode a slash-separated path segment-by-segment (keeps `/` literal). */
function encodePath(p: string): string {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/**
 * Pick the resolved, inline, not-yet-shipped feedback with a screenshot — the
 * conversations whose work is sitting in the current host working copy. These
 * are what a "working copy" / dock PR should show. The caller stamps the
 * shipped commit onto the returned `ids` after the PR succeeds, so a later PR
 * won't re-attach them.
 *
 * Excludes: unresolved feedback, worktree-mode feedback (carries a `branch`;
 * its changes live in a separate worktree, not the host working copy), and
 * already-shipped feedback (non-null `commitSha`).
 */
export function selectUnshippedScreenshots(records: FeedbackForScreenshot[]): {
  shots: PrScreenshot[];
  ids: string[];
} {
  const shots: PrScreenshot[] = [];
  const ids: string[] = [];
  for (const r of records) {
    if (r.status !== 'fixed') continue;
    if (r.branch) continue; // worktree-mode — not in the host working copy
    if (r.commitSha) continue; // already shipped in a prior PR
    if (!r.screenshot) continue;
    shots.push({ id: r.id, screenshot: r.screenshot, caption: captionFor(r.comment) });
    ids.push(r.id);
  }
  return { shots, ids };
}

/**
 * Copy each screenshot into `<commitCwd>/.pinagent/pr-assets/`, force-add +
 * commit them onto the current branch, and return a markdown block of
 * `?raw=true` blob URLs (referencing `branch`) to append to the PR body, plus
 * the ids that were actually committed (so the caller can mark them shipped).
 *
 * Returns empty markdown and commits nothing when there are no usable
 * screenshots or the origin isn't GitHub (the blob URL only resolves on
 * GitHub). Best-effort throughout: a missing screenshot file is skipped and
 * a git failure leaves the body un-augmented rather than failing the PR.
 *
 * Call BEFORE pushing `branch` so the committed asset reaches the remote.
 */
export async function stageScreenshotAssets(
  projectRoot: string,
  commitCwd: string,
  branch: string,
  shots: PrScreenshot[],
): Promise<{ markdown: string; committed: number; ids: string[] }> {
  const empty = { markdown: '', committed: 0, ids: [] as string[] };
  if (shots.length === 0) return empty;

  // Blob URLs only resolve on GitHub — skip silently on other/no remotes.
  const remote = await resolveOriginRemote(projectRoot);
  if (!remote) return empty;

  const destDir = join(commitCwd, '.pinagent', 'pr-assets');
  await mkdir(destDir, { recursive: true });

  const staged: PrScreenshot[] = [];
  for (const shot of shots) {
    const src = join(projectRoot, '.pinagent', shot.screenshot);
    try {
      await access(src);
    } catch {
      continue; // screenshot file gone — skip it
    }
    const rel = `${ASSET_SUBDIR}/${shot.id}.png`;
    await copyFile(src, join(commitCwd, '.pinagent', 'pr-assets', `${shot.id}.png`));
    // `-f` — `.pinagent` is gitignored, so a plain `git add` is a no-op.
    const add = await runGitCapture(commitCwd, ['add', '-f', '--', rel]);
    if (add.code !== 0) continue;
    staged.push(shot);
  }
  if (staged.length === 0) return empty;

  const commit = await runGitCapture(commitCwd, [
    'commit',
    '-m',
    'pinagent: attach feedback screenshots',
  ]);
  // Tolerate "nothing to commit" (identical assets already on the branch).
  if (commit.code !== 0 && !/nothing to commit/.test(`${commit.stdout}\n${commit.stderr}`)) {
    return empty;
  }

  const lines = staged.map((s) => {
    const rel = `${ASSET_SUBDIR}/${s.id}.png`;
    const url = `https://github.com/${remote.owner}/${remote.repo}/blob/${encodePath(
      branch,
    )}/${encodePath(rel)}?raw=true`;
    const img = `![${altText(s.caption)}](${url})`;
    return s.caption ? `**${s.caption}**\n\n${img}` : img;
  });

  const markdown = `\n\n---\n\n### Screenshots\n\n${lines.join('\n\n')}\n`;
  return { markdown, committed: staged.length, ids: staged.map((s) => s.id) };
}
