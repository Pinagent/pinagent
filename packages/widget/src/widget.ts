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
    setTimeout(() => ta.focus(), 0);

    ta.addEventListener('input', () => {
      submit.disabled = ta.value.trim().length === 0;
    });

    function close() {
      composer.remove();
      state.mode = 'idle';
      state.selected = null;
      outline.style.display = 'none';
    }

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
}
