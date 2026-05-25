import { capturePageScreenshot } from './screenshot';
import { findLoc, shortSelector } from './selector';
import { STYLES } from './styles';

const ENDPOINT = '/__pinpoint/feedback';
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Top-level widget state. Tracks ONLY the picker — composers run
 * independently, each in their own iframe, so multiple can be open at
 * once (e.g. one agent fixing while you start another).
 */
interface State {
  mode: 'idle' | 'picking';
}

interface AgentEvent {
  type: 'init' | 'text' | 'tool_use' | 'tool_result' | 'ask_user' | 'error' | 'result';
  // Loose shape — discriminator handled at render time. Server-side type
  // in packages/next/src/event-bus.ts is authoritative.
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

const COMPOSER_H = 220;
const STREAM_H = 460;
const IFRAME_W = 360;

/**
 * Single WebSocket connection per page, multiplexed across however many
 * composer panes the user has open. Lazy-opens on the first subscribe
 * (so a page that never uses pinpoint pays no WS cost) and reconnects
 * with exponential backoff if the dev server drops.
 *
 * Routing: each `subscribe(feedbackId, handler)` registers a handler
 * keyed by feedback id; inbound `event` messages are dispatched to the
 * matching handler. The same `feedbackId` re-subscribes are idempotent
 * (used after reconnect so the server replays the bus buffer).
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
      // Queue while reconnecting. Drained on 'open'.
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
    } catch (err) {
      this.scheduleReconnect();
      return;
    }
    this.socket.addEventListener('open', () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      // Re-subscribe everything (the server's bus replay will catch us up).
      for (const id of this.handlers.keys()) {
        this.socket?.send(JSON.stringify({ type: 'subscribe', feedbackId: id }));
      }
      // Drain anything queued during reconnect.
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
      // Let 'close' drive reconnect; errors alone aren't actionable.
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
  // Resolved up front so per-iframe keydown listeners can share it with
  // the host-doc handler at the bottom of mount().
  const hotkeyChar = resolveHotkey();

  // Per-picker-session record of which composer iframes we suspended.
  // Restored verbatim on exitPicking so each composer keeps whatever
  // pointer-events value openComposer originally set.
  let suspendedIframes: Array<[HTMLIFrameElement, string]> = [];

  function enterPicking() {
    state.mode = 'picking';
    fab.classList.add('active');
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Click an element. Esc to cancel.';
    hint.dataset.pp = 'hint';
    root.appendChild(hint);

    // Suspend pointer-events on any open composer iframes. Without this,
    // clicks over an iframe are dispatched to the iframe's window and
    // never reach our document-level picker listener — so the user
    // couldn't pick anything underneath an open composer.
    suspendedIframes = [];
    for (const child of Array.from(root.children)) {
      if (child instanceof HTMLIFrameElement) {
        suspendedIframes.push([child, child.style.pointerEvents]);
        child.style.pointerEvents = 'none';
      }
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKey, true);
  }

  function exitPicking() {
    state.mode = 'idle';
    fab.classList.remove('active');
    outline.style.display = 'none';
    const hint = root.querySelector('[data-pp="hint"]');
    if (hint) hint.remove();
    for (const [iframe, prev] of suspendedIframes) {
      iframe.style.pointerEvents = prev;
    }
    suspendedIframes = [];
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
    e.preventDefault();
    e.stopPropagation();
    exitPicking();
    openComposer(target);
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
    // pointer-events:none on the host alone isn't enough — shadow-root
    // children (FAB, hint, open composer iframes) have their own
    // pointer-events:auto and would be returned by elementFromPoint
    // instead of the underlying page element. Walk + neutralize each
    // overlay for the duration of the hit-test, then restore.
    const prevHost = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    const restore: Array<[HTMLElement, string]> = [];
    for (const child of Array.from(root.children)) {
      if (child instanceof HTMLElement) {
        restore.push([child, child.style.pointerEvents]);
        child.style.pointerEvents = 'none';
      }
    }
    const target = document.elementFromPoint(e.clientX, e.clientY);
    for (const [el, prev] of restore) el.style.pointerEvents = prev;
    host.style.pointerEvents = prevHost;
    if (!target) return null;
    if (target === host) return null;
    return target;
  }

  function openComposer(target: Element) {
    // Composers are independent — no global mode change. Closing this
    // one doesn't affect any other open composer, and you can open more
    // at any time via the FAB / hotkey.
    const loc = findLoc(target);
    const selector = shortSelector(target);
    const metaText = loc ? `${loc.file}:${loc.line}:${loc.col}` : selector;

    // We render the composer inside an iframe — not just shadow DOM — so the
    // host page's focus traps (Radix Dialog, react-focus-lock, etc.) cannot
    // reach into it. An iframe has its own Document and focus context.
    const iframe = document.createElement('iframe');
    iframe.title = 'Pinpoint feedback';
    iframe.style.position = 'fixed';
    iframe.style.border = '0';
    iframe.style.background = 'transparent';
    iframe.style.pointerEvents = 'auto';
    iframe.style.zIndex = '2147483646';
    iframe.style.colorScheme = 'light';
    iframe.style.inset = 'auto';
    iframe.style.margin = '0';
    iframe.style.padding = '0';
    iframe.style.transition = 'height 160ms ease, top 160ms ease';
    if ('popover' in HTMLElement.prototype) {
      iframe.setAttribute('popover', 'manual');
    }

    positionIframe(iframe, target, COMPOSER_H);
    iframe.srcdoc = composerHTML(metaText);

    root.appendChild(iframe);
    if ('showPopover' in iframe && iframe.getAttribute('popover')) {
      try {
        (iframe as HTMLIFrameElement & { showPopover(): void }).showPopover();
      } catch {
        // Older browsers — iframe renders normally, just not in top layer.
      }
    }

    let feedbackId: string | null = null;

    function close() {
      if (feedbackId) wsClient.unsubscribe(feedbackId);
      iframe.remove();
      // Don't touch picker state or the outline — they belong to the
      // picker lifecycle, not this composer's. Another composer may
      // still be open and rely on neither being reset.
    }

    iframe.addEventListener('load', () => {
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

      if (loc) {
        metaEl.classList.add('clickable');
        metaEl.title = 'Open in editor';
        metaEl.addEventListener('click', async () => {
          metaEl.classList.add('loading');
          try {
            const qs = new URLSearchParams({
              file: loc.file,
              line: String(loc.line),
              col: String(loc.col),
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

      setTimeout(() => ta.focus(), 0);

      ta.addEventListener('input', () => {
        submit.disabled = ta.value.trim().length === 0;
      });

      iwin.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
          return;
        }
        // Mirror the host-doc hotkey so the user can open a new picker
        // without first defocusing this iframe. shouldIgnoreHotkey skips
        // when the user is typing in an input/textarea inside the iframe.
        if (
          hotkeyChar &&
          e.key.toLowerCase() === hotkeyChar &&
          !shouldIgnoreHotkey(e)
        ) {
          e.preventDefault();
          if (state.mode === 'picking') exitPicking();
          else enterPicking();
        }
      });

      cancel.addEventListener('click', () => close());
      // Dismiss is wired inside attachStreamHandler so it can send an
      // interrupt first when a turn is still running. Before stream pane
      // opens, dismiss is hidden behind the composer pane anyway.

      submit.addEventListener('click', async () => {
        submit.disabled = true;
        submit.textContent = 'Sending…';
        try {
          const screenshot = await capturePageScreenshot(
            (node) => node !== host && node !== (iframe as unknown as HTMLElement),
          );
          const payload = {
            comment: ta.value.trim(),
            loc,
            selector,
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
            feedbackId = result.id;
            composerPane.hidden = true;
            streamPane.hidden = false;
            streamHeader.textContent = '✓ Submitted — agent starting…';
            streamFooter.textContent = '';
            growIframe(iframe, target, STREAM_H);
            attachStreamHandler(
              wsClient,
              idoc,
              feedbackId,
              streamHeader,
              streamLog,
              streamFooter,
              dismissBtn,
              stopBtn,
              followInput,
              followSend,
              close,
            );
          } else {
            toast('Sent', 'success');
            close();
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast(`Error: ${msg}`, 'error');
          submit.disabled = false;
          submit.textContent = 'Submit';
        }
      });
    });
  }

  function positionIframe(iframe: HTMLIFrameElement, target: Element, height: number) {
    const r = target.getBoundingClientRect();
    const top = Math.min(window.innerHeight - height - 8, Math.max(8, r.bottom + 8));
    const left = Math.min(window.innerWidth - IFRAME_W - 8, Math.max(8, r.left));
    iframe.style.top = `${top}px`;
    iframe.style.left = `${left}px`;
    iframe.style.width = `${IFRAME_W}px`;
    iframe.style.height = `${height}px`;
  }

  function growIframe(iframe: HTMLIFrameElement, target: Element, height: number) {
    positionIframe(iframe, target, height);
  }

  function toast(text: string, kind: 'success' | 'error') {
    const el = document.createElement('div');
    el.className = `toast${kind === 'error' ? ' error' : ''}`;
    el.textContent = text;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  fab.addEventListener('click', () => {
    if (state.mode === 'picking') exitPicking();
    else if (state.mode === 'idle') enterPicking();
  });

  if (hotkeyChar) {
    fab.title = `Pinpoint — press ${hotkeyChar.toUpperCase()} or click to pick`;
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
}

function createWsClient(): WidgetWsClient {
  const cfg = (window as unknown as { __pinpointConfig?: { wsUrl?: string | null } })
    .__pinpointConfig;
  const url =
    cfg?.wsUrl ??
    // Best-effort fallback: standard port on the same host. Useful if a
    // consumer serves the widget themselves without the config prelude.
    `ws://${window.location.hostname || '127.0.0.1'}:53636/__pinpoint/ws`;
  return new WidgetWsClient(url);
}

/**
 * Wire a freshly-opened stream pane to the WS client. Owns all the
 * rendering for one feedback id's transcript and one ask_user form at a
 * time (the agent can only ask one question at once — the SDK doesn't
 * allow concurrent tool calls within a turn).
 */
function attachStreamHandler(
  client: WidgetWsClient,
  idoc: Document,
  feedbackId: string,
  header: HTMLElement,
  log: HTMLElement,
  footer: HTMLElement,
  dismissBtn: HTMLButtonElement,
  stopBtn: HTMLButtonElement,
  followInput: HTMLTextAreaElement,
  followSend: HTMLButtonElement,
  close: () => void,
): void {
  let activeTextBlock: HTMLElement | null = null;
  let lastToolChip: HTMLElement | null = null;
  let pendingAskId: string | null = null;
  let pendingAskFormRoot: HTMLElement | null = null;
  let apiKeySource: string | null = null;
  let turnRunning = true;

  // Visible only while a turn is in flight; hidden on done/result/error.
  function setStopVisible(visible: boolean) {
    stopBtn.hidden = !visible;
  }
  setStopVisible(true);

  stopBtn.addEventListener('click', () => {
    if (!turnRunning) return;
    client.sendInterrupt(feedbackId);
    stopBtn.disabled = true;
    stopBtn.textContent = 'Stopping…';
    // Server emits an error event + a result message (subtype likely
    // 'error_during_execution'). turnRunning + UI clear up on those.
  });

  dismissBtn.addEventListener('click', () => {
    // If the user dismisses mid-turn (or mid-ask), abort the agent so it
    // doesn't keep running with no UI to receive its events — and so any
    // pending ask_user doesn't hang until TTL waiting for an answer that
    // will never come.
    if (turnRunning || pendingAskId) {
      client.sendInterrupt(feedbackId);
    }
    close();
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
    // Clear any prior ask form (defensive — shouldn't happen in normal SDK flow).
    if (pendingAskFormRoot) pendingAskFormRoot.remove();
    pendingAskId = askId;

    const wrap = el('div', 'ask-form');
    const q = el('div', 'ask-question', question);
    wrap.appendChild(q);

    if (options && options.length > 0) {
      const opts = el('div', 'ask-options');
      for (const o of options) {
        const btn = el('button', 'ask-option') as HTMLButtonElement;
        btn.type = 'button';
        btn.textContent = o;
        btn.addEventListener('click', () => submit(o));
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
      submit(answer);
    });
    row.appendChild(ta);
    row.appendChild(sendBtn);
    wrap.appendChild(row);

    pendingAskFormRoot = wrap;
    append(wrap);
    setTimeout(() => ta.focus(), 0);
    setFollowEnabled(false);

    function submit(answer: string) {
      client.sendAskResponse(askId, answer);
      // Replace the form with a static record of the exchange so the
      // transcript stays coherent on scrollback.
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
    client.sendUserMessage(feedbackId, content);
    // Optimistic render so the user sees their message immediately.
    append(el('div', 'user-msg', content));
    followInput.value = '';
    turnRunning = true;
    stopBtn.disabled = false;
    stopBtn.textContent = 'Stop';
    setStopVisible(true);
    setFollowEnabled(false);
    header.textContent = 'Working…';
    footer.textContent = '';
  });
  setFollowEnabled(false);

  client.subscribe(feedbackId, {
    onEvent(event) {
      switch (event.type) {
        case 'init': {
          const session = String(event.sessionId ?? '').slice(0, 8);
          const model = String(event.model ?? 'claude');
          apiKeySource = typeof event.apiKeySource === 'string' ? event.apiKeySource : null;
          header.textContent = `Working · ${model}${session ? ` · ${session}` : ''}`;
          turnRunning = true;
          stopBtn.disabled = false;
          stopBtn.textContent = 'Stop';
          setStopVisible(true);
          setFollowEnabled(false);
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
          setStopVisible(false);
          // Once the initial turn ends, enable follow-up unless an ask is
          // still pending (shouldn't happen — ask resolution precedes
          // result — but defensive).
          if (!pendingAskId) setFollowEnabled(true);
          break;
        }
      }
    },
    onDone() {
      // The server only sends `done` if the bus is explicitly closed.
      // With per-conversation buses, this fires only on dev-server
      // shutdown or programmatic eviction. Treat as best-effort cleanup.
      turnRunning = false;
      setStopVisible(false);
      if (!pendingAskId) setFollowEnabled(true);
    },
    onError(message) {
      append(el('div', 'err-line', message));
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
  .btn.ghost.stop { color: #b91c1c; }
  .btn.ghost.stop:hover { background: #fef2f2; }

  /* Streaming pane */
  .header {
    font-size: 12px;
    font-weight: 500;
    color: #111827;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }
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

  /* ask_user inline form */
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

  /* Follow-up input row */
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
          <button class="btn ghost" id="pp-dismiss" type="button">Close</button>
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
