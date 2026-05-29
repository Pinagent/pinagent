// SPDX-License-Identifier: Apache-2.0
import { ClaudeCodeProvider } from './claude-code';
import { CliAgentProvider } from './cli';
import type { AgentProvider } from './types';

export { ClaudeCodeProvider } from './claude-code';
export { CliAgentProvider } from './cli';
export type { AgentPermissionMode, AgentProvider, AgentRunRequest, ProviderRunItem } from './types';

/**
 * Stable provider id, as accepted by `PINAGENT_AGENT_PROVIDER`. Adding a
 * new backend means adding it here and in `createProvider`.
 */
export type ProviderId = 'claude-code' | 'cli';

/**
 * Resolve which agent backend a run should use. Precedence:
 *   `PINAGENT_AGENT_PROVIDER` env > default (`claude-code`).
 *
 * Defaulting to `claude-code` keeps every existing setup working with no
 * config; "bring your own model" is opt-in via the env var.
 */
export function resolveProviderId(env: NodeJS.ProcessEnv): ProviderId {
  const v = env.PINAGENT_AGENT_PROVIDER?.trim().toLowerCase();
  if (v === 'cli') return 'cli';
  // 'claude-code', 'claude', unset, or anything unrecognised → the default.
  return 'claude-code';
}

/** Instantiate the provider for an id. */
export function createProvider(id: ProviderId): AgentProvider {
  switch (id) {
    case 'cli':
      return new CliAgentProvider();
    default:
      return new ClaudeCodeProvider();
  }
}

/** Convenience: resolve the provider straight from the environment. */
export function resolveProvider(env: NodeJS.ProcessEnv = process.env): AgentProvider {
  return createProvider(resolveProviderId(env));
}
