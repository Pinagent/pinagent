// SPDX-License-Identifier: Apache-2.0
/**
 * Resolve a GitHub token for server-side API calls (opening PRs,
 * reconciling PR state). One place owns the precedence so the compose
 * and refresh paths can't drift:
 *
 *   dock-stored secret (Connections route) → GITHUB_TOKEN → PINAGENT_GITHUB_TOKEN
 *
 * The Connections secret is the interactive path; the env vars stay for
 * CI / scripting. Returns `undefined` when nothing is configured — the
 * caller treats that as "no API path available."
 */
import { SecretsStore } from './secrets-store';

export async function resolveGithubToken(projectRoot: string): Promise<string | undefined> {
  const stored = await new SecretsStore(projectRoot).getGithubToken();
  return stored ?? process.env.GITHUB_TOKEN ?? process.env.PINAGENT_GITHUB_TOKEN;
}
