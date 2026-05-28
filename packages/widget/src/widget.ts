// SPDX-License-Identifier: Apache-2.0
import type { WorktreeWireState } from '@pinagent/shared';
import { BRAND_GOLD, FONT_SANS, STATUS } from '@pinagent/ui/tokens';
import { BRAND_CREAM, BRAND_INK, BRAND_VIEWBOX, PICKER_CURSOR_DATA_URL, PIN_PATH } from './brand';
import { COMPOSER_STYLES } from './composer-styles';
import { flushBrowserDb, getBrowserDb, initBrowserDb } from './db/client';
import { getConversationMessages, listPendingForCurrentPage, type PendingRow } from './db/reads';
import {
  deleteConversation,
  markConversationResolved,
  recordConversationStart,
  recordEvent,
  recordUserMessage,
} from './db/writes';
import { type QuickAction, quickActionsFor } from './quick-actions';
import { capturePageScreenshot } from './screenshot';
import {
  breadcrumbTags,
  describeElementLabel,
  findLoc,
  findReanchorTarget,
  type PaLoc,
  shortSelector,
} from './selector';
import { STYLES } from './styles';

const ENDPOINT = '/__pinagent/feedback';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

const COMPOSER_H = 320;
const STREAM_H = 340;
const IFRAME_W = 400;
const BUBBLE_SIZE = 36;

/**
 * Auto-grow envelope for the pre-submit composer. The textarea inside
 * the iframe measures its natural scrollHeight on input and posts it
 * to the parent; the parent grows or shrinks the iframe by the delta
 * from MIN_TA_H, clamped to MAX_TA_H. Past the cap, the textarea
 * scrolls internally rather than pushing the composer off-screen.
 */
const MIN_TA_H = 80;
const MAX_TA_H = 240;

/**
 * Composer header shape. Built once when the user picks an element
 * and passed straight into composerHTML; tag/label/breadcrumbs come
 * from the live DOM, `loc` is from data-pa-loc (may be null in
 * unstrumented apps). `chips` is the element-aware quick-action set
 * — see quick-actions.ts.
 */
interface ComposerMeta {
  tag: string;
  label: string | null;
  loc: PaLoc | null;
  breadcrumbs: string[];
  chips: QuickAction[];
}

const ICON_CODE = `<svg class="hdr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

const ICON_EXTERNAL = `<svg class="hdr-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

interface State {
  mode: 'idle' | 'picking';
}

interface AgentEvent {
  type:
    | 'init'
    | 'text'
    | 'tool_use'
    | 'tool_result'
    | 'ask_user'
    | 'error'
    | 'result'
    | 'status_changed';
  [k: string]: unknown;
}

interface WorktreeStateMessage {
  state: WorktreeWireState;
  commitSha?: string;
  conflicts?: string[];
  message?: string;
  changesCount?: number;
}

interface ServerMessage {
  type: 'event' | 'done' | 'error' | 'pong' | 'worktree_state';
  feedbackId?: string;
  event?: AgentEvent;
  message?: string;
  state?: WorktreeWireState;
  commitSha?: string;
  conflicts?: string[];
  changesCount?: number;
}

interface FeedbackHandler {
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

type AgentState = 'pending' | 'running' | 'done' | 'error';

/**
 * DOM nodes for the Phase H worktree-lifecycle row. Looked up once when
 * the composer iframe loads and threaded through `attachStreamHandler`
 * so the worktree_state listener can mutate them.
 */
interface LifecycleEls {
  row: HTMLElement;
  label: HTMLElement;
  landBtn: HTMLButtonElement;
  discardBtn: HTMLButtonElement;
}

interface Composer {
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
   * True when neither `dataPaLoc` nor `selector` resolves to a live
   * element. The widget stays put at its last known coordinates with a
   * visible "anchor lost" indicator on the bubble; clicking the bubble
   * retries the re-anchor lookup.
   */
  anchorLost: boolean;
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
  close(): void;
  expand(): void;
  minimize(): void;
}

/**
 * Document-level styles for elements that live in document.body (iframes
 * and bubbles). They can't live in the shadow root because we want them
 * to scroll naturally with the page — children of a `position: fixed`
 * shadow host are pinned to the viewport regardless of their own
 * `position: absolute`.
 *
 * The picker cursor rule also lives here so it can cover the whole page.
 */
const DOC_STYLES = `
/* Custom pin cursor while picking. The pin is rotated 135° around
   the viewBox centre so the tip points to roughly 10:30 (upper-left
   diagonal), lining up with how browser arrow cursors normally aim.
   Cream stroke + dark fill so it stays legible on both light and
   dark backgrounds. Hotspot (~9, 9) lands on the rotated tip in
   32x32 cursor space. The crosshair fallback covers browsers that
   won't render SVG cursors. */
:root.pa-picking, :root.pa-picking * {
  cursor: ${PICKER_CURSOR_DATA_URL}, crosshair !important;
}

.pa-iframe {
  position: absolute;
  border: 0;
  background: transparent;
  z-index: 2147483646;
  color-scheme: light;
  /* iframe is positioned relative to documentElement origin — set via JS */
}
.pa-iframe[hidden] { display: none; }

.pa-bubble {
  position: absolute;
  width: ${BUBBLE_SIZE}px;
  height: ${BUBBLE_SIZE}px;
  border-radius: 50%;
  background: ${BRAND_CREAM};
  border: 2px solid #e8dfb0;
  box-shadow: 0 4px 12px rgba(32, 27, 33, 0.16);
  cursor: pointer;
  z-index: 2147483645;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: ${BRAND_INK};
  transition: transform 120ms ease, box-shadow 120ms ease;
  font-family: ${FONT_SANS};
}
.pa-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 16px rgba(32, 27, 33, 0.22); }
.pa-bubble[hidden] { display: none; }

/* Status-driven bubble variants. Color palette comes from
   @pinagent/ui/tokens.STATUS so the bubble visually matches the
   dock's status badges. */
.pa-bubble.pending {
  border-color: ${STATUS.pending.border};
  background: ${STATUS.pending.bg};
  color: ${STATUS.pending.fg};
}
.pa-bubble.running {
  border-color: ${STATUS.working.border};
  background: ${STATUS.working.bg};
  color: ${STATUS.working.fg};
}
.pa-bubble.running::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid ${STATUS.working.fg};
  opacity: 0.55;
  animation: pa-bubble-pulse 1.6s ease-out infinite;
  pointer-events: none;
}
@keyframes pa-bubble-pulse {
  0%   { transform: scale(1);    opacity: 0.55; }
  100% { transform: scale(1.55); opacity: 0; }
}
.pa-bubble.done {
  border-color: ${STATUS.readyToLand.border};
  background: ${STATUS.readyToLand.bg};
  color: ${STATUS.readyToLand.fg};
}
.pa-bubble.error {
  border-color: ${STATUS.error.border};
  background: ${STATUS.error.bg};
  color: ${STATUS.error.fg};
}
/* Phase G — anchor lost. Dashed olive ring so it reads as "needs attention"
   without claiming an outright error. Click retries the re-anchor lookup. */
.pa-bubble.anchor-lost {
  border-style: dashed;
  border-color: ${STATUS.anchorLost.border};
  background: ${STATUS.anchorLost.bg};
  color: ${STATUS.anchorLost.fg};
}

.pa-bubble-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: pa-bubble-spin 0.9s linear infinite;
}
@keyframes pa-bubble-spin { to { transform: rotate(360deg); } }

.pa-drag-handle {
  position: absolute;
  width: 16px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  z-index: 2147483646;
  color: #8a8270;
  border-radius: 4px;
  transition: color 100ms ease, background 100ms ease, box-shadow 100ms ease;
}
.pa-drag-handle svg { display: block; }
.pa-drag-handle:hover { color: ${BRAND_INK}; background: #f5efd0; }
.pa-drag-handle.dragging {
  cursor: grabbing;
  color: ${BRAND_INK};
  background: #f5efd0;
  box-shadow: 0 0 0 3px ${BRAND_GOLD};
}
.pa-drag-handle[hidden] { display: none; }

.pa-pointer {
  position: absolute;
  width: 18px;
  height: 10px;
  pointer-events: none;
  z-index: 2147483646;
  overflow: visible;
}
.pa-pointer[hidden] { display: none; }

/* Smooth the bubble's color transition when the anchor is lost — the
   class flips on suddenly during HMR / DOM rewrites, so a brief fade
   reads less like an error spike. */
.pa-bubble {
  transition: transform 120ms ease,
              box-shadow 120ms ease,
              background 220ms ease,
              border-color 220ms ease,
              color 220ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .pa-bubble, .pa-bubble:hover,
  .pa-drag-handle, .pa-drag-handle.dragging {
    transition: none !important;
    transform: none !important;
  }
  .pa-bubble.running::after { animation: none; opacity: 0.3; }
  .pa-bubble-spinner { animation: none; }
}
`;

/**
 * Single WebSocket connection per page, multiplexed across however many
 * composers exist (only one expanded at a time, but minimized bubbles
 * keep their subscriptions live so agent events keep arriving and the
 * bubble visual updates).
 */
class WidgetWsClient {
  private socket: WebSocket | null = null;
  private readonly handlers = new Map<string, FeedbackHandler>();
  private readonly queue: string[] = [];
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitlyClosed = false;

