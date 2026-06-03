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
 * SDK-free and DB-free (git + fs only) so it can be imported from the
 * `@pinagent/agent-runner/pr` entry without bloating the `@pinagent/mcp` bin
 * — the caller supplies the candidate records from whatever storage it holds.
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

/**
 * A resolved-feedback record that *might* belong to the PR branch. The
 * host-branch flow has no explicit conversation list, so it matches these
 * against the commits on the branch via `commitSha`.
 */
export interface ScreenshotCandidate {
  id: string;
  /** Screenshot path relative to `.pinagent/`. */
  screenshot: string;
  /** Resolution commit recorded by `resolve_feedback`, or null if none. */
  commitSha: string | null;
  /** The developer's original comment — used as the image caption. */
  comment: string;
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
 * Select which candidate screenshots belong to the PR branch by matching
 * each candidate's resolution `commitSha` against the commits unique to the
 * branch (`<baseBranch>..HEAD`). Best-effort: only finds feedback that was
 * resolved with a recorded commit sha. Returns [] when nothing matches or
 * the rev-list fails.
 */
export async function selectBranchScreenshots(
  commitCwd: string,
  baseBranch: string,
  candidates: ScreenshotCandidate[],
): Promise<PrScreenshot[]> {
  const withSha = candidates.filter((c) => c.commitSha && c.commitSha.length >= 7);
  if (withSha.length === 0) return [];

  const revList = await runGitCapture(commitCwd, ['rev-list', `${baseBranch}..HEAD`]);
  if (revList.code !== 0) return [];
  const branchShas = revList.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (branchShas.length === 0) return [];

  const shots: PrScreenshot[] = [];
  const seen = new Set<string>();
  for (const c of withSha) {
    // commitSha may be short or full; rev-list emits full shas. Match by
    // prefix so either form resolves.
    const prefix = c.commitSha!;
    if (!branchShas.some((s) => s.startsWith(prefix))) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    shots.push({ id: c.id, screenshot: c.screenshot, caption: captionFor(c.comment) });
  }
  return shots;
}

/**
 * Copy each screenshot into `<commitCwd>/.pinagent/pr-assets/`, force-add +
 * commit them onto the current branch, and return a markdown block of
 * `?raw=true` blob URLs (referencing `branch`) to append to the PR body.
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
): Promise<{ markdown: string; committed: number }> {
  const empty = { markdown: '', committed: 0 };
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
  return { markdown, committed: staged.length };
}

/** Map storage feedback records to screenshot candidates (drops empties). */
export function toScreenshotCandidates(
  records: Array<{
    id: string;
    screenshot?: string | null;
    commitSha: string | null;
    comment: string;
  }>,
): ScreenshotCandidate[] {
  const out: ScreenshotCandidate[] = [];
  for (const r of records) {
    if (!r.screenshot || !r.commitSha) continue;
    out.push({ id: r.id, screenshot: r.screenshot, commitSha: r.commitSha, comment: r.comment });
  }
  return out;
}
