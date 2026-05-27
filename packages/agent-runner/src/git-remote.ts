// SPDX-License-Identifier: Apache-2.0
/**
 * Parse `git remote get-url origin` into { host, owner, repo } so the
 * PR composer can call the right API. Only GitHub is recognized for
 * v1 — other hosts return `null` and the composer falls back to a
 * "push succeeded, open the PR yourself" path.
 *
 * Handles the two URL shapes git uses:
 *   - SSH:    git@github.com:owner/repo.git
 *   - HTTPS:  https://github.com/owner/repo(.git)
 *
 * Trailing `.git` is stripped. Anything else (gitlab, self-hosted,
 * weird shapes) returns null without throwing — the caller treats that
 * as "no API path available, push only."
 */
import { runGitCapture } from './git-utils';

export interface GitRemote {
  host: 'github.com';
  owner: string;
  repo: string;
}

const SSH_RE = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/;
const HTTPS_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

export function parseGitHubRemote(url: string): GitRemote | null {
  const trimmed = url.trim();
  const ssh = SSH_RE.exec(trimmed);
  if (ssh) return { host: 'github.com', owner: ssh[1]!, repo: ssh[2]! };
  const https = HTTPS_RE.exec(trimmed);
  if (https) return { host: 'github.com', owner: https[1]!, repo: https[2]! };
  return null;
}

/**
 * Look up the `origin` remote URL of `projectRoot` and parse it. Returns
 * null if there is no origin remote (or it isn't GitHub) — the composer
 * surfaces this as the manual-create path, not an error.
 */
export async function resolveOriginRemote(projectRoot: string): Promise<GitRemote | null> {
  const result = await runGitCapture(projectRoot, ['remote', 'get-url', 'origin']);
  if (result.code !== 0) return null;
  return parseGitHubRemote(result.stdout);
}