  constructor(private readonly url: string) {}

  subscribe(feedbackId: string, handler: FeedbackHandler): void {
    this.handlers.set(feedbackId, handler);
    this.ensureConnected();
    this.send({ type: 'subscribe', feedbackId });
  }

  unsubscribe(feedbackId: string): void {
    this.handlers.delete(feedbackId);
    this.send({ type: 'unsubscribe', feedbackId });
    if (this.handlers.size === 0) this.closeIdle();
  }

  sendUserMessage(feedbackId: string, content: string): void {
    this.send({ type: 'user_message', feedbackId, content });
  }

  sendAskResponse(askId: string, answer: string): void {
    this.send({ type: 'ask_response', askId, answer });
  }

  sendInterrupt(feedbackId: string): void {
    this.send({ type: 'interrupt', feedbackId });
  }

  sendLandRequest(feedbackId: string): void {
    this.send({ type: 'land_request', feedbackId });
  }

  sendDiscardRequest(feedbackId: string): void {
    this.send({ type: 'discard_request', feedbackId });
  }

  private send(msg: object): void {
    const payload = JSON.stringify(msg);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else {
      this.queue.push(payload);
      this.ensureConnected();
    }
  }

  private ensureConnected(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.explicitlyClosed = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.socket = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket.addEventListener('open', () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      for (const id of this.handlers.keys()) {
        this.socket?.send(JSON.stringify({ type: 'subscribe', feedbackId: id }));
      }
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (item) this.socket?.send(item);
      }
    });
    this.socket.addEventListener('message', (msg) => this.onMessage(msg));
    this.socket.addEventListener('close', () => {
      if (this.explicitlyClosed || this.handlers.size === 0) return;
      this.scheduleReconnect();
    });
    this.socket.addEventListener('error', () => {
      // Errors are followed by 'close' which drives reconnect.
    });
  }

  private closeIdle(): void {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.socket?.close();
    } catch {
      // Ignore.
    }
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private onMessage(msg: MessageEvent): void {
    let parsed: ServerMessage;
    try {
      parsed = JSON.parse(typeof msg.data === 'string' ? msg.data : '');
    } catch {
      return;
    }
    switch (parsed.type) {
      case 'event': {
        const id = parsed.feedbackId;
        if (!id || !parsed.event) return;
        const h = this.handlers.get(id);
        if (h) h.onEvent(parsed.event);
        return;
      }
      case 'done': {
        const id = parsed.feedbackId;
        if (!id) return;
        const h = this.handlers.get(id);
        if (h) h.onDone();
        return;
      }
      case 'error': {
        const id = parsed.feedbackId;
        const message = parsed.message ?? 'unknown error';
        if (id) {
          const h = this.handlers.get(id);
          if (h) h.onError(message);
        }
        return;
      }
      case 'worktree_state': {
        const id = parsed.feedbackId;
        const state = parsed.state;
        if (!id || !state) return;
        const h = this.handlers.get(id);
        if (h?.onWorktreeState) {
          const payload: WorktreeStateMessage = { state };
          if (parsed.commitSha) payload.commitSha = parsed.commitSha;
          if (parsed.conflicts) payload.conflicts = parsed.conflicts;
          if (parsed.message) payload.message = parsed.message;
          if (typeof parsed.changesCount === 'number') {
            payload.changesCount = parsed.changesCount;
          }
          h.onWorktreeState(payload);
        }
        return;
      }
      case 'pong':
        return;
    }
  }
}

