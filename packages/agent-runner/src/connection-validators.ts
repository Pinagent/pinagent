// SPDX-License-Identifier: Apache-2.0
/**
 * Verify-on-set helpers for the Connections route. Each function makes
 * a single trivial upstream call to confirm the credential works before
 * we persist it — surfacing "this token is wrong" at form-submit time
 * rather than at first composer / agent run.
 *
 * Pinned to native `fetch` so we don't pull `@octokit/rest` into this
 * lightweight path; the composer already depends on Octokit for the PR
 * API call where the richer client matters.
 */
import { Octokit } from '@octokit/rest';

export interface GithubValidation {
  ok: boolean;
  login?: string;
  error?: string;
}

export async function validateGithubToken(token: string): Promise<GithubValidation> {
  try {
    const octokit = new Octokit({ auth: token });
    const { data } = await octokit.users.getAuthenticated();
    return { ok: true, login: data.login };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'GitHub rejected the token' };
  }
}

export interface AnthropicValidation {
  ok: boolean;
  error?: string;
}

/**
 * Minimum-cost validation call: `POST /v1/messages` with `max_tokens: 1`
 * against Haiku. Returns 200 for any working key; surfaces upstream
 * error bodies on failure.
 */
export async function validateAnthropicKey(key: string): Promise<AnthropicValidation> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return {
      ok: false,
      error: body.error?.message ?? `Anthropic API returned ${res.status}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unreachable' };
  }
}
