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