export function mount(): void {
  // Best-effort flush of outstanding worker writes on navigation.
  // Browsers don't await async work in these handlers, so guarantees
  // are weak — but the postMessages already in flight get a brief
  // window to land in OPFS before the worker is terminated. Pagehide
  // is more reliable than beforeunload for bfcache-restored pages,
  // so we register both.
  function flushOnUnload() {
    void flushBrowserDb();
  }
  window.addEventListener('beforeunload', flushOnUnload);
  window.addEventListener('pagehide', flushOnUnload);

  // Fire-and-forget OPFS-in-Worker DB init. Once ready, walk the
  // cache for any conversations that were still `pending` when the
  // page last unloaded and restore each as a minimized bubble.
  void initBrowserDb()
    .then(async (db) => {
      // eslint-disable-next-line no-console
      console.log('[pinagent:db] browser cache ready');
      try {
        const pending = await listPendingForCurrentPage(db, window.location.href);
        for (const row of pending) {
          restorePending(row);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pinagent:db] restore scan failed:', err);
      }
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[pinagent:db] init failed (cache disabled):', err);
    });

  // Document-level <style> tag for elements that live in document.body
  // (composer iframes, bubbles, picker cursor). The shadow root holds
  // only the FAB / hint / outline — anything that needs to scroll with
  // the page goes in the main document.
  if (!document.getElementById('pinagent-doc-styles')) {
    const docStyle = document.createElement('style');
    docStyle.id = 'pinagent-doc-styles';
    docStyle.textContent = DOC_STYLES;
    document.head.appendChild(docStyle);
  }

  const host = document.createElement('div');
  host.id = 'pinagent-root';
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '2147483647';
  document.documentElement.appendChild(host);

  const root = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  root.appendChild(style);

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.type = 'button';
  fab.title = 'Pinagent — pick an element';
  fab.style.pointerEvents = 'auto';
  fab.appendChild(buildPinIcon(26, BRAND_CREAM));
  root.appendChild(fab);

  const outline = document.createElement('div');
  outline.className = 'outline';
  outline.style.display = 'none';
  root.appendChild(outline);

  const state: State = { mode: 'idle' };
  const wsClient = createWsClient();
  const hotkeyChar = resolveHotkey();

  // Only one composer is expanded at a time. Opening a new one minimizes
  // the previously-expanded one to a bubble that keeps streaming in the
  // background.
  const composers = new Set<Composer>();
  let expandedComposer: Composer | null = null;

  function enterPicking() {
    state.mode = 'picking';
    fab.classList.add('active');
    document.documentElement.classList.add('pa-picking');

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Click an element. Esc to cancel.';
    hint.dataset.pp = 'hint';
    root.appendChild(hint);

    // Suspend pointer-events on the expanded composer iframe so clicks
    // pass through to the underlying page. Bubbles stay clickable so the
    // user can quickly swap to a minimized composer.
    if (expandedComposer) {
      expandedComposer.iframe.style.pointerEvents = 'none';
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function exitPicking() {
    state.mode = 'idle';
    fab.classList.remove('active');
    document.documentElement.classList.remove('pa-picking');
    outline.style.display = 'none';
    const hint = root.querySelector('[data-pp="hint"]');
    if (hint) hint.remove();
    if (expandedComposer) {
      expandedComposer.iframe.style.pointerEvents = 'auto';
    }
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onMove(e: MouseEvent) {
    const target = elementFromEvent(e);
    if (!target) return;
    drawOutline(target);
  }

  function onPick(e: MouseEvent) {
    const target = elementFromEvent(e);
    if (!target) return;
    // Don't pick a bubble as the new target — bubbles are part of the
    // widget's own UI. Clicking a bubble during picker = expand that
    // composer instead.
    if (target.classList.contains('pa-bubble')) {
      e.preventDefault();
      e.stopPropagation();
      exitPicking();
      const owner = bubbleOwner(target as HTMLElement);
      if (owner) swapTo(owner);
      return;
    }
    // Don't pick the drag handle either — silently cancel picker so the
    // user can grab the handle they were aiming for.
    if (target.classList.contains('pa-drag-handle')) {
      e.preventDefault();
      e.stopPropagation();
      exitPicking();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    exitPicking();
    openComposer(target, { x: e.clientX, y: e.clientY });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      exitPicking();
    }
  }

  function drawOutline(el: Element) {
    const r = el.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.top = `${r.top}px`;
    outline.style.left = `${r.left}px`;
    outline.style.width = `${r.width}px`;
    outline.style.height = `${r.height}px`;
  }

  function elementFromEvent(e: MouseEvent): Element | null {
    // Hide the FAB / hint / outline (shadow host) and the expanded
    // composer iframe so document.elementFromPoint sees the page
    // underneath. Bubbles stay visible — clicking one is meaningful
    // (swap to that composer).
    const prevHost = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    const prevExpanded = expandedComposer?.expanded
      ? expandedComposer.iframe.style.pointerEvents
      : null;
    if (expandedComposer?.expanded) {
      expandedComposer.iframe.style.pointerEvents = 'none';
    }

    const target = document.elementFromPoint(e.clientX, e.clientY);

    host.style.pointerEvents = prevHost;
    if (expandedComposer?.expanded && prevExpanded !== null) {
      // Inside picker mode the expanded iframe is already suspended
      // (enterPicking sets none). Restoring here would briefly re-enable
      // it between events. Honor the suspended state for the picker
      // session by re-setting to 'none' if we're still picking.
      expandedComposer.iframe.style.pointerEvents =
        state.mode === 'picking' ? 'none' : prevExpanded;
    }
    if (!target) return null;
    if (target === host) return null;
    return target;
  }

  function bubbleOwner(el: HTMLElement): Composer | null {
    for (const c of composers) {
      if (c.bubble === el) return c;
    }
    return null;
  }

  function swapTo(composer: Composer) {
    if (composer.expanded) return;
    if (expandedComposer && expandedComposer !== composer) {
      expandedComposer.minimize();
    }
    composer.expand();
    expandedComposer = composer;
  }

  /**
   * Cycle to the next composer with an in-flight agent run. Lets the
   * user keep tabs on multiple concurrent agents without hunting
   * bubbles by hand. Iteration order is insertion-order (the Set
   * preserves it). Wraps around. No-op if there's 0 or 1 active.
   */
  function hopToNextActive() {
    const active = Array.from(composers).filter(
      (c) => c.agentState === 'running' || c.agentState === 'pending',
    );
    const next = pickNextActive(active, expandedComposer);
    if (next) swapTo(next);
  }

  function openComposer(target: Element, click: { x: number; y: number }) {
    if (expandedComposer) {
      expandedComposer.minimize();
    }
    const composer = createComposer(target, click);
    composers.add(composer);
    expandedComposer = composer;
  }

  /**
   * Restoration entry — pull a pending conversation from the cache
   * back into the UI as a minimized bubble. If the target element
   * can't be located (DOM changed since the conversation was
   * created), we skip it. The user can still find the agent run on
   * the server via the markdown log; we just don't surface a bubble
   * with no anchor.
   */
  function restorePending(row: PendingRow): void {
    const sel = row.anchor?.selector;
    if (!sel) return;
    let target: Element | null = null;
    try {
      target = document.querySelector(sel);
    } catch {
      // Invalid selector (could happen if the page's element naming
      // scheme changed). Skip silently.
      return;
    }
    if (!target) {
      // eslint-disable-next-line no-console
      console.log(`[pinagent] anchor lost for ${row.conversation.id} (selector: ${sel})`);
      return;
    }

    // Avoid double-restoring if the user opened a fresh composer
    // pointing at this same conversation before init finished.
    for (const c of composers) {
      if (c.feedbackId === row.conversation.id) return;
    }

    const click = {
      x: row.anchor?.clickX ?? 0,
      y: row.anchor?.clickY ?? 0,
    };
    const composer = createComposer(target, click);
    // Setting feedbackId BEFORE the iframe's async load handler fires
    // is what flips it into restored mode (see wireComposerIframe).
    composer.feedbackId = row.conversation.id;
    composer.minimize();
    composers.add(composer);
  }

  /**
   * Phase G — try to recover a fresh DOM reference for a composer whose
   * `target` is no longer in the document. Mutates `composer.target` on
   * success and returns `true`; returns `false` if the lookup fails,
   * leaving the original (detached) target in place. The real lookup
   * lives in `selector.ts::findReanchorTarget` so it can be tested.
   */
  function tryReanchor(composer: Composer): boolean {
    const found = findReanchorTarget(composer.dataPaLoc, composer.selector);
    if (!found) return false;
    composer.target = found;
    return true;
  }

  function createComposer(target: Element, click: { x: number; y: number }): Composer {
    const loc = findLoc(target);
    const selector = shortSelector(target);
    const meta: ComposerMeta = {
      tag: target.tagName.toLowerCase(),
      label: describeElementLabel(target),
      loc,
      breadcrumbs: breadcrumbTags(target),
      chips: quickActionsFor(target),
    };
    const dataPaLoc = loc ? `${loc.file}:${loc.line}:${loc.col}` : null;

    // Iframe lives in document.body (not the shadow root) so it scrolls
    // naturally with the page via absolute positioning in page coords.
    const iframe = document.createElement('iframe');
    iframe.className = 'pa-iframe';
    iframe.title = 'Pinagent feedback';
    iframe.style.pointerEvents = 'auto';
    iframe.srcdoc = composerHTML(meta);
    iframe.style.width = `${IFRAME_W}px`;
    iframe.style.height = `${COMPOSER_H}px`;
    document.body.appendChild(iframe);

    const bubble = document.createElement('div');
    bubble.className = 'pa-bubble pending';
    bubble.title = 'Pinagent — click to expand';
    bubble.hidden = true;
    bubble.innerHTML = '<div class="pa-bubble-spinner"></div>';
    document.body.appendChild(bubble);

    // Drag grip — small visible handle inside the top-right corner of
    // the iframe header. Lives in document.body (not inside the iframe)
    // so we can track mousemove/mouseup on the parent document during a
    // drag, which we couldn't do from inside the iframe. The 2x4 dots
    // grid mirrors the redesign mock; styled in DOC_STYLES.
    const dragHandle = document.createElement('div');
    dragHandle.className = 'pa-drag-handle';
    dragHandle.title = 'Drag to reposition';
    dragHandle.innerHTML =
      '<svg width="8" height="16" viewBox="0 0 8 16" aria-hidden="true" fill="currentColor">' +
      '<circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/>' +
      '<circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/>' +
      '<circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/>' +
      '<circle cx="2" cy="14" r="1"/><circle cx="6" cy="14" r="1"/>' +
      '</svg>';
    document.body.appendChild(dragHandle);

    // Pointer tail — a small SVG triangle that sits on whichever edge
    // of the widget faces the target, so the widget visually anchors
    // back to the picked element. The path is two strokes only (the
    // two slanted edges) so the flat edge sits flush with the widget
    // border without doubling it.
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const pointer = document.createElementNS(SVG_NS, 'svg');
    pointer.setAttribute('class', 'pa-pointer');
    pointer.setAttribute('viewBox', '0 0 18 10');
    const pointerPath = document.createElementNS(SVG_NS, 'path');
    pointerPath.setAttribute('fill', '#fff');
    pointerPath.setAttribute('stroke', '#e5e7eb');
    pointerPath.setAttribute('stroke-width', '1');
    pointerPath.setAttribute('stroke-linejoin', 'round');
    pointer.appendChild(pointerPath);
    document.body.appendChild(pointer);

    function setAgentState(next: AgentState) {
      composer.agentState = next;
      bubble.classList.remove('pending', 'running', 'done', 'error');
      bubble.classList.add(next);
      if (next === 'done') bubble.innerHTML = '✓';
      else if (next === 'error') bubble.innerHTML = '✗';
      else bubble.innerHTML = '<div class="pa-bubble-spinner"></div>';
    }

    // Click-relative-to-target offset, captured at creation time. The
    // widget anchors at "the spot inside `target` the user clicked",
    // which means picking a huge container (body, layout) drops the
    // widget where the cursor actually was rather than at the target's
    // distant edge. As `target` moves through scroll/layout, the
    // anchor moves with it (same delta).
    const targetRect0 = target.getBoundingClientRect();
    const relX = click.x - targetRect0.left;
    const relY = click.y - targetRect0.top;

    // rAF loop that keeps iframe + bubble + drag handle pinned to the
    // anchor through layout shifts. Scrolling is handled natively by
    // absolute positioning, but layout changes (HMR, JS resize, etc.)
    // need a manual update.
    let rafHandle: number | null = null;
    // Composer iframe height — starts at COMPOSER_H and grows as the
    // user types (auto-grow), capped at MAX_COMPOSER_H. The iframe's
    // textarea posts its desired scrollHeight via window.postMessage
    // and the listener below clamps + applies it to iframe.style.height.
    // Resets to COMPOSER_H when the composer flips to the stream pane.
    let currentComposerH = COMPOSER_H;
    function positionLoop() {
      reposition();
      rafHandle = requestAnimationFrame(positionLoop);
    }
    function reposition() {
      // Phase G — re-anchor on staleness. If the target Node has been
      // detached (typically because HMR / a framework re-render replaced
      // it with a new element of the same shape), try to relocate it by
      // `data-pa-loc` first and CSS selector second. On success, swap
      // `composer.target` in place and keep going; the user sees no
      // disruption. On failure, surface a "anchor lost" indicator on the
      // bubble — re-clicking the bubble retries the lookup.
      if (!composer.target.isConnected) {
        if (tryReanchor(composer)) {
          if (composer.anchorLost) {
            composer.anchorLost = false;
            bubble.classList.remove('anchor-lost');
            bubble.removeAttribute('title');
          }
        } else if (!composer.anchorLost) {
          composer.anchorLost = true;
          bubble.classList.add('anchor-lost');
          bubble.title = 'Anchor lost — element removed in last update. Click to retry.';
        }
      } else if (composer.anchorLost) {
        composer.anchorLost = false;
        bubble.classList.remove('anchor-lost');
        bubble.removeAttribute('title');
      }

      const r = composer.target.getBoundingClientRect();
      // Anchor = where the user clicked, expressed in document coords.
      // Moves with the target as it scrolls/layout-shifts.
      const anchorDocX = r.left + window.scrollX + relX;
      const anchorDocY = r.top + window.scrollY + relY;
      // Anchor in viewport coords (used to decide above/below placement).
      const anchorViewportY = r.top + relY;

      const composerH = composer.feedbackId ? STREAM_H : currentComposerH;
      const spaceBelow = window.innerHeight - anchorViewportY;
      const placeBelow = spaceBelow >= composerH + 16 || anchorViewportY < composerH + 16;
      const baseTop = placeBelow ? anchorDocY + 12 : anchorDocY - composerH - 12;
      const baseLeft = anchorDocX;
      const iframeTop = Math.max(8, baseTop + composer.userOffsetY);
      const iframeLeft = Math.max(
        window.scrollX + 8,
        Math.min(
          window.scrollX + window.innerWidth - IFRAME_W - 8,
          baseLeft + composer.userOffsetX,
        ),
      );
      iframe.style.top = `${iframeTop}px`;
      iframe.style.left = `${iframeLeft}px`;

      // Bubble: top-left of the iframe (loading-state indicator that
      // shows where the widget is/was).
      bubble.style.top = `${iframeTop - BUBBLE_SIZE / 2}px`;
      bubble.style.left = `${iframeLeft - BUBBLE_SIZE / 2}px`;

      // Drag handle: nestled inside the iframe's top-right header
      // corner — 12px in from the iframe's right and top edges, lining
      // up visually with the card's 12px padding. Hidden when the
      // composer is minimized to a bubble.
      const handleW = 16;
      dragHandle.style.top = `${iframeTop + 12}px`;
      dragHandle.style.left = `${iframeLeft + IFRAME_W - handleW - 12}px`;
      dragHandle.hidden = !composer.expanded;

      // Pointer tail. Sits on whichever widget edge faces the click;
      // horizontally aligned with the click's X, clamped so it stays
      // on the widget (and clear of the bubble / drag handle).
      const POINTER_W = 18;
      const POINTER_H = 10;
      const pointerLeft = Math.max(
        iframeLeft + 24,
        Math.min(iframeLeft + IFRAME_W - POINTER_W - 24, anchorDocX - POINTER_W / 2),
      );
      if (placeBelow) {
        pointerPath.setAttribute(
          'd',
          `M 0.5 ${POINTER_H} L 9 0.5 L ${POINTER_W - 0.5} ${POINTER_H}`,
        );
        pointer.style.top = `${iframeTop - POINTER_H + 1}px`;
      } else {
        pointerPath.setAttribute('d', `M 0.5 0.5 L ${POINTER_W - 0.5} 0.5 L 9 ${POINTER_H - 0.5}`);
        pointer.style.top = `${iframeTop + composerH - 1}px`;
      }
      pointer.setAttribute('width', String(POINTER_W));
      pointer.setAttribute('height', String(POINTER_H));
      pointer.style.left = `${pointerLeft}px`;
      pointer.style.display = composer.expanded ? '' : 'none';
    }

    const composer: Composer = {
      feedbackId: null,
      target,
      iframe,
      bubble,
      dragHandle,
      dataPaLoc,
      selector,
      anchorLost: false,
      userOffsetX: 0,
      userOffsetY: 0,
      turn: 0,
      agentState: 'pending',
      expanded: true,
      close() {
        // User-initiated dismissal — drop from cache so it doesn't
        // come back on the next reload. Markers (status='fixed') would
        // also suppress restoration, but the user explicitly said
        // "go away" so we don't keep their transcript around either.
        if (composer.feedbackId) {
          wsClient.unsubscribe(composer.feedbackId);
          const db = getBrowserDb();
          if (db) {
            void deleteConversation(db, composer.feedbackId).catch(() => {});
          }
        }
        if (rafHandle != null) cancelAnimationFrame(rafHandle);
        window.removeEventListener('message', onIframeMessage);
        iframe.remove();
        bubble.remove();
        dragHandle.remove();
        pointer.remove();
        composers.delete(composer);
        if (expandedComposer === composer) expandedComposer = null;
      },
      expand() {
        composer.expanded = true;
        iframe.style.height = `${composer.feedbackId ? STREAM_H : currentComposerH}px`;
        iframe.hidden = false;
        bubble.hidden = true;
        reposition();
      },
      minimize() {
        composer.expanded = false;
        iframe.hidden = true;
        bubble.hidden = false;
        reposition();
        // Keep the outer registry honest: there's no expanded composer
        // now. swapTo and openComposer reassign expandedComposer right
        // after this returns, so the clear is mainly load-bearing for
        // direct minimize() callers (e.g. Esc) where no replacement
        // composer is taking over.
        if (expandedComposer === composer) expandedComposer = null;
      },
    };

    // Drag: mousedown on handle starts tracking; iframe pointer-events
    // disabled mid-drag so a mousemove that crosses into the iframe
    // doesn't get swallowed; restored on mouseup.
    dragHandle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startOffsetX = composer.userOffsetX;
      const startOffsetY = composer.userOffsetY;
      const prevIframePE = iframe.style.pointerEvents;
      iframe.style.pointerEvents = 'none';
      dragHandle.classList.add('dragging');
      document.documentElement.style.cursor = 'grabbing';

      function onMouseMove(ev: MouseEvent) {
        composer.userOffsetX = startOffsetX + (ev.clientX - startX);
        composer.userOffsetY = startOffsetY + (ev.clientY - startY);
        reposition();
      }
      function onMouseUp() {
        iframe.style.pointerEvents = prevIframePE;
        dragHandle.classList.remove('dragging');
        document.documentElement.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('mouseup', onMouseUp, true);
      }
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mouseup', onMouseUp, true);
    });

    bubble.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // When the anchor is lost, prioritise re-trying the lookup over
      // expanding the composer. If the user genuinely deleted the
      // target, repeated clicks will keep failing — Minimize-then-X
      // through the open composer is still the dismissal path.
      if (composer.anchorLost) {
        if (tryReanchor(composer)) {
          composer.anchorLost = false;
          bubble.classList.remove('anchor-lost');
          bubble.removeAttribute('title');
          reposition();
        }
        return;
      }
      swapTo(composer);
    });

    // Auto-grow: the iframe's textarea posts its desired scrollHeight
    // here as it changes. We clamp to [MIN_TA_H, MAX_TA_H] (so a giant
    // paste doesn't push the composer past the viewport — internal
    // scroll takes over past the cap) and translate into iframe height
    // by adding the delta from MIN_TA_H to COMPOSER_H. Skipped while
    // the stream pane is shown (post-submit) — that pane has its own
    // fixed STREAM_H height. Listener is removed in close().
    function onIframeMessage(ev: MessageEvent) {
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data as { type?: string; taHeight?: number } | null;
      if (!data || data.type !== 'pa-composer-resize-ta') return;
      if (composer.feedbackId) return;
      const ta = Math.min(MAX_TA_H, Math.max(MIN_TA_H, Number(data.taHeight) || MIN_TA_H));
      const next = COMPOSER_H + (ta - MIN_TA_H);
      if (next === currentComposerH) return;
      currentComposerH = next;
      if (composer.expanded) iframe.style.height = `${next}px`;
      reposition();
    }
    window.addEventListener('message', onIframeMessage);

    reposition();
    positionLoop();

    iframe.addEventListener('load', () => {
      wireComposerIframe(composer, loc, selector, setAgentState);
    });

    return composer;

    function wireComposerIframe(
      c: Composer,
      loc2: ReturnType<typeof findLoc>,
      selector2: string,
      setAgentState2: (s: AgentState) => void,
    ): void {
      const idoc = iframe.contentDocument;
      const iwin = iframe.contentWindow;
      if (!idoc || !iwin) return;

      const ta = idoc.getElementById('pa-ta') as HTMLTextAreaElement | null;
      const cancel = idoc.getElementById('pa-cancel') as HTMLButtonElement | null;
      const submit = idoc.getElementById('pa-submit') as HTMLButtonElement | null;
      const metaEl = idoc.getElementById('pa-meta') as HTMLElement | null;
      const composerPane = idoc.getElementById('pa-composer-pane');
      const streamPane = idoc.getElementById('pa-stream-pane');
      const streamHeader = idoc.getElementById('pa-stream-header');
      const streamLog = idoc.getElementById('pa-stream-log');
      const streamFooter = idoc.getElementById('pa-stream-footer');
      const dismissBtn = idoc.getElementById('pa-dismiss') as HTMLButtonElement | null;
      const stopBtn = idoc.getElementById('pa-stop') as HTMLButtonElement | null;
      const followInput = idoc.getElementById('pa-follow-input') as HTMLTextAreaElement | null;
      const followSend = idoc.getElementById('pa-follow-send') as HTMLButtonElement | null;
      const lifecycleRow = idoc.getElementById('pa-lifecycle') as HTMLElement | null;
      const lifecycleLabel = idoc.getElementById('pa-lifecycle-label') as HTMLElement | null;
      const landBtn = idoc.getElementById('pa-land') as HTMLButtonElement | null;
      const discardBtn = idoc.getElementById('pa-discard') as HTMLButtonElement | null;
      if (
        !ta ||
        !cancel ||
        !submit ||
        !metaEl ||
        !composerPane ||
        !streamPane ||
        !streamHeader ||
        !streamLog ||
        !streamFooter ||
        !dismissBtn ||
        !stopBtn ||
        !followInput ||
        !followSend ||
        !lifecycleRow ||
        !lifecycleLabel ||
        !landBtn ||
        !discardBtn
      ) {
        return;
      }
      const lifecycle: LifecycleEls = {
        row: lifecycleRow,
        label: lifecycleLabel,
        landBtn,
        discardBtn,
      };

      if (loc2) {
        metaEl.classList.add('clickable');
        metaEl.title = 'Open in editor';
        metaEl.addEventListener('click', async () => {
          metaEl.classList.add('loading');
          try {
            const qs = new URLSearchParams({
              file: loc2.file,
              line: String(loc2.line),
              col: String(loc2.col),
            });
            const res = await fetch(`/__pinagent/open?${qs.toString()}`, { method: 'POST' });
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error || `HTTP ${res.status}`);
            }
            metaEl.classList.remove('loading');
            metaEl.classList.add('ok');
            setTimeout(() => metaEl.classList.remove('ok'), 1000);
          } catch (err) {
            metaEl.classList.remove('loading');
            metaEl.classList.add('err');
            const msg = err instanceof Error ? err.message : String(err);
            metaEl.title = `Failed to open: ${msg}`;
            setTimeout(() => {
              metaEl.classList.remove('err');
              metaEl.title = 'Open in editor';
            }, 2000);
          }
        });
      }

      iwin.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          // Three cases:
          // - Pre-submit (composer pane): close — there's nothing alive
          //   to preserve.
          // - Post-submit, agent loading/running: minimize so the agent
          //   keeps working in the background; bubble shows progress.
          // - Post-submit, agent done/errored: close — nothing's
          //   happening anymore, no point keeping it around.
          const loading = c.agentState === 'pending' || c.agentState === 'running';
          if (c.feedbackId && loading) c.minimize();
          else c.close();
          return;
        }
        if (hotkeyChar && e.key.toLowerCase() === hotkeyChar && !shouldIgnoreHotkey(e)) {
          e.preventDefault();
          if (state.mode === 'picking') exitPicking();
          else enterPicking();
          return;
        }
        // Shift+N from inside an iframe — same hop as on the host
        // doc. Keystrokes inside an iframe don't bubble to the
        // parent, so without this the hop wouldn't work while the
        // user has focus inside the expanded composer.
        if (isHopKey(e) && !shouldIgnoreHotkey(e)) {
          e.preventDefault();
          hopToNextActive();
        }
      });

      // Restored composer: fresh page load found a pending conversation
      // in the DB cache. Skip the composer-pane plumbing (textarea,
      // submit, cancel) and jump straight to the stream pane, replaying
      // the historical transcript from cache before attaching live WS.
      if (c.feedbackId) {
        composerPane.hidden = true;
        streamPane.hidden = false;
        if (c.expanded) iframe.style.height = `${STREAM_H}px`;
        void (async () => {
          const db = getBrowserDb();
          let replayed: ReplayMessage[] = [];
          if (db) {
            try {
              const msgs = await getConversationMessages(db, c.feedbackId as string);
              // eslint-disable-next-line no-console
              console.log(
                `[pinagent:db] replay ${c.feedbackId}: ${msgs.length} messages`,
                msgs.length > 0 ? { first: msgs[0], last: msgs[msgs.length - 1] } : null,
              );
              replayed = msgs.map((m) => ({
                turn: m.turn,
                role: m.role,
                content: m.content,
              }));
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[pinagent:db] replay fetch failed:', err);
            }
          }
          attachStreamHandler(
            wsClient,
            idoc,
            c,
            setAgentState2,
            streamHeader,
            streamLog,
            streamFooter,
            dismissBtn,
            stopBtn,
            followInput,
            followSend,
            lifecycle,
            replayed,
          );
        })();
        return;
      }

      // Fresh composer: wire the composer-pane (textarea + submit/cancel).
      setTimeout(() => ta.focus(), 0);

      // Auto-grow: measure the textarea's natural scrollHeight after
      // each input and post it to the parent, which clamps + applies
      // it to iframe.style.height. The 0-then-restore trick is the
      // standard auto-grow pattern — without it, scrollHeight returns
      // the current rendered height (clamped by flex sizing) instead
      // of the content's natural height.
      let lastReported = -1;
      const postTextareaHeight = () => {
        const saved = ta.style.height;
        ta.style.height = '0';
        const natural = ta.scrollHeight;
        ta.style.height = saved;
        if (natural !== lastReported) {
          lastReported = natural;
          iwin.parent.postMessage({ type: 'pa-composer-resize-ta', taHeight: natural }, '*');
        }
      };

      ta.addEventListener('input', () => {
        submit.disabled = ta.value.trim().length === 0;
        postTextareaHeight();
      });
      ta.addEventListener('keydown', (e) => {
        // Cmd/Ctrl+Enter submits; plain Enter inserts a newline so
        // long-form prompts read naturally. Matches the "⌘↵ submit"
        // hint shown in the composer footer.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (!submit.disabled) submit.click();
        }
      });

      // Quick-action chips: clicking one drops the chip's starter
      // prompt into the textarea, focuses it, and parks the cursor
      // at the end so the user can finish the sentence.
      const chips = idoc.querySelectorAll<HTMLButtonElement>('.qa-chip');
      chips.forEach((chip) => {
        chip.addEventListener('click', () => {
          const prompt = chip.getAttribute('data-prompt') ?? '';
          ta.value = prompt;
          submit.disabled = ta.value.trim().length === 0;
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
          postTextareaHeight();
        });
      });

      cancel.addEventListener('click', () => c.close());

      submit.addEventListener('click', async () => {
        submit.disabled = true;
        submit.textContent = 'Sending…';
        try {
          const screenshot = await capturePageScreenshot(
            (node) =>
              node !== host &&
              node !== (c.iframe as unknown as HTMLElement) &&
              node !== (c.bubble as unknown as HTMLElement),
          );
          const payload = {
            comment: ta.value.trim(),
            loc: loc2,
            selector: selector2,
            url: window.location.href,
            viewport: { w: window.innerWidth, h: window.innerHeight },
            userAgent: navigator.userAgent,
            screenshot,
            createdAt: new Date().toISOString(),
          };
          const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
          }
          const result = (await res.json().catch(() => null)) as {
            id: string;
            agentSpawned?: boolean;
          } | null;

          if (result?.id && result.agentSpawned) {
            c.feedbackId = result.id;
            // First turn starts at 1. All events from this run get
            // stamped with c.turn until the next user follow-up bumps it.
            c.turn = 1;
            composerPane.hidden = true;
            streamPane.hidden = false;
            streamHeader.textContent = '✓ Submitted — agent starting…';
            streamFooter.textContent = '';
            if (c.expanded) iframe.style.height = `${STREAM_H}px`;
            setAgentState2('running');

            // Browser DB write-through. Skips silently if the cache
            // hasn't initialised yet — the conversation is still safe
            // on the server, the cache just won't have it.
            const db = getBrowserDb();
            if (db) {
              void recordConversationStart(db, {
                feedbackId: result.id,
                comment: payload.comment,
                anchor: {
                  url: payload.url,
                  file: loc2?.file ?? null,
                  line: loc2?.line ?? null,
                  col: loc2?.col ?? null,
                  selector: selector2,
                  clickX: click.x,
                  clickY: click.y,
                  viewportW: payload.viewport.w,
                  viewportH: payload.viewport.h,
                },
              }).catch((err) =>
                // eslint-disable-next-line no-console
                console.warn('[pinagent:db] recordConversationStart failed:', err),
              );
            }

            attachStreamHandler(
              wsClient,
              idoc,
              c,
              setAgentState2,
              streamHeader,
              streamLog,
              streamFooter,
              dismissBtn,
              stopBtn,
              followInput,
              followSend,
              lifecycle,
            );
          } else {
            toast('Sent', 'success');
            c.close();
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast(`Error: ${msg}`, 'error');
          submit.disabled = false;
          submit.textContent = 'Submit';
        }
      });
    }
  }

  function toast(text: string, kind: 'success' | 'error') {
    const el = document.createElement('div');
    el.className = `toast${kind === 'error' ? ' error' : ''}`;
    el.textContent = text;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  // FAB drag + snap-to-corner. mousedown starts tracking; movement past
  // a small threshold turns it into a real drag (free-positioning).
  // mouseup snaps to whichever viewport corner is closest. A click that
  // didn't cross the threshold falls through to the normal toggle.
  const DRAG_THRESHOLD_PX = 4;
  const FAB_PADDING = 20;
  type Corner = 'tl' | 'tr' | 'bl' | 'br';
  let suppressNextFabClick = false;

  function snapFabToCorner(corner: Corner) {
    const isTop = corner === 'tl' || corner === 'tr';
    const isLeft = corner === 'tl' || corner === 'bl';
    fab.style.top = isTop ? `${FAB_PADDING}px` : 'auto';
    fab.style.bottom = isTop ? 'auto' : `${FAB_PADDING}px`;
    fab.style.left = isLeft ? `${FAB_PADDING}px` : 'auto';
    fab.style.right = isLeft ? 'auto' : `${FAB_PADDING}px`;
  }

  function nearestCorner(cx: number, cy: number): Corner {
    const top = cy < window.innerHeight / 2;
    const left = cx < window.innerWidth / 2;
    if (top && left) return 'tl';
    if (top) return 'tr';
    if (left) return 'bl';
    return 'br';
  }

  fab.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // Picking mode owns the FAB click (toggle off). Don't intercept.
    if (state.mode === 'picking') return;

    const startX = e.clientX;
    const startY = e.clientY;
    const fabRect = fab.getBoundingClientRect();
    const grabX = startX - fabRect.left;
    const grabY = startY - fabRect.top;
    let dragging = false;

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        fab.classList.add('dragging');
      }
      // Free-position from the cursor, preserving where the user
      // grabbed it (so the FAB doesn't jump under the cursor).
      const x = Math.max(0, Math.min(window.innerWidth - fabRect.width, ev.clientX - grabX));
      const y = Math.max(0, Math.min(window.innerHeight - fabRect.height, ev.clientY - grabY));
      fab.style.left = `${x}px`;
      fab.style.top = `${y}px`;
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      if (!dragging) return;
      fab.classList.remove('dragging');
      const r = fab.getBoundingClientRect();
      snapFabToCorner(nearestCorner(r.left + r.width / 2, r.top + r.height / 2));
      // Suppress the click event that fires after this mouseup so the
      // drag doesn't accidentally toggle picker mode.
      suppressNextFabClick = true;
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
  });

  fab.addEventListener('click', () => {
    if (suppressNextFabClick) {
      suppressNextFabClick = false;
      return;
    }
    if (state.mode === 'picking') exitPicking();
    else if (state.mode === 'idle') enterPicking();
  });

  if (hotkeyChar) {
    fab.title = `Pinagent — press ${hotkeyChar.toUpperCase()} or click to pick · Shift+N to hop between active widgets`;
    document.addEventListener(
      'keydown',
      (e) => {
        if (shouldIgnoreHotkey(e)) return;
        if (e.key.toLowerCase() !== hotkeyChar) return;
        e.preventDefault();
        if (state.mode === 'picking') exitPicking();
        else enterPicking();
      },
      { capture: true },
    );
  }

  document.addEventListener(
    'keydown',
    (e) => {
      if (!isHopKey(e)) return;
      if (shouldIgnoreHotkey(e)) return;
      e.preventDefault();
      hopToNextActive();
    },
    { capture: true },
  );
}

