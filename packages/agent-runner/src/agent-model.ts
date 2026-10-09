// SPDX-License-Identifier: Apache-2.0
// Model resolution for the Claude provider's inline SDK runs. Mirrors the
// permission-mode precedence in agent-permission.ts. Unrelated to the BYO
// CLI provider's `PINAGENT_AGENT_CLI_MODEL`, which only labels the widget's
// model chip for whatever CLI is wrapped.
import { SettingsStore } from './settings-store';

/**
 * Resolve the Claude model for a run. Precedence:
 *   `PINAGENT_AGENT_MODEL` env override > project settings
 *   (`.pinagent/config.json` model) > `undefined`.
 * `undefined` means "don't pass `model`", so the SDK's bundled Claude Code
 * CLI picks its own default — which tracks the SDK version the consumer's
 * lockfile resolved, not the developer's own Claude Code install.
 */
export async function resolveRunModel(projectRoot: string): Promise<string | undefined> {
  const override = resolveModelOverride(process.env);
  if (override) return override;
  const settings = await new SettingsStore(projectRoot).read();
  return settings.model ?? undefined;
}

/**
 * The active `PINAGENT_AGENT_MODEL` override (trimmed), or `null` when it's
 * unset or blank. Passed through verbatim — the SDK validates the model id.
 * The dock's Settings route reads this to show which model is in force.
 */
export function resolveModelOverride(env: NodeJS.ProcessEnv): string | null {
  return env.PINAGENT_AGENT_MODEL?.trim() || null;
}
