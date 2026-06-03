// SPDX-License-Identifier: Apache-2.0
/**
 * Display labels for the Claude Agent SDK's `permissionMode` values, as
 * they appear on `AgentEvent { type: 'init' }`. Used to render the
 * permission-mode badge in the conversation detail header.
 *
 * The three "canonical" modes (the ones the dock's Settings picker
 * surfaces) read their labels straight out of `PROJECT_PERMISSION_MODES`
 * in `@pinagent/shared`, so the chip text in the header always matches
 * the picker text. SDK-only modes (`bypassPermissions`, `dontAsk`,
 * SDK's own `auto`) carry their own labels here — they're reachable via
 * the env override, never via the picker, so they don't need to live in
 * the shared table.
 */
import { PROJECT_PERMISSION_MODES } from '@pinagent/shared';

export interface PermissionModeDisplay {
  label: string;
  /** Long-form description for the `title` tooltip on hover. */
  title: string;
}

const SDK_ONLY_DISPLAY: Record<string, PermissionModeDisplay> = {
  bypassPermissions: {
    label: 'Bypass',
    title: 'Bypass permissions — all permission prompts skipped.',
  },
  dontAsk: { label: "Don't ask", title: "Don't ask — permission prompts suppressed." },
  auto: { label: 'Auto', title: 'Auto — SDK decides per tool call.' },
};

export function permissionModeDisplay(mode: string): PermissionModeDisplay {
  // First try the canonical 3 — keeps chip labels in sync with the
  // Settings picker without restating them.
  const canonical = PROJECT_PERMISSION_MODES.find((m) => m.sdkMode === mode);
  if (canonical) {
    return { label: canonical.shortLabel, title: canonical.tooltip };
  }
  // Then the SDK-only modes.
  const sdkOnly = SDK_ONLY_DISPLAY[mode];
  if (sdkOnly) return sdkOnly;
  // Unknown SDK mode — surface the raw value rather than swallowing it.
  return { label: mode, title: `Permission mode: ${mode}` };
}

/**
 * The picker projectMode an active env override resolves to. The override is
 * an SDK mode (e.g. `plan`); map it back to a canonical project mode so the
 * Settings picker can mark which row is actually in force. `null` when there's
 * no override, or it's an SDK-only mode with no picker row.
 */
export function overrideProjectMode(overrideSdkMode: string | null): string | null {
  if (!overrideSdkMode) return null;
  return PROJECT_PERMISSION_MODES.find((m) => m.sdkMode === overrideSdkMode)?.projectMode ?? null;
}

/**
 * Which badge a permission-mode picker row should show. When an env override
 * is in force, the in-force row is marked "In force" and the persisted
 * selection "Saved" (it applies once the env is unset); with no override the
 * selected row is simply the "current" one.
 */
export function permissionRowBadge(args: {
  rowMode: string;
  savedMode: string;
  overrideMode: string | null;
}): 'In force' | 'Saved' | 'current' | null {
  const { rowMode, savedMode, overrideMode } = args;
  if (overrideMode) {
    if (rowMode === overrideMode) return 'In force';
    if (rowMode === savedMode) return 'Saved';
    return null;
  }
  return rowMode === savedMode ? 'current' : null;
}
