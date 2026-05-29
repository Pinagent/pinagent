// SPDX-License-Identifier: Apache-2.0
/**
 * Running-agents tray controller. Drives the widget FAB's "agents" mode:
 * it tracks every unresolved conversation (an agent the developer might
 * still want to open, stop, or clear) and re-renders when the project
 * changes.
 *
 * Split into a pure selector (`selectUnresolvedAgents`, unit-tested) and
 * a thin stateful controller (`createAgentTray`) whose I/O is injected so
 * the DOM glue in `widget.ts` stays the only untested surface.
 */
import {
  deriveDockStatus,
  isUnresolvedStatus,
  type ServerStatus,
  type ServerWorktreeState,
  type StatusKey,
} from '@pinagent/shared';

/**
 * The shallow conversation record returned by `GET /__pinagent/feedback`.
 * Only the fields the tray reads are typed; the endpoint returns more.
 */
export interface RawFeedback {
  id: string;
  comment?: string | null;
  selector?: string | null;
  title?: string | null;
  status: ServerStatus;
  worktreeState: ServerWorktreeState;
  archived?: boolean;
  /** Persisted message count — surfaced as the row's "N msg" badge. */
  messageCount?: number | null;
  /** Running SDK cost in USD — surfaced as the row's "$X.XX" badge. */
  totalCostUsd?: number | null;
}

/** One row in the tray. `status` is the derived, unresolved dock status. */
export interface TrayAgent {
  id: string;
  title: string;
  selector: string | null;
  status: StatusKey;
  /** Message count (0 when unknown) — drives the row's glanceable meta. */
  messageCount: number;
  /** Running cost in USD (0 when unknown). */
  costUsd: number;
}

const MAX_TITLE_LEN = 80;

/** Best title for a row: explicit override, else the comment's first line. */
function titleFor(rec: RawFeedback): string {
  const explicit = rec.title?.trim();
  if (explicit) return explicit;
  const firstLine = (rec.comment ?? '').trim().split('\n', 1)[0]?.trim() ?? '';
  if (!firstLine) return 'Untitled';
  return firstLine.length > MAX_TITLE_LEN ? `${firstLine.slice(0, MAX_TITLE_LEN - 1)}…` : firstLine;
}

/**
 * Pure: pick the unresolved, non-archived conversations and shape them
 * into tray rows. "Unresolved" = derived status in {working, readyToLand,
 * awaitingClarification} — see `isUnresolvedStatus`.
 */
export function selectUnresolvedAgents(raw: readonly RawFeedback[]): TrayAgent[] {
  const agents: TrayAgent[] = [];
  for (const rec of raw) {
    if (!rec || rec.archived) continue;
    const status = deriveDockStatus(rec.status, rec.worktreeState);
    if (!isUnresolvedStatus(status)) continue;
    agents.push({
      id: rec.id,
      title: titleFor(rec),
      selector: rec.selector ?? null,
      status,
      messageCount: rec.messageCount ?? 0,
      costUsd: rec.totalCostUsd ?? 0,
    });
  }
  return agents;
}

export interface AgentTrayDeps {
  /** Fetch the shallow conversation list (GET /__pinagent/feedback). */
  fetchFeedback: () => Promise<RawFeedback[]>;
  /** Subscribe to project-change events; returns an unsubscribe fn. */
  subscribeProject: (onChange: () => void) => () => void;
  /** Render the current unresolved agents (called on every change). */
  render: (agents: TrayAgent[]) => void;
}

export interface AgentTray {
  /** Initial fetch + project subscription. */
  start(): void;
  /** Re-fetch, re-derive, re-render. Coalesced under bursts of events. */
  refresh(): Promise<void>;
  /** Drop a row immediately (optimistic Clear); idempotent. */
  removeOptimistic(id: string): void;
  /** Tear down the project subscription. */
  stop(): void;
}

export function createAgentTray(deps: AgentTrayDeps): AgentTray {
  let current: TrayAgent[] = [];
  let unsub: (() => void) | null = null;
  // Coalesce concurrent refreshes: a burst of `conversations_changed`
  // events (or a Clear racing a refresh) collapses to at most one extra
  // fetch after the in-flight one settles.
  let refreshing = false;
  let pendingAgain = false;

  function emit(): void {
    deps.render(current);
  }

  async function refresh(): Promise<void> {
    if (refreshing) {
      pendingAgain = true;
      return;
    }
    refreshing = true;
    try {
      const raw = await deps.fetchFeedback();
      current = selectUnresolvedAgents(raw);
      emit();
    } catch {
      // Network/parse failure: keep the last good render rather than
      // flashing an empty tray. The next project event retries.
    } finally {
      refreshing = false;
      if (pendingAgain) {
        pendingAgain = false;
        void refresh();
      }
    }
  }

  return {
    start(): void {
      void refresh();
      if (!unsub) unsub = deps.subscribeProject(() => void refresh());
    },
    refresh,
    removeOptimistic(id: string): void {
      const next = current.filter((a) => a.id !== id);
      if (next.length === current.length) return;
      current = next;
      emit();
    },
    stop(): void {
      if (unsub) {
        unsub();
        unsub = null;
      }
    },
  };
}
