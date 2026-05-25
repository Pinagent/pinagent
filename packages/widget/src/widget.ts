import { capturePageScreenshot } from './screenshot';
import { findLoc, shortSelector } from './selector';
import { STYLES } from './styles';

const ENDPOINT = '/__pinpoint/feedback';

interface State {
  mode: 'idle' | 'picking' | 'composing';
  selected: Element | null;
}

interface AgentEvent {
  type: 'init' | 'text' | 'tool_use' | 'tool_result' | 'error' | 'result';
  // Loose shape — discriminator handled at render time. The server-side type
  // is authoritative; see packages/next/src/event-bus.ts.
  [k: string]: unknown;
}

const COMPOSER_H = 220;
const STREAM_H = 420;
const IFRAME_W = 344;

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

  const state: State = { mode: 'idle', selected: null };

  function enterPicking() {
    state.mode = 'picking';
    fab.classList.add('active');
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Click an element. Esc to cancel.';
    hint.dataset.pp = 'hint';
    root.appendChild(hint);

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
    state.selected = target;
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
    // Skip our own shadow host when computing hits.
    const prev = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY);
    host.style.pointerEvents = prev;
    if (!target) return null;
    if (target === host) return null;
    return target;
  }

  function openComposer(target: Element) {
    state.mode = 'composing';
    const loc = findLoc(target);
    const selector = shortSelector(target);
    const metaText = loc ? `${loc.file}:${loc.line}:${loc.col}` : selector;

    // We render the composer inside an iframe — not just shadow DOM — so the
    // host page's focus traps (Radix Dialog, react-focus-lock, etc.) cannot
    // reach into it. An iframe has its own Document and focus context;
    // parent-document JS literally cannot redirect focus inside it.
    const iframe = document.createElement('iframe');
    iframe.title = 'Pinpoint feedback';
    iframe.style.position = 'fixed';
    iframe.style.border = '0';
    iframe.style.background = 'transparent';
    iframe.style.pointerEvents = 'auto';
    iframe.style.zIndex = '2147483646';
    iframe.style.colorScheme = 'light';
    // Override UA popover defaults — without these, `[popover]` UA styles
    // (inset: 0; margin: auto) would center the iframe in the viewport
    // regardless of our top/left.
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

    let eventSource: EventSource | null = null;

    function close() {
      eventSource?.close();
      iframe.remove();
      state.mode = 'idle';
      state.selected = null;
      outline.style.display = 'none';
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
        !dismissBtn
      ) {
        return;
      }

      // Click the file:line:col to open it in the developer's editor via
      // the server-side /__pinpoint/open endpoint. Only enabled when we
      // have a real source location (not just a CSS selector fallback).
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

      // Focus is now inside the iframe's document — out of reach of any
      // parent-page focus trap.
      setTimeout(() => ta.focus(), 0);

      ta.addEventListener('input', () => {
        submit.disabled = ta.value.trim().length === 0;
      });

      iwin.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      });

      cancel.addEventListener('click', () => close());
      dismissBtn.addEventListener('click', () => close());

      submit.addEventListener('click', async () => {
        submit.disabled = true;
        submit.textContent = 'Sending…';
        try {
          // Screenshot is captured from the PARENT document — that's where
          // the page content lives. Filter excludes our shadow host AND the
          // iframe itself so neither appears in the capture.
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
            // Switch to the streaming pane and open the SSE feed.
            composerPane.hidden = true;
            streamPane.hidden = false;
            streamHeader.textContent = '✓ Submitted — agent starting…';
            streamFooter.textContent = '';
            growIframe(iframe, target, STREAM_H);
            eventSource = openStream(
              result.id,
              streamHeader,
              streamLog,
              streamFooter,
              dismissBtn,
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

  function openStream(
    id: string,
    header: HTMLElement,
    log: HTMLElement,
    footer: HTMLElement,
    dismissBtn: HTMLButtonElement,
  ): EventSource {
    const idoc = log.ownerDocument;
    const es = new EventSource(`/__pinpoint/feedback/${id}/stream`);
    let lastToolChip: HTMLElement | null = null;
    let activeTextBlock: HTMLElement | null = null;
    // 'oauth' means subscription auth — `total_cost_usd` from the SDK is the
    // API-equivalent price of the tokens, not what the developer pays. We
    // suppress it to avoid making subscription users think they were billed.
    let apiKeySource: string | null = null;

    function appendLine(node: HTMLElement) {
      log.appendChild(node);
      // Auto-scroll to the latest line.
      log.scrollTop = log.scrollHeight;
    }

    function el(tag: string, className?: string, text?: string): HTMLElement {
      const node = idoc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    }

    es.onmessage = (msg) => {
      let event: AgentEvent;
      try {
        event = JSON.parse(msg.data);
      } catch {
        return;
      }
      switch (event.type) {
        case 'init': {
          const session = String(event.sessionId ?? '').slice(0, 8);
          const model = String(event.model ?? 'claude');
          apiKeySource = typeof event.apiKeySource === 'string' ? event.apiKeySource : null;
          header.textContent = `Working · ${model}${session ? ` · ${session}` : ''}`;
          break;
        }
        case 'text': {
          // Coalesce consecutive text events into one growing block so the
          // pane reads like prose rather than a list of fragments.
          const text = String(event.text ?? '');
          if (!text) break;
          if (!activeTextBlock) {
            activeTextBlock = el('div', 'msg', text);
            appendLine(activeTextBlock);
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
          const nameEl = el('span', 'chip-name', name);
          chip.appendChild(nameEl);
          if (summary) {
            const sumEl = el('span', 'chip-summary', summary);
            chip.appendChild(sumEl);
          }
          const status = el('span', 'chip-status', '…');
          chip.appendChild(status);
          lastToolChip = chip;
          appendLine(chip);
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
            appendLine(el('div', `chip ${ok ? '' : 'err'}`, ok ? '✓ tool result' : '✗ tool result'));
          }
          lastToolChip = null;
          break;
        }
        case 'error': {
          activeTextBlock = null;
          lastToolChip = null;
          appendLine(el('div', 'err-line', String(event.message ?? 'error')));
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
          // For OAuth/subscription auth, surface a "subscription" tag instead
          // of the dollar amount so users don't think this hit their card.
          // The hover-title still includes the API-equivalent number for the
          // curious — it's accurate, just not what they were billed.
          if (apiKeySource === 'oauth') {
            footer.textContent = `${turnsLabel} · subscription`;
            footer.title = `≈ $${cost.toFixed(4)} API-equivalent (not billed — Claude subscription)`;
          } else {
            footer.textContent = `${turnsLabel} · $${cost.toFixed(4)}`;
            footer.title = '';
          }
          break;
        }
      }
    };

    es.addEventListener('done', () => {
      es.close();
      dismissBtn.textContent = 'Close';
      if (!footer.textContent) footer.textContent = 'Stream closed.';
    });

    es.onerror = () => {
      // EventSource auto-reconnects on transient errors; only surface a
      // visible message once the stream is conclusively dead. Treat
      // `done` (above) as the canonical close — onerror just lights up
      // when the connection drops.
      if (es.readyState === EventSource.CLOSED) {
        if (!footer.textContent) footer.textContent = 'Stream disconnected.';
      }
    };

    return es;
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
    flex: 1;
    min-height: 80px;
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
  .row { display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
  .row.spread { justify-content: space-between; }
  .btn { border: 0; padding: 6px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; font-family: inherit; }
  .btn.primary { background: #2563eb; color: #fff; }
  .btn.primary:disabled { background: #93c5fd; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: #374151; }

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
      <div class="row spread">
        <span class="footer-note" id="pp-stream-footer"></span>
        <button class="btn ghost" id="pp-dismiss" type="button">Hide</button>
      </div>
    </div>
  </div>
</body></html>`;
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

  // Global hotkey. Default 'c'; override with `window.__pinpointHotkey = 'x'`,
  // or disable with `window.__pinpointHotkey = false`.
  const hotkey = resolveHotkey();
  if (hotkey) {
    fab.title = `Pinpoint — press ${hotkey.toUpperCase()} or click to pick`;
    document.addEventListener(
      'keydown',
      (e) => {
        if (shouldIgnoreHotkey(e)) return;
        if (e.key.toLowerCase() !== hotkey) return;
        // Don't toggle while composing — user is probably typing in our textarea.
        if (state.mode === 'composing') return;
        e.preventDefault();
        if (state.mode === 'picking') exitPicking();
        else enterPicking();
      },
      // Capture phase so we see the event even if the host page calls
      // stopPropagation() on it. Trade-off: we may shadow a page shortcut
      // that uses the same key — set window.__pinpointHotkey to override.
      { capture: true },
    );
  }
}

function resolveHotkey(): string | null {
  const w = window as unknown as { __pinpointHotkey?: string | false | null };
  if (w.__pinpointHotkey === false || w.__pinpointHotkey === null) return null;
  const k = w.__pinpointHotkey;
  if (typeof k === 'string' && k.length === 1) return k.toLowerCase();
  return 'c';
}

function shouldIgnoreHotkey(e: KeyboardEvent): boolean {
  // Modifier combos belong to the page or the OS.
  if (e.metaKey || e.ctrlKey || e.altKey) return true;
  // The hotkey is a printable character — never intercept when typing.
  const t = e.target as (Element & { isContentEditable?: boolean }) | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return false;
}