function createWsClient(): WidgetWsClient {
  const cfg = (window as unknown as { __pinagentConfig?: { wsUrl?: string | null } })
    .__pinagentConfig;
  const url = cfg?.wsUrl ?? `ws://${window.location.hostname || '127.0.0.1'}:53636/__pinagent/ws`;
  return new WidgetWsClient(url);
}

interface ReplayMessage {
  turn: number;
  role: string;
  content: unknown;
}

function attachStreamHandler(
  client: WidgetWsClient,
  idoc: Document,
  composer: Composer,
  setAgentState: (s: AgentState) => void,
  header: HTMLElement,
  log: HTMLElement,
  footer: HTMLElement,
  dismissBtn: HTMLButtonElement,
  stopBtn: HTMLButtonElement,
  followInput: HTMLTextAreaElement,
  followSend: HTMLButtonElement,
  lifecycle: LifecycleEls,
  /**
   * Historical messages to replay before going live. Restoration on
   * reload uses this to repopulate the stream pane from the browser
   * cache. Replayed events are NOT re-persisted (they're already in
   * the DB).
   */
  replayed?: ReplayMessage[],
): void {
  if (!composer.feedbackId) return;
  const feedbackId = composer.feedbackId;
  let activeTextBlock: HTMLElement | null = null;
  let lastToolChip: HTMLElement | null = null;
  let pendingAskId: string | null = null;
  let pendingAskFormRoot: HTMLElement | null = null;
  let apiKeySource: string | null = null;
  let turnRunning = true;
  let worktreeState: WorktreeWireState = 'none';
  // Last known uncommitted-file count for this worktree, surfaced by the
  // server in the `worktree_state` broadcast. `null` means unknown
  // (server couldn't run `git status`, or the worktree is gone) — the
  // label omits the count rather than showing a misleading "0 changes".
  let worktreeChanges: number | null = null;

  function setStopVisible(visible: boolean) {
    stopBtn.hidden = !visible;
  }
  setStopVisible(true);

  // Header "thinking" spinner — visible whenever a turn is in flight,
  // including the gap between submit and the first event. CSS picks
  // it up from the `.running` class via a ::before pseudo-element,
  // which survives `header.textContent = ...` updates.
  function setHeaderRunning(running: boolean) {
    if (running) header.classList.add('running');
    else header.classList.remove('running');
    // Land/Discard are gated on `!turnRunning`; refresh the row so the
    // buttons disable as soon as a new turn starts and re-enable the
    // moment one ends, without each call site having to know about
    // lifecycle state.
    renderLifecycle();
  }
  setHeaderRunning(true);

  stopBtn.addEventListener('click', () => {
    if (!turnRunning) return;
    client.sendInterrupt(feedbackId);
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping…';
  });

  dismissBtn.addEventListener('click', () => {
    if (turnRunning || pendingAskId) {
      client.sendInterrupt(feedbackId);
    }
    composer.close();
  });

  function el(tag: string, className?: string, text?: string): HTMLElement {
    const node = idoc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function append(node: HTMLElement) {
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
  }

  function setFollowEnabled(enabled: boolean) {
    followInput.disabled = !enabled;
    followSend.disabled = !enabled || followInput.value.trim().length === 0;
    followInput.placeholder = enabled
      ? 'Send a follow-up…'
      : pendingAskId
        ? 'Answer the question above to continue.'
        : 'Working…';
  }

  function renderAskUserForm(askId: string, question: string, options?: string[]) {
    if (pendingAskFormRoot) pendingAskFormRoot.remove();
    pendingAskId = askId;

    const wrap = el('div', 'ask-form');
    wrap.appendChild(el('div', 'ask-question', question));

    if (options && options.length > 0) {
      const opts = el('div', 'ask-options');
      for (const o of options) {
        const btn = el('button', 'ask-option') as HTMLButtonElement;
        btn.type = 'button';
        btn.textContent = o;
        btn.addEventListener('click', () => submitAnswer(o));
        opts.appendChild(btn);
      }
      wrap.appendChild(opts);
    }

    const row = el('div', 'ask-row');
    const ta = el('textarea', 'ask-input') as HTMLTextAreaElement;
    ta.placeholder = 'Type your answer…';
    ta.rows = 2;
    const sendBtn = el('button', 'btn primary') as HTMLButtonElement;
    sendBtn.type = 'button';
    sendBtn.textContent = 'Send';
    sendBtn.disabled = true;
    ta.addEventListener('input', () => {
      sendBtn.disabled = ta.value.trim().length === 0;
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) sendBtn.click();
      }
    });
    sendBtn.addEventListener('click', () => {
      const answer = ta.value.trim();
      if (!answer) return;
      submitAnswer(answer);
    });
    row.appendChild(ta);
    row.appendChild(sendBtn);
    wrap.appendChild(row);

    pendingAskFormRoot = wrap;
    append(wrap);
    setTimeout(() => ta.focus(), 0);
    setFollowEnabled(false);

    function submitAnswer(answer: string) {
      client.sendAskResponse(askId, answer);
      const replaced = el('div', 'ask-resolved');
      replaced.appendChild(el('div', 'ask-question', question));
      replaced.appendChild(el('div', 'ask-answer', answer));
      wrap.replaceWith(replaced);
      pendingAskFormRoot = null;
      pendingAskId = null;
      setFollowEnabled(!turnRunning);
    }
  }

  followInput.addEventListener('input', () => {
    setFollowEnabled(!turnRunning && !pendingAskId);
  });
  followInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!followSend.disabled) followSend.click();
    }
  });
  followSend.addEventListener('click', () => {
    const content = followInput.value.trim();
    if (!content) return;
    // Bump turn BEFORE recording — every event from this point until
    // the next user message belongs to the new turn.
    composer.turn += 1;
    const db = getBrowserDb();
    if (db) {
      void recordUserMessage(db, feedbackId, composer.turn, content).catch((err) =>
        // eslint-disable-next-line no-console
        console.warn('[pinagent:db] recordUserMessage failed:', err),
      );
    }
    client.sendUserMessage(feedbackId, content);
    append(el('div', 'user-msg', content));
    followInput.value = '';
    turnRunning = true;
    setHeaderRunning(true);
    stopBtn.disabled = false;
    stopBtn.textContent = 'Stop';
    setStopVisible(true);
    setFollowEnabled(false);
    header.textContent = 'Working…';
    footer.textContent = '';
    setAgentState('running');
  });
  setFollowEnabled(false);

  function processEvent(event: AgentEvent) {
    switch (event.type) {
      case 'init': {
        const session = String(event.sessionId ?? '').slice(0, 8);
        const model = String(event.model ?? 'claude');
        apiKeySource = typeof event.apiKeySource === 'string' ? event.apiKeySource : null;
        header.textContent = `Working · ${model}${session ? ` · ${session}` : ''}`;
        turnRunning = true;
        setHeaderRunning(true);
        stopBtn.disabled = false;
        stopBtn.textContent = 'Stop';
        setStopVisible(true);
        setFollowEnabled(false);
        setAgentState('running');
        break;
      }
      case 'text': {
        const text = String(event.text ?? '');
        if (!text) break;
        if (!activeTextBlock) {
          activeTextBlock = el('div', 'msg', text);
          append(activeTextBlock);
        } else {
          activeTextBlock.textContent = `${activeTextBlock.textContent ?? ''}\n${text}`;
          log.scrollTop = log.scrollHeight;
        }
        lastToolChip = null;
        break;
      }
      case 'tool_use': {
        activeTextBlock = null;
        const name = String(event.name ?? 'tool');
        const summary = String(event.summary ?? '');
        const chip = el('div', 'chip');
        chip.appendChild(el('span', 'chip-name', name));
        if (summary) chip.appendChild(el('span', 'chip-summary', summary));
        const status = el('span', 'chip-status', '…');
        chip.appendChild(status);
        lastToolChip = chip;
        append(chip);
        break;
      }
      case 'tool_result': {
        const ok = !!event.ok;
        if (lastToolChip) {
          const status = lastToolChip.querySelector('.chip-status');
          if (status) {
            status.textContent = ok ? '✓' : '✗';
            (status as HTMLElement).classList.add(ok ? 'ok' : 'err');
          }
        } else {
          append(el('div', `chip ${ok ? '' : 'err'}`, ok ? '✓ tool result' : '✗ tool result'));
        }
        lastToolChip = null;
        break;
      }
      case 'ask_user': {
        activeTextBlock = null;
        lastToolChip = null;
        const askId = String(event.askId ?? '');
        const question = String(event.question ?? '');
        const options = Array.isArray(event.options) ? (event.options as string[]) : undefined;
        if (!askId || !question) break;
        renderAskUserForm(askId, question, options);
        break;
      }
      case 'error': {
        activeTextBlock = null;
        lastToolChip = null;
        append(el('div', 'err-line', String(event.message ?? 'error')));
        setAgentState('error');
        turnRunning = false;
        setHeaderRunning(false);
        setStopVisible(false);
        if (!pendingAskId) setFollowEnabled(true);
        // Terminal: stop the conversation from restoring on next
        // reload. The transcript stays in the cache (it's still
        // useful for review) — only the status flips.
        const db = getBrowserDb();
        if (db) {
          void markConversationResolved(db, feedbackId, 'wontfix').catch(() => {});
        }
        break;
      }
      case 'status_changed': {
        // Server-authoritative status flip — the agent called
        // resolve_feedback (or similar) and the server's Storage
        // wrote the new status. Mirror that into the browser cache
        // so this conversation stops showing as pending on reload.
        const status = String(event.status ?? '');
        if (status === 'fixed' || status === 'wontfix' || status === 'deferred') {
          const db = getBrowserDb();
          if (db) {
            const resolvedRaw = event.resolvedAt;
            const resolvedAt = typeof resolvedRaw === 'string' ? new Date(resolvedRaw) : null;
            void markConversationResolved(db, feedbackId, status, resolvedAt).catch(() => {});
          }
          // Surface the resolution in the live UI too.
          const noteRaw = event.note;
          if (typeof noteRaw === 'string' && noteRaw) {
            append(el('div', 'msg', `Resolved (${status}): ${noteRaw}`));
          } else {
            append(el('div', 'msg', `Resolved (${status}).`));
          }
          setAgentState(status === 'fixed' ? 'done' : 'error');
        }
        break;
      }
      case 'result': {
        activeTextBlock = null;
        lastToolChip = null;
        const subtype = String(event.subtype ?? '');
        const cost = typeof event.totalCostUsd === 'number' ? event.totalCostUsd : 0;
        const turns = typeof event.numTurns === 'number' ? event.numTurns : 0;
        const ok = subtype === 'success';
        header.textContent = ok ? '✓ Done' : `Ended: ${subtype}`;
        const turnsLabel = `${turns} turn${turns === 1 ? '' : 's'}`;
        if (apiKeySource === 'oauth') {
          footer.textContent = `${turnsLabel} · subscription`;
          footer.title = `≈ $${cost.toFixed(4)} API-equivalent (not billed — Claude subscription)`;
        } else {
          footer.textContent = `${turnsLabel} · $${cost.toFixed(4)}`;
          footer.title = '';
        }
        turnRunning = false;
        setHeaderRunning(false);
        setStopVisible(false);
        setAgentState(ok ? 'done' : 'error');
        if (!pendingAskId) setFollowEnabled(true);
        // Terminal: flip status so restoration scans skip this.
        const db = getBrowserDb();
        if (db) {
          void markConversationResolved(db, feedbackId, ok ? 'fixed' : 'wontfix').catch(() => {});
        }
        break;
      }
    }
  }

  // Replay history before going live. User-typed follow-ups stored
  // with role='user' render as the same user-msg bubble the live
  // path emits at send time.
  if (replayed !== undefined) {
    if (replayed.length > 0) {
      for (const m of replayed) {
        composer.turn = m.turn;
        if (m.role === 'user') {
          const content = m.content as { text?: string } | null;
          const text = content?.text ?? '';
          if (text) append(el('div', 'user-msg', text));
        } else {
          const event = m.content as AgentEvent;
          if (event && typeof event === 'object' && typeof event.type === 'string') {
            processEvent(event);
          }
        }
      }
    } else {
      // Restored widget with no recorded transcript — typically a
      // pre-writes orphan or a conversation whose agent finished
      // before we tracked events. Whatever it was, the server has no
      // live run for it. Bail out of the default "Working..." state
      // so the user isn't stuck staring at a spinner.
      turnRunning = false;
      setHeaderRunning(false);
      setStopVisible(false);
      header.textContent = '(no transcript saved)';
      setFollowEnabled(true);
      setAgentState('done');
    }
  }

  /**
   * Render the lifecycle row from the current `worktreeState` +
   * `turnRunning`. Called from both the worktree_state listener and
   * after turn transitions (because Land/Discard are disabled while a
   * turn is running). Idempotent — safe to call repeatedly.
   */
  function branchSummary(): string {
    // Worktree branches are always named `pinagent/<feedbackId>` (see
    // `createWorktree` in agent-runner). Show the full branch in the label
    // so the dev can match it against `git branch` output.
    const branch = `pinagent/${feedbackId}`;
    if (worktreeChanges === null) return branch;
    const noun = worktreeChanges === 1 ? 'change' : 'changes';
    return `${branch} · ${worktreeChanges} ${noun}`;
  }

  function renderLifecycle(extra?: { commitSha?: string; message?: string }) {
    const { row, label, landBtn, discardBtn } = lifecycle;
    const cls = row.classList;
    cls.remove('landed', 'discarded', 'conflict', 'busy');

    if (worktreeState === 'none') {
      row.hidden = true;
      return;
    }
    row.hidden = false;

    const canAct = !turnRunning && !pendingAskId;
    switch (worktreeState) {
      case 'active':
        label.textContent = canAct ? branchSummary() : `Working on ${branchSummary()}`;
        landBtn.hidden = false;
        discardBtn.hidden = false;
        landBtn.disabled = !canAct;
        discardBtn.disabled = !canAct;
        landBtn.textContent = 'Land';
        discardBtn.textContent = 'Discard';
        if (extra?.message) label.textContent = `Last attempt: ${extra.message}`;
        break;
      case 'landing':
        cls.add('busy');
        label.textContent = 'Landing…';
        landBtn.hidden = false;
        discardBtn.hidden = true;
        landBtn.disabled = true;
        landBtn.textContent = 'Landing…';
        break;
      case 'landed':
        cls.add('landed');
        label.textContent = extra?.commitSha
          ? `Landed · ${extra.commitSha.slice(0, 12)}`
          : 'Landed';
        landBtn.hidden = true;
        discardBtn.hidden = true;
        break;
      case 'discarding':
        cls.add('busy');
        label.textContent = 'Discarding…';
        landBtn.hidden = true;
        discardBtn.hidden = false;
        discardBtn.disabled = true;
        discardBtn.textContent = 'Discarding…';
        break;
      case 'discarded':
        cls.add('discarded');
        label.textContent = 'Discarded';
        landBtn.hidden = true;
        discardBtn.hidden = true;
        break;
      case 'conflict':
        cls.add('conflict');
        label.textContent = 'Merge conflict — resolve in editor, then retry';
        landBtn.hidden = false;
        discardBtn.hidden = false;
        landBtn.disabled = !canAct;
        discardBtn.disabled = !canAct;
        landBtn.textContent = 'Retry land';
        discardBtn.textContent = 'Discard';
        break;
      case 'ttl_warning':
        label.textContent = `Old worktree · ${branchSummary()} — review or discard`;
        landBtn.hidden = false;
        discardBtn.hidden = false;
        landBtn.disabled = !canAct;
        discardBtn.disabled = !canAct;
        landBtn.textContent = 'Land';
        discardBtn.textContent = 'Discard';
        break;
    }
  }

  lifecycle.landBtn.addEventListener('click', () => {
    if (lifecycle.landBtn.disabled) return;
    client.sendLandRequest(feedbackId);
    // Optimistic — the server echoes 'landing' too, but reacting now
    // avoids a flash of "Ready to land or discard" between click and
    // the round-trip.
    worktreeState = 'landing';
    renderLifecycle();
  });

  lifecycle.discardBtn.addEventListener('click', () => {
    if (lifecycle.discardBtn.disabled) return;
    // One-click discard. The transcript stays in the cache so the
    // user can still read what the agent did even though the worktree
    // is gone. A confirm dialog felt heavier than the destructive
    // surface warrants — discard only throws away uncommitted edits,
    // and the user has the transcript to remember what was done.
    client.sendDiscardRequest(feedbackId);
    worktreeState = 'discarding';
    renderLifecycle();
  });

  function renderConflicts(files: string[]) {
    const wrap = el('div', 'conflict-block');
    wrap.appendChild(el('div', 'conflict-title', `Merge conflicts in ${files.length} file(s)`));
    for (const f of files) wrap.appendChild(el('div', 'conflict-file', f));
    append(wrap);
  }

  client.subscribe(feedbackId, {
    onEvent(event) {
      // Persist before rendering so a render error doesn't lose the
      // event from the cache. Best-effort — DB unreachable doesn't
      // break the live UI.
      const db = getBrowserDb();
      if (db) {
        void recordEvent(db, feedbackId, composer.turn, event).catch((err) =>
          // eslint-disable-next-line no-console
          console.warn('[pinagent:db] recordEvent failed:', err),
        );
      }
      processEvent(event);
    },
    onDone() {
      turnRunning = false;
      setHeaderRunning(false);
      setStopVisible(false);
      if (!pendingAskId) setFollowEnabled(true);
      renderLifecycle();
    },
    onWorktreeState(payload) {
      worktreeState = payload.state;
      if (typeof payload.changesCount === 'number') {
        worktreeChanges = payload.changesCount;
      }
      if (payload.state === 'conflict' && payload.conflicts && payload.conflicts.length > 0) {
        renderConflicts(payload.conflicts);
      }
      renderLifecycle({
        ...(payload.commitSha ? { commitSha: payload.commitSha } : {}),
        ...(payload.message ? { message: payload.message } : {}),
      });
    },
    onError(message) {
      append(el('div', 'err-line', message));
      // Server-side "no in-flight run to interrupt" — the agent
      // already ended (likely while we were offline, or before
      // restore). Reset the UI so the user can dismiss without the
      // Stop button staying stuck at "Stopping…".
      if (message.includes('no in-flight run')) {
        turnRunning = false;
        setHeaderRunning(false);
        setStopVisible(false);
        stopBtn.disabled = false;
        stopBtn.textContent = 'Stop';
        header.textContent = '(agent run not active)';
        setAgentState('done');
        if (!pendingAskId) setFollowEnabled(true);
      }
    },
  });
}

