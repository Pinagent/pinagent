// SPDX-License-Identifier: Apache-2.0
/**
 * Pure state-transition helpers for the conversation detail view's
 * land/discard/reopen lifecycle. Extracted so the React effects in
 * `Conversations.tsx` stay thin and the decision logic can be tested
 * without rendering.
 *
 * The shape of the machine:
 *
 *   user clicks Land
 *     → intent = { kind: 'land', sentAt: now }
 *     → transport.landConversation(id) goes out
 *
 *   server emits worktree-state transitions over WS
 *     → 'landing' (transient — ignored, intent persists)
 *     → 'landed'  → intent cleared, error cleared
 *     → 'conflict' → intent cleared, error set (with conflict count)
 *
 *   discard + reopen follow the same shape but with their own terminal
 *   states ('discarded' for discard; 'none' for reopen — reopen has no
 *   transient state because the server emits the final state directly).
 *
 *   if 10s elapse without a confirming transition, the timeout
 *   watchdog clears intent and surfaces a "no response" error so the
 *   user gets a Retry affordance instead of a permanent spinner.
 */

export type LifecycleKind = 'land' | 'discard' | 'reopen';
export type LifecycleIntent = { kind: LifecycleKind; sentAt: number } | null;
export type LifecycleError = { kind: LifecycleKind; message: string } | null;
export interface LifecycleState {
  intent: LifecycleIntent;
  error: LifecycleError;
}

export const LIFECYCLE_TIMEOUT_MS = 10_000;

/**
 * Decide what the lifecycle state should become given a new worktree
 * state. Returns `null` when no transition applies — the caller should
 * leave state as-is.
 */
export function reduceLifecycleOnWorktreeState(
  intent: LifecycleIntent,
  worktreeState: string | null,
  conflictsCount: number,
): LifecycleState | null {
  if (!intent) return null;
  if (intent.kind === 'land') {
    if (worktreeState === 'landed') return { intent: null, error: null };
    if (worktreeState === 'conflict') {
      return {
        intent: null,
        error: {
          kind: 'land',
          message: `Land failed — ${conflictsCount} file${conflictsCount === 1 ? '' : 's'} in conflict.`,
        },
      };
    }
    return null;
  }
  if (intent.kind === 'discard' && worktreeState === 'discarded') {
    return { intent: null, error: null };
  }
  if (intent.kind === 'reopen' && worktreeState === 'none') {
    return { intent: null, error: null };
  }
  return null;
}

/**
 * Decide what the lifecycle state should become if the watchdog fires
 * at `now`. Returns `null` if the timeout hasn't elapsed yet — the
 * caller should schedule a `setTimeout` for the remaining window.
 */
export function lifecycleTimeoutState(
  intent: LifecycleIntent,
  now: number,
  timeoutMs: number = LIFECYCLE_TIMEOUT_MS,
): LifecycleState | null {
  if (!intent) return null;
  if (now - intent.sentAt < timeoutMs) return null;
  return {
    intent: null,
    error: {
      kind: intent.kind,
      message: `No response from the dev-server within ${timeoutMs / 1000}s.`,
    },
  };
}
