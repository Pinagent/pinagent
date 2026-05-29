// SPDX-License-Identifier: Apache-2.0
import type { WorktreeWireState } from '@pinagent/shared';
import type { QuickAction } from './quick-actions';
import type { PaLoc } from './selector';

/**
 * Composer header shape. Built once when the user picks an element
 * and passed straight into composerHTML; tag/label/breadcrumbs come
 * from the live DOM, `loc` is from data-pa-loc (may be null in
 * unstrumented apps). `chips` is the element-aware quick-action set
 * — see quick-actions.ts.
 */
export interface ExtraAnchor {
  file: string | null;
  line: number | null;
  col: number | null;
  selector: string;
  clickX: number;
  clickY: number;
  /** Enclosing component name (`data-pa-comp`) for this extra pick. */
  component?: string | null;
}

/**
 * Loop-instance disambiguation for the primary target, populated only
 * when its `data-pa-loc` is shared by more than one live element (a
 * `.map()`). `index` is the 0-based position among those siblings.
 */
export interface InstanceInfo {
  index: number;
  total: number;
  fingerprint: string;
}

export interface ComposerMeta {
  tag: string;
  label: string | null;
  loc: PaLoc | null;
  /** Enclosing component name from `data-pa-comp`; null when uninstrumented. */
  component: string | null;
  breadcrumbs: string[];
  chips: QuickAction[];
  /**
   * Number of Cmd/Ctrl-click extras the user queued before this
   * committing click. 0 in the single-pick case (the default); when > 0
   * the composer header renders a "+N" badge whose hover/leave events
   * post messages to the parent so it can flash highlight outlines.
   */
  extraCount: number;
  /**
   * Per-extra display info (tag / short label / resolved loc) for the
   * "+N" badge's hover popover, so the user can see *what* the extra
   * picks were without leaving the composer. Display-only — the wire
   * payload sent to the server is `Composer.extraAnchors`. Empty in the
   * single-pick case.
   */
  extras: Array<{ tag: string; label: string | null; loc: PaLoc | null }>;
}

export interface AgentEvent {
  type:
    | 'init'
    | 'text'
    | 'tool_use'
    | 'tool_result'
    | 'progress'
    | 'ask_user'
    | 'error'
    | 'result'
    | 'status_changed';
  [k: string]: unknown;
}

export interface WorktreeStateMessage {
  state: WorktreeWireState;
  commitSha?: string;
  conflicts?: string[];
  message?: string;
  changesCount?: number;
}

export interface ServerMessage {
  type: 'event' | 'done' | 'error' | 'pong' | 'worktree_state' | 'project_event';
  feedbackId?: string;
  event?: AgentEvent;
  message?: string;
  state?: WorktreeWireState;
  commitSha?: string;
  conflicts?: string[];
  changesCount?: number;
}

export interface FeedbackHandler {
  onEvent(event: AgentEvent): void;
  onDone(): void;
  onError(message: string): void;
  /**
   * Phase H — the conversation's worktree lifecycle changed. Optional
   * because inline-mode conversations never call this and the widget
   * keeps working without a header lifecycle row.
   */
  onWorktreeState?(payload: WorktreeStateMessage): void;
}

export type AgentState = 'pending' | 'running' | 'done' | 'error';

/**
 * DOM nodes for the Phase H worktree-lifecycle row. Looked up once when
 * the composer iframe loads and threaded through `attachStreamHandler`
 * so the worktree_state listener can mutate them.
 */
export interface LifecycleEls {
  row: HTMLElement;
  label: HTMLElement;
  landBtn: HTMLButtonElement;
  discardBtn: HTMLButtonElement;
}

export interface Composer {
  feedbackId: string | null;
  target: Element;
  iframe: HTMLIFrameElement;
  bubble: HTMLElement;
  dragHandle: HTMLElement;
  /**
   * Re-anchor metadata captured at pick time. Used by the rAF loop to
   * recover a fresh target reference when the original Node disappears
   * from the DOM (HMR, framework re-render, JS rewrite). `dataPaLoc` is
   * the precise lookup ("`<file>:<line>:<col>`") embedded by
   * `@pinagent/babel-plugin`; `selector` is the CSS fallback. See
   * `tryReanchor` for the lookup order.
   */
  dataPaLoc: string | null;
  selector: string;
  /**
   * Extra elements the user added with Cmd/Ctrl-click before the
   * committing click. Captured at pick time and sent through to the
   * server in the submit payload. The composer is only visually pinned
   * to the primary `target`; these are informational data for the
   * agent + a hover-preview on the "+N" header badge. Empty in the
   * common single-pick case.
   */
  extraAnchors: ExtraAnchor[];
  /**
   * Enclosing-component context for the primary target, captured at pick
   * time from `data-pa-comp`. `component` is the nearest component name;
   * `componentPath` the outer→inner chain; `instance` is set only when
   * the target's `data-pa-loc` is rendered more than once (loop). All
   * forwarded to the server in the submit payload.
   */
  component: string | null;
  componentPath: string[];
  instance: InstanceInfo | null;
  /**
   * True when neither `dataPaLoc` nor `selector` resolves to a live
   * element. The widget stays put at its last known coordinates with a
   * visible "anchor lost" indicator on the bubble; clicking the bubble
   * retries the re-anchor lookup.
   */
  anchorLost: boolean;
  /**
   * Set when the user pressed an anchor-lost dot that couldn't re-anchor
   * and no dock is mounted: we fall back to re-showing the composer card
   * inline so the conversation stays reachable. While true the dot is
   * suppressed and the iframe card is shown even though `anchorLost` is
   * still set. Reset whenever the target re-anchors.
   */
  reviewingLost: boolean;
  /**
   * User-applied positional offset relative to the auto-anchored
   * position. Updated by dragging the handle; applied on top of the
   * target-anchored coords so the widget keeps following the target
   * through scrolls/layout while staying where the user dropped it.
   */
  userOffsetX: number;
  userOffsetY: number;
  /**
   * Current agent turn number. Bumps on initial submit (0 → 1) and on
   * every user-typed follow-up before the WS send. All events that
   * arrive after a bump until the next bump get stamped with the
   * current turn, which is what the browser DB writes use to group
   * the transcript.
   */
  turn: number;
  agentState: AgentState;
  expanded: boolean;
  /**
   * Override height (px) for the loading gap between submit and the first
   * streamed event, while the stream log is empty. `null` means "use the
   * normal STREAM_H/MINI_H". The card is shrunk to hug just the header +
   * footer so there's no empty box; `refitStream()` recomputes it and the
   * rAF placement loop reads it as the active height.
   */
  streamFitH: number | null;
  close(): void;
  expand(): void;
  minimize(): void;
  /**
   * Recompute the iframe height: a measured fit when the run is mid-gap
   * (feedbackId set, stream log still empty), otherwise the normal height.
   * Called on stream start and on the first appended transcript node.
   */
  refitStream(): void;
}

export interface ReplayMessage {
  turn: number;
  role: string;
  content: unknown;
}