function composerHTML(meta: ComposerMeta): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${COMPOSER_STYLES}</style></head><body>
  <div class="card">
    ${renderHeader(meta, esc)}

    <div class="pane" id="pa-composer-pane">
      ${renderQuickActions(meta.chips, esc)}
      <textarea id="pa-ta" placeholder="Describe the change you want…"></textarea>
      <div class="row spread footer-row">
        <span class="kbd-hint"><kbd>⌘↵</kbd> submit · <kbd>esc</kbd> cancel</span>
        <div class="row" style="gap:8px;">
          <button class="btn ghost" id="pa-cancel" type="button">Cancel</button>
          <button class="btn primary" id="pa-submit" type="button" disabled>Submit</button>
        </div>
      </div>
    </div>

    <div class="pane" id="pa-stream-pane" hidden>
      <div class="header" id="pa-stream-header">Working…</div>
      <div class="lifecycle" id="pa-lifecycle" hidden>
        <span class="lifecycle-label" id="pa-lifecycle-label"></span>
        <div class="lifecycle-actions">
          <button class="btn lifecycle-btn primary" id="pa-land" type="button" hidden>Land</button>
          <button class="btn lifecycle-btn ghost" id="pa-discard" type="button" hidden>Discard</button>
        </div>
      </div>
      <div class="log" id="pa-stream-log"></div>
      <div class="follow">
        <textarea id="pa-follow-input" rows="2" placeholder="Working…" disabled></textarea>
        <button class="btn primary" id="pa-follow-send" type="button" disabled>Send</button>
      </div>
      <div class="row spread">
        <span class="footer-note" id="pa-stream-footer"></span>
        <div class="row" style="gap:6px;">
          <button class="btn ghost stop" id="pa-stop" type="button" hidden>Stop</button>
          <button class="btn ghost cancel" id="pa-dismiss" type="button">Minimize</button>
        </div>
      </div>
    </div>
  </div>
