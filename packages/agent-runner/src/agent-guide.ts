// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/**
 * Surfacing the project guidance nearest to the element the developer
 * clicked. When feedback lands with a `file:line`, walk up the directory
 * tree from that file toward the project root and pull in the closest
 * `CLAUDE.md` / `AGENTS.md` so the agent starts with the conventions that
 * actually govern the code it's about to touch.
 *
 * The Claude Agent SDK (and Codex) already discover guide files by walking
 * UP from the agent's working directory — but that misses a nested guide
 * sitting *below* the worktree/project root, right next to the clicked
 * file. That nested guide is exactly the one most relevant to the edit, so
 * we resolve it explicitly here and inject it into the system prompt.
 */

/**
 * Guide filenames we recognise. `CLAUDE.md` is Claude's convention and
 * `AGENTS.md` is the cross-agent (Codex, etc.) one; both are checked at
 * each directory so whichever a project uses is found.
 */
export const GUIDE_FILENAMES = ['CLAUDE.md', 'AGENTS.md'] as const;
export type GuideFilename = (typeof GUIDE_FILENAMES)[number];

/**
 * Hard cap on injected guide bytes. A sprawling guide shouldn't crowd out
 * the actual task in the prompt; past this we truncate with a marker.
 */
const MAX_GUIDE_BYTES = 16_000;

export interface AgentGuide {
  /** Which convention matched at the nearest directory. */
  filename: GuideFilename;
  /** Project-root-relative path of the guide file (POSIX separators). */
  relativePath: string;
  /** Guide contents, truncated to MAX_GUIDE_BYTES when oversized. */
  content: string;
  /** True when `content` was clipped to fit the byte cap. */
  truncated: boolean;
}

export interface FindGuideOptions {
  /**
   * Filename to prefer when both exist in the same directory — lets the
   * Claude provider favour `CLAUDE.md` and a Codex-style CLI favour
   * `AGENTS.md`. Distance always wins over preference: a same-directory
   * match beats a preferred filename one level up.
   */
  prefer?: GuideFilename;
}

/**
 * Find the guide file nearest to `file`, searching its own directory first
 * and walking up to (and including) `projectRoot`. Returns `null` when the
 * feedback has no file, the path escapes the project, or no guide exists
 * anywhere on the path.
 */
export function findNearestAgentGuide(
  file: string | null | undefined,
  projectRoot: string,
  opts: FindGuideOptions = {},
): AgentGuide | null {
  if (!file) return null;

  const root = resolve(projectRoot);
  const absFile = isAbsolute(file) ? resolve(file) : resolve(root, file);

  // Never read outside the project — the file:line comes from the browser
  // and we treat it as untrusted. An escaping path means the location is
  // bogus; there's nothing meaningful to walk up to.
  if (!isWithin(root, absFile)) return null;

  const order = guideOrder(opts.prefer);

  let dir = dirname(absFile);
  // Walk up until we've checked `root` itself, then stop. The `dir === root`
  // break (not a generic filesystem-root check) keeps the search scoped to
  // the project and guarantees termination.
  while (true) {
    for (const filename of order) {
      const guidePath = resolve(dir, filename);
      const content = tryRead(guidePath);
      if (content !== null) {
        const clipped = clip(content);
        return {
          filename,
          relativePath: toPosix(relative(root, guidePath)),
          content: clipped.content,
          truncated: clipped.truncated,
        };
      }
    }
    if (dir === root) break;
    const parent = dirname(dir);
    // Defensive: `dirname` is idempotent at the filesystem root, so bail if
    // we ever stop making progress without having reached `root`.
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Render a found guide as a block to append to the agent's system prompt
 * (or, for a wrapped CLI with no system prompt, its task prompt). Framed so
 * the agent knows the guidance is scoped to the file it's editing.
 */
export function renderAgentGuide(guide: AgentGuide): string {
  return [
    '',
    `Project guidance applies to the code you're editing. The nearest guide to`,
    `the clicked element is \`${guide.relativePath}\` — follow it${
      guide.truncated ? ' (truncated below; read the full file if you need more)' : ''
    }:`,
    '',
    `<project-guidance path="${guide.relativePath}">`,
    guide.content,
    '</project-guidance>',
  ].join('\n');
}

/** Order the filenames so the preferred one is checked first at each dir. */
function guideOrder(prefer?: GuideFilename): readonly GuideFilename[] {
  if (!prefer || prefer === GUIDE_FILENAMES[0]) return GUIDE_FILENAMES;
  return [prefer, ...GUIDE_FILENAMES.filter((f) => f !== prefer)];
}

/** Read a file as UTF-8, returning null for any read error (missing, dir, …). */
function tryRead(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** True when `child` is `parent` or sits inside it. */
function isWithin(parent: string, child: string): boolean {
  if (child === parent) return true;
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Clip content to the byte cap on a line boundary, with a marker. */
function clip(content: string): { content: string; truncated: boolean } {
  if (Buffer.byteLength(content, 'utf8') <= MAX_GUIDE_BYTES) {
    return { content, truncated: false };
  }
  // Slice by characters until under the byte budget (leaving room for the
  // marker), then trim back to the last newline so we don't cut mid-line.
  let sliced = content.slice(0, MAX_GUIDE_BYTES);
  while (Buffer.byteLength(sliced, 'utf8') > MAX_GUIDE_BYTES - 32) {
    sliced = sliced.slice(0, -32);
  }
  const lastNl = sliced.lastIndexOf('\n');
  if (lastNl > 0) sliced = sliced.slice(0, lastNl);
  return { content: `${sliced}\n\n… [truncated]`, truncated: true };
}

/** Normalise path separators to POSIX for stable prompt/display output. */
function toPosix(path: string): string {
  return path.split(/[\\/]/).join('/');
}
