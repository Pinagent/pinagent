// SPDX-License-Identifier: Apache-2.0
import type { PermissionMode, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * Fallback for a run that asked for the SDK's `auto` (classifier) mode and
 * didn't get it.
 *
 * Auto mode isn't available everywhere: the account's plan, the chosen
 * model, a `disableAutoMode` setting or a service-side switch can each turn
 * it off. The bundled CLI does not fail the run then — it quietly starts the
 * session in `default` mode and reports that on `system/init` (or on a later
 * `system/status` if auto mode is withdrawn mid-session). In `default` mode
 * every edit would prompt in the widget, which is stricter than the
 * `acceptEdits` behaviour Pinagent shipped before auto mode, so we switch the
 * session to `acceptEdits` and say so in the run log instead of leaving the
 * developer to wonder why each edit now asks.
 */

/** The mode a run drops to when auto mode is unavailable. */
export const AUTO_MODE_FALLBACK: PermissionMode = 'acceptEdits';

/** How long to wait for the CLI to acknowledge the mode switch. */
const SET_MODE_TIMEOUT_MS = 10_000;

/** The slice of the SDK's `Query` the fallback needs (mockable in tests). */
export interface PermissionModeSetter {
  setPermissionMode(mode: PermissionMode): Promise<void>;
}

export interface AutoModeFallbackResult {
  /** The mode the session is in after the fallback attempt. */
  mode: PermissionMode;
  /** Markdown note for the run log. */
  note: string;
}

/**
 * The permission mode a system message reports, or `undefined` when it
 * carries none. `system/init` always reports one; `system/status` does when
 * the mode changed.
 */
function reportedMode(message: SDKMessage): string | undefined {
  if (message.type !== 'system') return undefined;
  if (message.subtype === 'init' || message.subtype === 'status') return message.permissionMode;
  return undefined;
}

/**
 * Watches a run's messages for the CLI declining auto mode and, the first
 * time it does, switches the session to `AUTO_MODE_FALLBACK`. A no-op for
 * runs that didn't ask for `auto`.
 */
export function createAutoModeFallback(requested: string, run: PermissionModeSetter) {
  let armed = requested === 'auto';
  return {
    /**
     * Inspect one SDK message. Resolves to the fallback result when this
     * message showed the CLI running a requested-`auto` session in
     * `default`, else `null`. Other modes (`plan` entered mid-run, the
     * fallback's own `acceptEdits` echo) are left alone.
     */
    async check(message: SDKMessage): Promise<AutoModeFallbackResult | null> {
      if (!armed || reportedMode(message) !== 'default') return null;
      armed = false;
      return applyAutoModeFallback(run);
    },
  };
}

export async function applyAutoModeFallback(
  run: PermissionModeSetter,
): Promise<AutoModeFallbackResult> {
  const lead =
    "> [pinagent] Auto mode isn't available for this account, model or settings, so the " +
    'Claude Code CLI started this run in `default` mode.';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run.setPermissionMode(AUTO_MODE_FALLBACK),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no reply within ${SET_MODE_TIMEOUT_MS / 1000}s`)),
          SET_MODE_TIMEOUT_MS,
        );
      }),
    ]);
    return {
      mode: AUTO_MODE_FALLBACK,
      note:
        `${lead} Switched to \`${AUTO_MODE_FALLBACK}\`: edits are accepted, other tool calls ` +
        'ask in Pinagent. Choose "Auto-accept edits" in Settings → Permission mode to skip ' +
        'this check.\n\n',
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      mode: 'default',
      note:
        `${lead} Switching to \`${AUTO_MODE_FALLBACK}\` failed (${detail}), so each edit will ` +
        'ask in Pinagent.\n\n',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