</body></html>`;
}

function renderHeader(meta: ComposerMeta, esc: (s: string) => string): string {
  // Identity row: the picked element's tag pill + (optionally) a
  // quoted label. The pill uses the "selected" ink-on-cream palette
  // so it visually matches the same tag in the breadcrumb below.
  const identity =
    `<div class="hdr-row hdr-identity">` +
    `<span class="el-pill">&lt;${esc(meta.tag)}&gt;</span>` +
    (meta.label ? `<span class="el-label">"${esc(meta.label)}"</span>` : '') +
    `</div>`;

  // File row: only rendered when data-pa-loc resolved. Hosts the
  // open-in-editor click target — see `wireComposerIframe` for the
  // POST handler. Keeps the same `#pa-meta` id so existing wiring
  // grabs the right node.
  const fileRow = meta.loc
    ? `<div class="hdr-row hdr-file" id="pa-meta">${ICON_CODE}<span class="hdr-file-text">${esc(`${meta.loc.file}:${meta.loc.line}:${meta.loc.col}`)}</span>${ICON_EXTERNAL}</div>`
    : `<div class="hdr-row hdr-file" id="pa-meta" hidden></div>`;

  // Breadcrumb: last item is the picked element and gets the
  // selected style. Items collapse with `>` separators between them.
  // Show at most the last 4 hops so a deep tree doesn't blow up the
  // header width.
  const crumbs = meta.breadcrumbs.slice(-4);
  const breadcrumb =
    `<div class="hdr-row hdr-bc">` +
    crumbs
      .map((tag, i) => {
        const isLast = i === crumbs.length - 1;
        const cls = isLast ? 'bc-item bc-selected' : 'bc-item';
        return (
          `<span class="${cls}">&lt;${esc(tag)}&gt;</span>` +
          (isLast ? '' : `<span class="bc-sep">›</span>`)
        );
      })
      .join('') +
    `</div>`;

  return `<div class="header-block">${identity}${fileRow}${breadcrumb}</div>`;
}

