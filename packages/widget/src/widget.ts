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
    // Ignore the host itself.
    if (target === host) return null;
    return target;
  }

  function openComposer(target: Element) {
    state.mode = 'composing';
    const loc = findLoc(target);
    const selector = shortSelector(target);

    const composer = document.createElement('div');
    composer.className = 'composer';
    composer.style.pointerEvents = 'auto';
    // Promote to the browser's top layer via the Popover API. Top-layer
    // elements render above any other DOM and — critically — are immune to
    // focus traps applied by host-page modals (Radix Dialog, Headless UI,
    // etc.). Without this, typing in the textarea fails when the user
    // picked an element inside a modal: the modal's focusin handler keeps
    // snapping focus back to itself.
    if ('popover' in HTMLElement.prototype) {
      composer.setAttribute('popover', 'manual');
    }

    const r = target.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 240, Math.max(8, r.bottom + 8));
    const left = Math.min(window.innerWidth - 332, Math.max(8, r.left));
    composer.style.top = `${top}px`;
    composer.style.left = `${left}px`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = loc ? `${loc.file}:${loc.line}:${loc.col}` : selector;
    composer.appendChild(meta);

    const ta = document.createElement('textarea');
    ta.placeholder = 'Describe the change you want…';
    composer.appendChild(ta);

    const row = document.createElement('div');
    row.className = 'row';
    const cancel = document.createElement('button');
    cancel.className = 'btn ghost';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const submit = document.createElement('button');
    submit.className = 'btn primary';
    submit.type = 'button';
    submit.textContent = 'Submit';
    submit.disabled = true;
    row.appendChild(cancel);
    row.appendChild(submit);
    composer.appendChild(row);

    root.appendChild(composer);
    // Activate top-layer rendering. Must come after the element is in the DOM.
    if ('showPopover' in composer && composer.getAttribute('popover')) {
      try {
        (composer as HTMLElement & { showPopover(): void }).showPopover();
      } catch {
        // Older browsers — element still renders normally, just not in top layer.
      }
    }
    setTimeout(() => ta.focus(), 0);

    ta.addEventListener('input', () => {
      submit.disabled = ta.value.trim().length === 0;
    });

    function close() {
      document.removeEventListener('keydown', onComposerKey, { capture: true });
      composer.remove();
      state.mode = 'idle';
      state.selected = null;
      outline.style.display = 'none';
    }

    function onComposerKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      // Capture + stopPropagation so an outer modal (Radix Dialog, etc.)
      // doesn't also close on the same Escape press.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    document.addEventListener('keydown', onComposerKey, { capture: true });

    cancel.addEventListener('click', close);

    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.textContent = 'Sending…';
      try {
        const screenshot = await capturePageScreenshot((node) => node !== host);
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
        toast('Sent', 'success');
        close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Error: ${msg}`, 'error');
        submit.disabled = false;
        submit.textContent = 'Submit';
      }
    });
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
