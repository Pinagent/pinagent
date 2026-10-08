// SPDX-License-Identifier: Apache-2.0
import type {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from '@anthropic-ai/claude-agent-sdk';
import { summariseToolInput } from './agent-render';
import { AskClosedError, awaitAnswer } from './ask-user';

/**
 * Tool-permission gate: the run's SDK `canUseTool` callback.
 *
 * The SDK only consults `canUseTool` for a call nothing else decided —
 * not pre-approved by `allowedTools` / the developer's allow rules / the
 * permission mode, and not denied by a deny rule. Interactive Claude Code
 * shows a prompt there. A headless `query()` with no callback silently
 * denies instead, so a run that needed one read outside its cwd or one
 * un-allowlisted Bash command burned turns on "✗ tool result" while the
 * developer watched what looked like a stall.
 *
 * This gate asks the developer instead, through the same `ask_user`
 * channel the model's own questions use (one widget/dock form, one
 * `ask_response` route — see `awaitAnswer` in ask-user.ts), and maps the
 * answer onto a `PermissionResult`. An unanswered prompt (timeout,
 * Stop, run end) denies with a message telling the agent to move on, so
 * the run never hangs on a gate.
 *
 * `allowedTools` entries (the pinagent MCP tools + `ask_user`) still
 * auto-approve ahead of this gate and never reach it.
 *
 * Dry-run (`plan`) keeps its hard deny of `DRY_RUN_DENIED_TOOLS` ahead of
 * the prompt, and its "allow for this run" never carries a mode switch or
 * a rule for a denied tool — so nothing the developer clicks can turn a
 * dry run into a writing run.
 */

/** How long a permission prompt stays open before the call is denied. */
export const PERMISSION_TTL_MS = 5 * 60 * 1000;

export const ALLOW_ONCE = 'Allow';
export const ALLOW_FOR_RUN = 'Allow for this run';
export const DENY = 'Deny';

/**
 * Tools a dry-run must never be allowed to call: anything that writes to
 * the workspace, runs a command, or transitions the agent out of plan
 * mode. Denying `ExitPlanMode` is the load-bearing entry: plan mode keeps
 * the agent read-only only until it calls `ExitPlanMode` to ask to
 * proceed, and with no gate a headless run auto-approves that, drops into
 * an edit-capable mode, and the "dry run" writes files. (The spawn prompt
 * actively pushes there: it tells the agent to edit and resolve.)
 */
export const DRY_RUN_DENIED_TOOLS: ReadonlySet<string> = new Set([
  'ExitPlanMode',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
  'Bash',
]);

/**
 * The SDK's built-in question tool. Its answers travel back through
 * `canUseTool`'s `updatedInput`, which this gate doesn't fill — approving
 * it would hand the model an empty answer — so steer the model to
 * Pinagent's own `ask_user` tool instead.
 */
const SDK_ASK_TOOL = 'AskUserQuestion';

export interface PermissionGateOptions {
  feedbackId: string;
  /** The run's SDK permission mode (Pinagent passes its own string through). */
  permissionMode: string;
  /** Override for tests. */
  ttlMs?: number;
}

/**
 * Build the run's `canUseTool`, or `undefined` for modes that never
 * prompt: `bypassPermissions` approves everything and `dontAsk` asked for
 * silent denial explicitly.
 */
export function createPermissionGate(opts: PermissionGateOptions): CanUseTool | undefined {
  const { feedbackId, permissionMode } = opts;
  if (permissionMode === 'bypassPermissions' || permissionMode === 'dontAsk') return undefined;
  const dryRun = permissionMode === 'plan';
  const ttlMs = opts.ttlMs ?? PERMISSION_TTL_MS;

  return async (toolName, input, ctx): Promise<PermissionResult> => {
    if (dryRun && DRY_RUN_DENIED_TOOLS.has(toolName)) {
      return deny(
        `Dry-run mode: \`${toolName}\` is blocked. Pinagent is in dry-run (plan) mode — ` +
          'describe the change you would make, but do not edit files, run commands, or exit ' +
          'plan mode.',
      );
    }
    if (toolName === SDK_ASK_TOOL) {
      return deny(
        `\`${SDK_ASK_TOOL}\` is not available in Pinagent. Call ` +
          '`mcp__pinagent-ask-user__ask_user` to ask the developer a question instead.',
      );
    }

    const forRun = sessionScoped(ctx.suggestions, dryRun);
    const summary = summariseToolInput(toolName, input);
    let answer: string;
    try {
      answer = await awaitAnswer(
        feedbackId,
        {
          kind: 'permission',
          question: `Allow ${toolName}${summary ? ` ${summary}` : ''}?`,
          context: describeRequest(ctx),
          options: forRun.length > 0 ? [ALLOW_ONCE, ALLOW_FOR_RUN, DENY] : [ALLOW_ONCE, DENY],
        },
        { ttlMs, signal: ctx.signal },
      );
    } catch (err) {
      const reason = err instanceof AskClosedError ? err.message : String(err);
      return deny(
        `The developer did not approve this \`${toolName}\` call (${reason}), so it was not run. ` +
          'Do not retry it; continue without it, or explain what you need in your reply.',
      );
    }

    const choice = answer.trim();
    if (choice === ALLOW_ONCE) return { behavior: 'allow', updatedInput: input };
    if (choice === ALLOW_FOR_RUN) {
      return forRun.length > 0
        ? { behavior: 'allow', updatedInput: input, updatedPermissions: forRun }
        : { behavior: 'allow', updatedInput: input };
    }
    if (choice === DENY) return deny(`The developer denied this \`${toolName}\` call in Pinagent.`);
    // A typed reply is a "no, and here's why" — pass it to the agent.
    return deny(
      `The developer denied this \`${toolName}\` call in Pinagent and replied: ${choice}`,
    );
  };
}

function deny(message: string): PermissionResult {
  return { behavior: 'deny', message };
}

/**
 * The SDK's own explanation of why it's asking, for the prompt's
 * secondary line. Deduped because `title`/`description`/`decisionReason`
 * often repeat each other.
 */
function describeRequest(ctx: Parameters<CanUseTool>[2]): string | undefined {
  const parts: string[] = [];
  for (const part of [ctx.title, ctx.description, ctx.decisionReason]) {
    const text = part?.trim();
    if (text && !parts.includes(text)) parts.push(text);
  }
  if (ctx.blockedPath && !parts.some((p) => p.includes(ctx.blockedPath as string))) {
    parts.push(`Path: ${ctx.blockedPath}`);
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Turn the SDK's "don't ask again" suggestions into updates that last for
 * this run only: every destination is rewritten to `session`, so an
 * "Allow for this run" never writes the developer's settings files. In a
 * dry run, keep only grants that can't widen into a write: allow rules for
 * tools outside `DRY_RUN_DENIED_TOOLS` and extra readable directories —
 * never a mode switch (that would leave plan mode).
 */
function sessionScoped(
  suggestions: PermissionUpdate[] | undefined,
  dryRun: boolean,
): PermissionUpdate[] {
  const out: PermissionUpdate[] = [];
  for (const update of suggestions ?? []) {
    if (dryRun) {
      const safe =
        update.type === 'addDirectories' ||
        (update.type === 'addRules' &&
          update.behavior === 'allow' &&
          update.rules.every((rule) => !DRY_RUN_DENIED_TOOLS.has(rule.toolName)));
      if (!safe) continue;
    }
    out.push({ ...update, destination: 'session' });
  }
  return out;
}