function renderQuickActions(chips: ReadonlyArray<QuickAction>, esc: (s: string) => string): string {
  return (
    `<div class="qa-chips">` +
    chips
      .map(
        (a) =>
          `<button class="qa-chip" type="button" data-prompt="${esc(a.prompt)}">${a.icon}<span>${esc(a.label)}</span></button>`,
      )
      .join('') +
    `</div>`
  );
}

function buildPinIcon(size: number, fill: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', BRAND_VIEWBOX);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PIN_PATH);
  path.setAttribute('fill', fill);
  svg.appendChild(path);
  return svg;
}

function resolveHotkey(): string | null {
  const w = window as unknown as { __pinagentHotkey?: string | false | null };
  if (w.__pinagentHotkey === false || w.__pinagentHotkey === null) return null;
  const k = w.__pinagentHotkey;
  if (typeof k === 'string' && k.length === 1) return k.toLowerCase();
  return 'c';
}

function shouldIgnoreHotkey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  const t = e.target as (Element & { isContentEditable?: boolean }) | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}

/**
 * Hotkey for "hop to next in-flight agent." Shift+N. Picked
 * deliberately: `n` alone is too easy to hit while typing, and the
 * obvious chord candidates (Cmd+N / Ctrl+N) are owned by the browser
 * for opening new windows.
 */
export function isHopKey(e: KeyboardEvent): boolean {
  return e.key === 'N' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/**
 * Pick the next composer to expand from a list of currently-active
 * (running or pending) composers, given the currently-expanded one.
 * Pure: no DOM, no side effects — the caller does the swap.
 *
 * Returns null in the no-op cases:
 *  - empty list (nothing to hop to)
 *  - single item AND it's already expanded
 *
 * Otherwise rotates insertion-order with wrap-around; the current is
 * 0-relative so the first hop from "nothing expanded" lands on
 * active[0].
 */
export function pickNextActive<T>(active: readonly T[], current: T | null): T | null {
  if (active.length === 0) return null;
  if (active.length === 1) return active[0] === current ? null : (active[0] ?? null);
  const idx = current ? active.indexOf(current) : -1;
  return active[(idx + 1) % active.length] ?? null;
}
