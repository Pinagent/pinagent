import { capturePageScreenshot } from './screenshot';
import { findLoc, shortSelector } from './selector';
import { STYLES } from './styles';

const ENDPOINT = '/__pinpoint/feedback';

interface State {
  mode: 'idle' | 'picking' | 'composing';
  selected: Element | null;
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

  // Status pill above the FAB. Shows # of running agents.
  // Hidden until an agent is actually tracked.
  const statusPill = document.createElement('div');
  statusPill.className = 'status-pill';
  statusPill.style.pointerEvents = 'auto';
  statusPill.style.display = 'none';
  root.appendChild(statusPill);

  const state: State = { mode: 'idle', selected: null };
  const running = new Set<string>();

  function updateStatusPill() {
    if (running.size === 0) {
      statusPill.style.display = 'none';
      return;
    }
    statusPill.style.display = 'flex';
    const label = running.size === 1 ? '1 agent running' : `${running.size} agents running`;
    statusPill.innerHTML = `<span class="spinner"></span><span>${label}</span>`;
    statusPill.title = Array.from(running).join('\n');
  }

  async function trackAgent(id: string) {
    if (running.has(id)) return;
    running.add(id);
    updateStatusPill();

    const deadline = Date.now() + 10 * 60 * 1000; // give up after 10 min
    let delay = 2000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, delay));
      if (delay < 5000) delay = Math.min(5000, delay + 500);
      try {
        const res = await fetch(`/__pinpoint/feedback/${id}`);
        if (!res.ok) break;
        const rec = await res.json();
        if (rec.status && rec.status !== 'pending') {
          const label = rec.status === 'fixed' ? '✓ Fixed' : `Agent: ${rec.status}`;
          toast(`${label} (${id})`, rec.status === 'fixed' ? 'success' : 'error');
          break;
        }
      } catch {
        // Network blip or dev-server reload — keep retrying.
      }
    }
    running.delete(id);
    updateStatusPill();
  }

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
    // Ignore the host itself.
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
    // The iframe itself is the popover, putting it in the browser's top
    // layer above any other DOM. The popover render isolates it visually;
    // the iframe document isolates it functionally (focus).
    if ('popover' in HTMLElement.prototype) {
      iframe.setAttribute('popover', 'manual');
    }

    const r = target.getBoundingClientRect();
    const IFRAME_W = 344;
    const IFRAME_H = 220;
    const top = Math.min(window.innerHeight - IFRAME_H - 8, Math.max(8, r.bottom + 8));
    const left = Math.min(window.innerWidth - IFRAME_W - 8, Math.max(8, r.left));
    iframe.style.top = `${top}px`;
    iframe.style.left = `${left}px`;
    iframe.style.width = `${IFRAME_W}px`;
    iframe.style.height = `${IFRAME_H}px`;

    // We pre-fill srcdoc with the composer HTML + styles. Using srcdoc keeps
    // the iframe same-origin with the parent (so we can reach into
    // contentDocument), and synchronously available after load.
    iframe.srcdoc = composerHTML(metaText);

    root.appendChild(iframe);
    if ('showPopover' in iframe && iframe.getAttribute('popover')) {
      try {
        (iframe as HTMLIFrameElement & { showPopover(): void }).showPopover();
      } catch {
        // Older browsers — iframe renders normally, just not in top layer.
      }
    }

    function close() {
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
      if (!ta || !cancel || !submit || !metaEl) return;

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
            // Don't await — the poll runs until the agent resolves or
            // gives up. Toast on completion.
            void trackAgent(result.id);
          }
          toast('Sent', 'success');
          close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast(`Error: ${msg}`, 'error');
          submit.disabled = false;
          submit.textContent = 'Submit';
        }
      });
    });
  }

  function composerHTML(metaText: string): string {
    // Escape the metaText so it can't break out of the HTML/attribute context.
    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif; }
  .card {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.2);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: #111827;
    height: calc(100% - 2px);
  }
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
  .row { display: flex; justify-content: flex-end; gap: 8px; }
  .btn { border: 0; padding: 6px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; font-family: inherit; }
  .btn.primary { background: #2563eb; color: #fff; }
  .btn.primary:disabled { background: #93c5fd; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: #374151; }
</style></head><body>
  <div class="card">
    <div class="meta" id="pp-meta">${esc(metaText)}</div>
    <textarea id="pp-ta" placeholder="Describe the change you want…"></textarea>
    <div class="row">
      <button class="btn ghost" id="pp-cancel" type="button">Cancel</button>
      <button class="btn primary" id="pp-submit" type="button" disabled>Submit</button>
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
