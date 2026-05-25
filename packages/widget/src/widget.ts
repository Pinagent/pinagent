import { flushBrowserDb, getBrowserDb, initBrowserDb } from './db/client';
import {
  type PendingRow,
  getConversationMessages,
  listPendingForCurrentPage,
} from './db/reads';
import {
  deleteConversation,
  markConversationResolved,
  recordConversationStart,
  recordEvent,
  recordUserMessage,
} from './db/writes';
import { capturePageScreenshot } from './screenshot';
import { findLoc, shortSelector } from './selector';
import { STYLES } from './styles';

const ENDPOINT = '/__pinpoint/feedback';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

const COMPOSER_H = 220;
const STREAM_H = 340;
const IFRAME_W = 360;
const BUBBLE_SIZE = 36;

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

interface ServerMessage {
  type: 'event' | 'done' | 'error' | 'pong';
  feedbackId?: string;
  event?: AgentEvent;
  message?: string;
}

interface FeedbackHandler {
  onEvent(event: AgentEvent): void;
  onDone(): void;
  onError(message: string): void;
}

type AgentState = 'pending' | 'running' | 'done' | 'error';

interface Composer {
  feedbackId: string | null;
  target: Element;
  iframe: HTMLIFrameElement;
  bubble: HTMLElement;
  dragHandle: HTMLElement;
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
:root.pp-picking, :root.pp-picking * { cursor: crosshair !important; }

.pp-iframe {
  position: absolute;
  border: 0;
  background: transparent;
  z-index: 2147483646;
  color-scheme: light;
  /* iframe is positioned relative to documentElement origin — set via JS */
}
.pp-iframe[hidden] { display: none; }

.pp-bubble {
  position: absolute;
  width: ${BUBBLE_SIZE}px;
  height: ${BUBBLE_SIZE}px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #cbd5e1;
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
  cursor: pointer;
  z-index: 2147483645;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #4338ca;
  transition: transform 120ms ease, box-shadow 120ms ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
}
.pp-bubble:hover { transform: scale(1.08); box-shadow: 0 6px 16px rgba(0,0,0,0.24); }
.pp-bubble[hidden] { display: none; }

.pp-bubble.running { border-color: #2563eb; color: #2563eb; }
.pp-bubble.running::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 2px solid #2563eb;
  opacity: 0.5;
  animation: pp-bubble-pulse 1.6s ease-out infinite;
  pointer-events: none;
}
@keyframes pp-bubble-pulse {
  0%   { transform: scale(1);    opacity: 0.55; }
  100% { transform: scale(1.55); opacity: 0; }
}
.pp-bubble.done  { border-color: #10b981; color: #10b981; background: #ecfdf5; }
.pp-bubble.error { border-color: #ef4444; color: #ef4444; background: #fef2f2; }
.pp-bubble.pending { border-color: #94a3b8; color: #94a3b8; }

.pp-bubble-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: pp-bubble-spin 0.9s linear infinite;
}
@keyframes pp-bubble-spin { to { transform: rotate(360deg); } }

.pp-drag-handle {
  position: absolute;
  width: 28px;
  height: 24px;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  z-index: 2147483646;
  box-shadow: 0 2px 6px rgba(0,0,0,0.10);
  user-select: none;
  color: #6b7280;
  font-size: 16px;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  transition: background 100ms ease, color 100ms ease;
}
.pp-drag-handle:hover { background: #f3f4f6; color: #111827; }
.pp-drag-handle.dragging { cursor: grabbing; background: #e0e7ff; color: #1e3a8a; }
.pp-drag-handle[hidden] { display: none; }

.pp-pointer {
  position: absolute;
  width: 18px;
  height: 10px;
  pointer-events: none;
  z-index: 2147483646;
  overflow: visible;
}
.pp-pointer[hidden] { display: none; }
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
      console.log('[pinpoint:db] browser cache ready');
      try {
        const pending = await listPendingForCurrentPage(db, window.location.href);
        for (const row of pending) {
          restorePending(row);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pinpoint:db] restore scan failed:', err);
      }
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[pinpoint:db] init failed (cache disabled):', err);
    });

  // Document-level <style> tag for elements that live in document.body
  // (composer iframes, bubbles, picker cursor). The shadow root holds
  // only the FAB / hint / outline — anything that needs to scroll with
  // the page goes in the main document.
  if (!document.getElementById('pinpoint-doc-styles')) {
    const docStyle = document.createElement('style');
    docStyle.id = 'pinpoint-doc-styles';
    docStyle.textContent = DOC_STYLES;
    document.head.appendChild(docStyle);
  }

  const host = document.createElement('div');
  host.id = 'pinpoint-root';
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
  fab.textContent = '💬';
  fab.title = 'Pinpoint — pick an element';
  fab.style.pointerEvents = 'auto';
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
    document.documentElement.classList.add('pp-picking');

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
    document.documentElement.classList.remove('pp-picking');
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
    if (target.classList.contains('pp-bubble')) {
      e.preventDefault();
      e.stopPropagation();
      exitPicking();
      const owner = bubbleOwner(target as HTMLElement);
      if (owner) swapTo(owner);
      return;
    }
    // Don't pick the drag handle either — silently cancel picker so the
    // user can grab the handle they were aiming for.
    if (target.classList.contains('pp-drag-handle')) {
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
    const prevExpanded =
      expandedComposer && expandedComposer.expanded
        ? expandedComposer.iframe.style.pointerEvents
        : null;
    if (expandedComposer && expandedComposer.expanded) {
      expandedComposer.iframe.style.pointerEvents = 'none';
    }

    const target = document.elementFromPoint(e.clientX, e.clientY);

    host.style.pointerEvents = prevHost;
    if (expandedComposer && expandedComposer.expanded && prevExpanded !== null) {
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
      console.log(`[pinpoint] anchor lost for ${row.conversation.id} (selector: ${sel})`);
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

  function createComposer(target: Element, click: { x: number; y: number }): Composer {
    const loc = findLoc(target);
    const selector = shortSelector(target);
    const metaText = loc ? `${loc.file}:${loc.line}:${loc.col}` : selector;

    // Iframe lives in document.body (not the shadow root) so it scrolls
    // naturally with the page via absolute positioning in page coords.
    const iframe = document.createElement('iframe');
    iframe.className = 'pp-iframe';
    iframe.title = 'Pinpoint feedback';
    iframe.style.pointerEvents = 'auto';
    iframe.srcdoc = composerHTML(metaText);
    iframe.style.width = `${IFRAME_W}px`;
    iframe.style.height = `${COMPOSER_H}px`;
    document.body.appendChild(iframe);

    const bubble = document.createElement('div');
    bubble.className = 'pp-bubble pending';
    bubble.title = 'Pinpoint — click to expand';
    bubble.hidden = true;
    bubble.innerHTML = '<div class="pp-bubble-spinner"></div>';
    document.body.appendChild(bubble);

    // Drag grip — small visible handle in the top-right corner of the
    // iframe. Lives in document.body (not inside the iframe) so we can
    // track mousemove/mouseup on the parent document during a drag,
    // which we couldn't do from inside the iframe.
    const dragHandle = document.createElement('div');
    dragHandle.className = 'pp-drag-handle';
    dragHandle.title = 'Drag to reposition';
    dragHandle.textContent = '⋮⋮';
    document.body.appendChild(dragHandle);

    // Pointer tail — a small SVG triangle that sits on whichever edge
    // of the widget faces the target, so the widget visually anchors
    // back to the picked element. The path is two strokes only (the
    // two slanted edges) so the flat edge sits flush with the widget
    // border without doubling it.
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const pointer = document.createElementNS(SVG_NS, 'svg');
    pointer.setAttribute('class', 'pp-pointer');
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
      else bubble.innerHTML = '<div class="pp-bubble-spinner"></div>';
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
    function positionLoop() {
      reposition();
      rafHandle = requestAnimationFrame(positionLoop);
    }
    function reposition() {
      const r = target.getBoundingClientRect();
      // Anchor = where the user clicked, expressed in document coords.
      // Moves with the target as it scrolls/layout-shifts.
      const anchorDocX = r.left + window.scrollX + relX;
      const anchorDocY = r.top + window.scrollY + relY;
      // Anchor in viewport coords (used to decide above/below placement).
      const anchorViewportY = r.top + relY;

      const composerH = composer.feedbackId ? STREAM_H : COMPOSER_H;
      const spaceBelow = window.innerHeight - anchorViewportY;
      const placeBelow = spaceBelow >= composerH + 16 || anchorViewportY < composerH + 16;
      const baseTop = placeBelow ? anchorDocY + 12 : anchorDocY - composerH - 12;
      const baseLeft = anchorDocX;
      const iframeTop = Math.max(8, baseTop + composer.userOffsetY);
      const iframeLeft = Math.max(
        window.scrollX + 8,
        Math.min(window.scrollX + window.innerWidth - IFRAME_W - 8, baseLeft + composer.userOffsetX),
      );
      iframe.style.top = `${iframeTop}px`;
      iframe.style.left = `${iframeLeft}px`;

      // Bubble: top-left of the iframe (loading-state indicator that
      // shows where the widget is/was).
      bubble.style.top = `${iframeTop - BUBBLE_SIZE / 2}px`;
      bubble.style.left = `${iframeLeft - BUBBLE_SIZE / 2}px`;

      // Drag handle: top-right of the iframe (only visible when expanded).
      const handleW = 28;
      dragHandle.style.top = `${iframeTop - 12}px`;
      dragHandle.style.left = `${iframeLeft + IFRAME_W - handleW + 12}px`;
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
        pointerPath.setAttribute('d', `M 0.5 ${POINTER_H} L 9 0.5 L ${POINTER_W - 0.5} ${POINTER_H}`);
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
        iframe.remove();
        bubble.remove();
        dragHandle.remove();
        pointer.remove();
        composers.delete(composer);
        if (expandedComposer === composer) expandedComposer = null;
      },
      expand() {
        composer.expanded = true;
        iframe.style.height = `${composer.feedbackId ? STREAM_H : COMPOSER_H}px`;
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
      swapTo(composer);
    });

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

      const ta = idoc.getElementById('pp-ta') as HTMLTextAreaElement | null;
      const cancel = idoc.getElementById('pp-cancel') as HTMLButtonElement | null;
      const submit = idoc.getElementById('pp-submit') as HTMLButtonElement | null;
      const metaEl = idoc.getElementById('pp-meta') as HTMLElement | null;
      const composerPane = idoc.getElementById('pp-composer-pane');
      const streamPane = idoc.getElementById('pp-stream-pane');
      const streamHeader = idoc.getElementById('pp-stream-header');
      const streamLog = idoc.getElementById('pp-stream-log');
      const streamFooter = idoc.getElementById('pp-stream-footer');
      const dismissBtn = idoc.getElementById('pp-dismiss') as HTMLButtonElement | null;
      const stopBtn = idoc.getElementById('pp-stop') as HTMLButtonElement | null;
      const followInput = idoc.getElementById('pp-follow-input') as HTMLTextAreaElement | null;
      const followSend = idoc.getElementById('pp-follow-send') as HTMLButtonElement | null;
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
        !followSend
      ) {
        return;
      }

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
            const res = await fetch(`/__pinpoint/open?${qs.toString()}`, { method: 'POST' });
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
        if (
          hotkeyChar &&
          e.key.toLowerCase() === hotkeyChar &&
          !shouldIgnoreHotkey(e)
        ) {
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
                `[pinpoint:db] replay ${c.feedbackId}: ${msgs.length} messages`,
                msgs.length > 0 ? { first: msgs[0], last: msgs[msgs.length - 1] } : null,
              );
              replayed = msgs.map((m) => ({
                turn: m.turn,
                role: m.role,
                content: m.content,
              }));
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[pinpoint:db] replay fetch failed:', err);
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
            replayed,
          );
        })();
        return;
      }

      // Fresh composer: wire the composer-pane (textarea + submit/cancel).
      setTimeout(() => ta.focus(), 0);

      ta.addEventListener('input', () => {
        submit.disabled = ta.value.trim().length === 0;
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          if (!submit.disabled) submit.click();
        }
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
          const result = (await res.json().catch(() => null)) as
            | { id: string; agentSpawned?: boolean }
            | null;

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
                console.warn('[pinpoint:db] recordConversationStart failed:', err),
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
    fab.title = `Pinpoint — press ${hotkeyChar.toUpperCase()} or click to pick · Shift+N to hop between active widgets`;
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
  const cfg = (window as unknown as { __pinpointConfig?: { wsUrl?: string | null } })
    .__pinpointConfig;
  const url =
    cfg?.wsUrl ??
    `ws://${window.location.hostname || '127.0.0.1'}:53636/__pinpoint/ws`;
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
        console.warn('[pinpoint:db] recordUserMessage failed:', err),
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
              const resolvedAt =
                typeof resolvedRaw === 'string' ? new Date(resolvedRaw) : null;
              void markConversationResolved(db, feedbackId, status, resolvedAt).catch(
                () => {},
              );
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
            void markConversationResolved(db, feedbackId, ok ? 'fixed' : 'wontfix').catch(
              () => {},
            );
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

  client.subscribe(feedbackId, {
    onEvent(event) {
      // Persist before rendering so a render error doesn't lose the
      // event from the cache. Best-effort — DB unreachable doesn't
      // break the live UI.
      const db = getBrowserDb();
      if (db) {
        void recordEvent(db, feedbackId, composer.turn, event).catch((err) =>
          // eslint-disable-next-line no-console
          console.warn('[pinpoint:db] recordEvent failed:', err),
        );
      }
      processEvent(event);
    },
    onDone() {
      turnRunning = false;
      setHeaderRunning(false);
      setStopVisible(false);
      if (!pendingAskId) setFollowEnabled(true);
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

function composerHTML(metaText: string): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; height: 100%; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }
  body { color: #111827; }
  .card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    height: calc(100% - 2px);
  }
  .pane { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
  .pane[hidden] { display: none; }
  .meta {
    font-size: 11px;
    color: #6b7280;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
    padding: 2px 4px;
    margin: -2px -4px;
    border-radius: 4px;
    transition: background 100ms ease, color 100ms ease;
    user-select: none;
  }
  .meta.clickable { cursor: pointer; }
  .meta.clickable:hover { background: #f3f4f6; color: #111827; }
  .meta.loading { opacity: 0.5; }
  .meta.ok { background: #d1fae5; color: #065f46; }
  .meta.err { background: #fee2e2; color: #991b1b; }
  textarea {
    width: 100%;
    resize: none;
    padding: 8px;
    font-size: 13px;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    outline: none;
    font-family: inherit;
    background: #fff;
    color: #111827;
  }
  textarea::placeholder { color: #9ca3af; }
  textarea:focus { border-color: #2563eb; }
  textarea:disabled { background: #f9fafb; color: #6b7280; }
  #pp-ta { flex: 1; min-height: 80px; }
  .row { display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
  .row.spread { justify-content: space-between; }
  .btn { border: 0; padding: 6px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; font-family: inherit; }
  .btn.primary { background: #2563eb; color: #fff; }
  .btn.primary:disabled { background: #93c5fd; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: #374151; }
  .btn.ghost.stop,
  .btn.ghost.cancel { color: #b91c1c; }
  .btn.ghost.stop:hover,
  .btn.ghost.cancel:hover { background: #fef2f2; }

  .header {
    font-size: 12px;
    font-weight: 500;
    color: #111827;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
  /* Spinner shown while a turn is in flight. The pseudo-element
     survives textContent updates so we don't have to re-insert
     the spinner each time the header copy changes. */
  .header.running::before {
    content: '';
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid #2563eb;
    border-top-color: transparent;
    border-radius: 50%;
    flex-shrink: 0;
    animation: pp-header-spin 0.9s linear infinite;
  }
  @keyframes pp-header-spin { to { transform: rotate(360deg); } }
  .log {
    flex: 1;
    overflow-y: auto;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 8px;
    font-size: 12px;
    line-height: 1.45;
    background: #fafafa;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .msg { white-space: pre-wrap; word-break: break-word; color: #111827; }
  .user-msg {
    white-space: pre-wrap;
    word-break: break-word;
    color: #111827;
    background: #eef2ff;
    border-left: 3px solid #2563eb;
    padding: 4px 8px;
    border-radius: 0 4px 4px 0;
    align-self: flex-start;
    max-width: 100%;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    background: #eef2ff;
    color: #1e3a8a;
    border-radius: 4px;
    padding: 3px 6px;
    align-self: flex-start;
    max-width: 100%;
  }
  .chip.err { background: #fee2e2; color: #991b1b; }
  .chip-name { font-weight: 600; }
  .chip-summary {
    color: #4338ca;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-status { margin-left: auto; opacity: 0.6; }
  .chip-status.ok { color: #047857; opacity: 1; }
  .chip-status.err { color: #b91c1c; opacity: 1; }
  .err-line { color: #b91c1c; font-size: 12px; white-space: pre-wrap; }
  .footer-note { font-size: 11px; color: #6b7280; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  .ask-form {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ask-question { font-weight: 600; color: #92400e; font-size: 12px; white-space: pre-wrap; }
  .ask-options { display: flex; flex-wrap: wrap; gap: 4px; }
  .ask-option {
    background: #fff;
    border: 1px solid #fcd34d;
    color: #92400e;
    padding: 3px 8px;
    font-size: 11px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
  }
  .ask-option:hover { background: #fef3c7; }
  .ask-row { display: flex; gap: 4px; align-items: stretch; }
  .ask-input { font-size: 12px; min-height: 0; }
  .ask-resolved {
    background: #f3f4f6;
    border-left: 3px solid #9ca3af;
    padding: 4px 8px;
    border-radius: 0 4px 4px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ask-resolved .ask-question { color: #6b7280; font-size: 11px; font-weight: 500; }
  .ask-answer { color: #111827; font-size: 12px; white-space: pre-wrap; }

  .follow {
    display: flex;
    gap: 6px;
    align-items: stretch;
    border-top: 1px solid #f3f4f6;
    padding-top: 8px;
  }
  #pp-follow-input { font-size: 12px; min-height: 0; }
  #pp-follow-send { white-space: nowrap; }
</style></head><body>
  <div class="card">
    <div class="meta" id="pp-meta">${esc(metaText)}</div>

    <div class="pane" id="pp-composer-pane">
      <textarea id="pp-ta" placeholder="Describe the change you want…"></textarea>
      <div class="row">
        <button class="btn ghost" id="pp-cancel" type="button">Cancel</button>
        <button class="btn primary" id="pp-submit" type="button" disabled>Submit</button>
      </div>
    </div>

    <div class="pane" id="pp-stream-pane" hidden>
      <div class="header" id="pp-stream-header">Working…</div>
      <div class="log" id="pp-stream-log"></div>
      <div class="follow">
        <textarea id="pp-follow-input" rows="2" placeholder="Working…" disabled></textarea>
        <button class="btn primary" id="pp-follow-send" type="button" disabled>Send</button>
      </div>
      <div class="row spread">
        <span class="footer-note" id="pp-stream-footer"></span>
        <div class="row" style="gap:6px;">
          <button class="btn ghost stop" id="pp-stop" type="button" hidden>Stop</button>
          <button class="btn ghost cancel" id="pp-dismiss" type="button">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</body></html>`;
}

function resolveHotkey(): string | null {
  const w = window as unknown as { __pinpointHotkey?: string | false | null };
  if (w.__pinpointHotkey === false || w.__pinpointHotkey === null) return null;
  const k = w.__pinpointHotkey;
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
