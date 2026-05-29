// SPDX-License-Identifier: Apache-2.0
// Spawn-mode + permission-mode resolution. Lifted out of agent.ts so the
// pure env/settings → SDK-mode mapping lives apart from the run loop.
// Type-only SDK import keeps the public signatures stable without pulling
// the SDK into this module at runtime.
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import {
  PROJECT_PERMISSION_MODES,
  type PermissionMode as ProjectPermissionMode,
  SettingsStore,
} from './settings-store';

export type SpawnAgentMode = 'worktree' | 'inline' | false;

/**
 * Resolve the spawn mode from env. The new default (V2) is `'inline'` —
 * SDK-backed per-submit agent with streaming back to the widget. Worktree
 * mode is opt-in; `'off'` (or the legacy `'false'`) disables spawning so
 * channel-mode / pull-mode setups don't get a redundant agent per submit.
 */
export function resolveAgentMode(env: NodeJS.ProcessEnv): SpawnAgentMode {
  const v = env.PINAGENT_SPAWN_AGENT;
  if (v === 'worktree') return 'worktree';
  if (v === 'off' || v === 'false') return false;
  // 'inline', unset, or any unrecognised value falls through to the V2 default.
  return 'inline';
}

/**
 * Resolve the SDK permission mode for a run. Precedence:
 *   `PINAGENT_AGENT_PERMISSION_MODE` env override > project settings
 *   (`.pinagent/config.json` permissionMode) > default.
 * The env override is kept so CI / power users can bypass the dock UI
 * without editing the settings file.
 */
export async function resolveRunPermissionMode(projectRoot: string): Promise<PermissionMode> {
  const override = resolvePermissionModeOverride(process.env);
  if (override) return override;
  const settings = await new SettingsStore(projectRoot).read();
  return toSdkPermissionMode(settings.permissionMode);
}

export function resolvePermissionMode(env: NodeJS.ProcessEnv): PermissionMode {
  const v = env.PINAGENT_AGENT_PERMISSION_MODE;
  if (
    v === 'default' ||
    v === 'acceptEdits' ||
    v === 'bypassPermissions' ||
    v === 'plan' ||
    v === 'dontAsk' ||
    v === 'auto'
  ) {
    return v;
  }
  return 'acceptEdits';
}

/**
 * The active env override for permission mode, or `null` when no
 * override is set. Different shape from `resolvePermissionMode`, which
 * falls back to `'acceptEdits'` whether the env was unset or invalid —
 * callers that need to distinguish "no override" from "override → some
 * mode" (e.g. the dock's Settings UI banner) want this signal.
 */
export function resolvePermissionModeOverride(env: NodeJS.ProcessEnv): PermissionMode | null {
  if (!env.PINAGENT_AGENT_PERMISSION_MODE) return null;
  return resolvePermissionMode(env);
}

/**
 * Map the user-facing project setting to the SDK's permission-mode
 * value-space. Looks up the shared `PROJECT_PERMISSION_MODES` table so
 * the mapping stays in sync with the dock's Settings labels and the
 * detail-header chip.
 */
export function toSdkPermissionMode(mode: ProjectPermissionMode): PermissionMode {
  // `find` always hits because `mode` is typed against the literal
  // union derived from the same table; the `?? 'acceptEdits'` is just
  // a belt-and-braces fallback that satisfies the type checker.
  const meta = PROJECT_PERMISSION_MODES.find(
    (m: (typeof PROJECT_PERMISSION_MODES)[number]) => m.projectMode === mode,
  );
  return (meta?.sdkMode as PermissionMode | undefined) ?? 'acceptEdits';
}
