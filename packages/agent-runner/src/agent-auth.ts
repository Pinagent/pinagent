// SPDX-License-Identifier: Apache-2.0
/**
 * Anthropic auth for the Claude Agent SDK runs.
 *
 * The SDK authenticates from the first credential it finds, and a raw
 * `ANTHROPIC_API_KEY` sitting in the dev-server's environment wins ahead of
 * the user's Claude Code subscription (the OAuth login `claude` stores
 * *outside* the environment). So a stale, scoped, or third-party key exported
 * in the shell — common in repos that also call the Anthropic API directly —
 * silently shadows the subscription, and the run dies with
 * `authentication_failed` ("Invalid API key") even though the developer never
 * asked Pinagent to use that key.
 *
 * The fix is to stop letting the SDK *listen* for the key implicitly: we strip
 * `ANTHROPIC_API_KEY` from the inherited environment and re-add a key
 * explicitly only when the user configured one via the dock's Connections
 * route (persisted by `SecretsStore`). With no explicit key the SDK sees no
 * `ANTHROPIC_API_KEY` and falls back to the agentic subscription — the
 * behaviour a developer running Pinagent locally expects.
 */
import { SecretsStore } from './secrets-store';

/**
 * The credential the SDK reads straight from `process.env`. Stripped from the
 * inherited env so only an explicitly-configured key (or, failing that, the
 * subscription) ever authenticates a run — never a stray shell variable.
 *
 * Scoped to the raw API key on purpose: that's the variable behind the
 * "Invalid API key" failure, and it's the only Anthropic credential the dock
 * lets the user set explicitly, so it's the only one we have an explicit
 * channel to re-supply. Other auth vars (e.g. a gateway `ANTHROPIC_AUTH_TOKEN`
 * or Bedrock/Vertex mode flags) are left untouched so deliberate proxy setups
 * keep working.
 */
const IMPLICIT_ANTHROPIC_KEY_VAR = 'ANTHROPIC_API_KEY';

/**
 * Build the environment handed to a Claude Agent SDK `query()`: the inherited
 * environment minus the implicit Anthropic API key, plus the dock-stored key
 * when (and only when) the user set one. Entries in `extra` are applied last so
 * callers can still pin run-scoped vars (e.g. `PINAGENT_PROJECT_ROOT`).
 */
export async function buildSdkAuthEnv(
  projectRoot: string,
  extra: Record<string, string | undefined> = {},
): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env[IMPLICIT_ANTHROPIC_KEY_VAR];

  // Dock-configured key (Connections route) is the ONLY way to authenticate a
  // run with a raw key; absent one, the SDK falls back to the subscription.
  const storedKey = await new SecretsStore(projectRoot).getAnthropicKey();
  if (storedKey) env[IMPLICIT_ANTHROPIC_KEY_VAR] = storedKey;

  return { ...env, ...extra };
}
