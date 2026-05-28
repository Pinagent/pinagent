// SPDX-License-Identifier: Apache-2.0
/**
 * Display labels for the Claude Agent SDK's `permissionMode` values, as
 * they appear on `AgentEvent { type: 'init' }`. Used to render a
 * permission-mode badge in the conversation detail header — the loop-
 * closer for the project-settings → spawn wiring, so users see which
 * mode the agent actually ran under.
 *
 * Labels mirror the dock Settings UI ("Auto-accept edits" / "Require
 * approval" / "Dry-run only") but trimmed to fit a chip.
 */

export interface PermissionModeDisplay {
  label: string;
  /** Long-form description for the `title` tooltip on hover. */
  title: string;
}

export function permissionModeDisplay(mode: string): PermissionModeDisplay {
  switch (mode) {
    case 'acceptEdits':
      return {
        label: 'Auto-accept',
        title: 'Auto-accept edits — tool calls run without prompting.',
      };
    case 'default':
      return {
        label: 'Approval required',
        title: 'Approval required — the agent prompts before each tool call.',
      };
    case 'plan':
      return {
        label: 'Dry-run',
        title: 'Dry-run — plan mode: the agent reasons without running tools.',
      };
    case 'bypassPermissions':
      return {
        label: 'Bypass',
        title: 'Bypass permissions — all permission prompts skipped.',
      };
    case 'dontAsk':
      return { label: "Don't ask", title: "Don't ask — permission prompts suppressed." };
    case 'auto':
      return { label: 'Auto', title: 'Auto — SDK decides per tool call.' };
    default:
      return { label: mode, title: `Permission mode: ${mode}` };
  }
}
