// SPDX-License-Identifier: Apache-2.0
/**
 * Auth for agent runs — the explicit-key contract.
 *
 * Pinagent must never authenticate a run with an API key it merely *found* in
 * the environment. The Claude Agent SDK (and agentic CLIs like Codex) read a
 * raw `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` straight from `process.env`, so a
 * stale, scoped, or third-party key a developer exported for some unrelated
 * tool would otherwise be picked up silently — billing their key and, worse,
 * shadowing the Claude Code / Codex subscription they actually meant to use, so
 * the run dies with `authentication_failed` ("Invalid API key").
 *
 * A key is therefore used ONLY when the developer hands one to pinagent
 * explicitly, through one of two channels:
 *
 *   1. the `apiKey` option in the consuming app's plugin config
 *      (`pinagent({ apiKey })` in vite.config / next.config), bridged to the
 *      runner as `PINAGENT_AGENT_API_KEY`; or
 *   2. a key saved at runtime via the dock's Connections route (`SecretsStore`).
 *
 * With neither set, the implicit key is stripped from the run's environment and
 * the provider falls back to the agentic subscription — the behaviour a
 * developer running Pinagent locally expects.
 */
import { SecretsStore } from './secrets-store';

/**
 * pinagent-namespaced bridge var the plugins set from the explicit `apiKey`
 * option. This is the ONLY env channel pinagent treats as an opt-in to use a
 * raw key — never the ambient `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` a
 * developer may have exported for other tools.
 */
export const EXPLICIT_API_KEY_ENV = 'PINAGENT_AGENT_API_KEY';

/**
 * Credentials provider SDKs / agentic CLIs read straight from the environment.
 * Stripped from any env pinagent hands to a run so a stray shell key can't
 * authenticate by accident; an explicitly-configured key is re-supplied on top.
 */
const ANTHROPIC_KEY_VAR = 'ANTHROPIC_API_KEY';
const PROVIDER_KEY_VARS = [ANTHROPIC_KEY_VAR, 'OPENAI_API_KEY'] as const;

/** The key the developer configured for `pinagent({ apiKey })`, if any. */
function configuredKey(): string | null {
  return process.env[EXPLICIT_API_KEY_ENV]?.trim() || null;
}

/**
 * Resolve the explicitly-configured Anthropic key for a Claude Agent SDK run,
 * or null when the developer configured neither channel (→ subscription).
 * A dock-saved key is the runtime override and wins, so a user can swap auth
 * without editing config or restarting the dev server; otherwise the
 * plugin-config key applies.
 */
async function resolveAnthropicKey(projectRoot: string): Promise<string | null> {
  const dockKey = await new SecretsStore(projectRoot).getAnthropicKey();
  return dockKey ?? configuredKey();
}

/**
 * Build the environment handed to a Claude Agent SDK `query()`: the inherited
 * environment with the implicit `ANTHROPIC_API_KEY` (and the internal bridge
 * var) removed, plus the explicitly-configured key re-added when one exists.
 * Entries in `extra` are applied last so callers can still pin run-scoped vars
 * (e.g. `PINAGENT_PROJECT_ROOT`).
 */
export async function buildSdkAuthEnv(
  projectRoot: string,
  extra: Record<string, string | undefined> = {},
): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env[ANTHROPIC_KEY_VAR];
  delete env[EXPLICIT_API_KEY_ENV];

  const key = await resolveAnthropicKey(projectRoot);
  if (key) env[ANTHROPIC_KEY_VAR] = key;

  return { ...env, ...extra };
}

/**
 * Build the environment for a wrapped agent CLI (Codex, aider, …): the
 * inherited environment with the implicit provider keys (and the internal
 * bridge var) stripped, plus the explicitly-configured key re-supplied under
 * both provider names so whichever the CLI reads picks it up. Absent an
 * explicit key, the CLI sees none and falls back to its own login (e.g. Codex →
 * the ChatGPT subscription). `extra` overrides win last.
 *
 * Only the plugin-config key feeds the CLI: the dock's saved key is
 * Claude-provider-specific, so it isn't reinterpreted as an arbitrary CLI's
 * credential.
 */
export function buildCliAuthEnv(
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  const key = configuredKey();
  for (const v of PROVIDER_KEY_VARS) delete env[v];
  delete env[EXPLICIT_API_KEY_ENV];

  if (key) for (const v of PROVIDER_KEY_VARS) env[v] = key;

  return { ...env, ...extra };
}
