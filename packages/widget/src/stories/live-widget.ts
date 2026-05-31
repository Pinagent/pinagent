// SPDX-License-Identifier: Apache-2.0

import type { RawFeedback } from '../agent-tray';
import { BRAND_CREAM } from '../brand';
import { createComposerController } from '../composer';
import { DOC_STYLES, ENDPOINT } from '../constants';
import type { State, WidgetContext } from '../context';
import { createFabTray } from '../fab-tray';
import { createPicker } from '../picker';
import { buildPinIcon } from '../pin-icon';
import { STYLES } from '../styles';
import type { Composer } from '../types';
import { WidgetWsClient } from '../ws-client';

/**
 * Mounts a *fully live* widget for interactive stories — the real
 * `createComposerController` / `createPicker` / `createFabTray` wired
 * exactly as `mount()` (widget.ts) wires them, so picking, the composer
 * iframe, drag/snap, and the running-agents tray all behave as shipped.
 *
 * Two deliberate substitutions keep it Storybook-safe and offline:
 *  - the WS client is `new WidgetWsClient(null)` — inert, never opens a
 *    socket (Stop/follow-ups become no-ops rather than errors);
 *  - the OPFS/sqlite-wasm cache init + pending-conversation restore that
 *    `mount()` runs is skipped (it's only for reload persistence).
 *
 * The `/__pinagent` REST surface the tray + composer-submit hit is faked
 * via {@link installFakeApi} so the tray can render rows and a submit can
 * complete without a dev server.
 */

export interface LiveWidgetHandle {
  host: HTMLElement;
  destroy(): void;
}

// Only one live widget at a time. Storybook re-runs `render` on every story
// switch but our host attaches to documentElement (not the returned canvas
// node), so we tear down the previous instance on each fresh mount.
const liveInstances = new Set<LiveWidgetHandle>();

function ensureDocStyles(): void {
  if (document.getElementById('pinagent-doc-styles')) return;
  const docStyle = document.createElement('style');
  docStyle.id = 'pinagent-doc-styles';
  docStyle.textContent = DOC_STYLES;
  document.head.appendChild(docStyle);
}

export function mountLiveWidget(opts: { dockEnabled?: boolean } = {}): LiveWidgetHandle {
  // Tear down any widget left over from a previous story.
  for (const inst of [...liveInstances]) inst.destroy();

  ensureDocStyles();

  const host = document.createElement('div');
  host.id = 'pinagent-root';
  host.className = 'pa-story-host';
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '2147483647';
  document.documentElement.appendChild(host);

  // `open` (not `closed` like production) so Storybook's inspector can see in.
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  root.appendChild(style);

  const fab = document.createElement('div');
  fab.className = 'fab';
  fab.setAttribute('role', 'button');
  fab.setAttribute('tabindex', '0');
  fab.setAttribute('aria-label', 'Pinagent — pick an element');
  fab.title = 'Pinagent — pick an element';
  fab.style.pointerEvents = 'auto';
  fab.appendChild(buildPinIcon(26, BRAND_CREAM));
  root.appendChild(fab);

  const outline = document.createElement('div');
  outline.className = 'outline';
  outline.style.display = 'none';
  root.appendChild(outline);

  const state: State = { mode: 'idle' };
  const unwired = (): never => {
    throw new Error('pinagent: widget context not fully wired');
  };

  const ctx: WidgetContext = {
    host,
    root,
    fab,
    outline,
    state,
    wsClient: new WidgetWsClient(null),
    hotkeyChar: null,
    dockEnabled: opts.dockEnabled ?? false,
    isMac: /Mac|iPod|iPhone|iPad/.test(navigator.platform),
    composers: new Set<Composer>(),
    expandedComposer: null,
    pickRouteComposer: null,
    enterPicking: unwired,
    exitPicking: unwired,
    applyFabPresentation: unwired,
    swapTo: unwired,
    hopToNextActive: unwired,
    minimizeAll: unwired,
    openComposer: unwired,
    addNodeToComposer: unwired,
    bubbleOwner: unwired,
    toast: unwired,
  };

  ctx.toast = (text, kind) => {
    const el = document.createElement('div');
    el.className = `toast${kind === 'error' ? ' error' : ''}`;
    el.textContent = text;
    root.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  };

  const composer = createComposerController(ctx);
  ctx.openComposer = composer.open;
  ctx.addNodeToComposer = composer.addNodeToComposer;
  ctx.swapTo = composer.swapTo;
  ctx.hopToNextActive = composer.hopToNextActive;
  ctx.bubbleOwner = composer.bubbleOwner;

  const picker = createPicker(ctx);
  ctx.enterPicking = picker.enterPicking;
  ctx.exitPicking = picker.exitPicking;

  const fabTray = createFabTray(ctx);
  ctx.applyFabPresentation = fabTray.applyFabPresentation;

  fabTray.start();

  const handle: LiveWidgetHandle = {
    host,
    destroy() {
      liveInstances.delete(handle);
      if (state.mode === 'picking') {
        try {
          ctx.exitPicking();
        } catch {
          // best-effort
        }
      }
      // Composer iframes/bubbles live in document.body — close() removes them.
      for (const c of [...ctx.composers]) {
        try {
          c.close();
        } catch {
          // best-effort
        }
      }
      host.remove();
    },
  };
  liveInstances.add(handle);
  return handle;
}

/**
 * Monkeypatch `window.fetch` for the `/__pinagent` REST calls the widget
 * makes, so the tray renders `agents` and a composer submit resolves. Pass
 * the agents the running-agents tray should list (empty → collapsed pin).
 * Returns a restore fn.
 */
export function installFakeApi(agents: RawFeedback[] = []): () => void {
  const realFetch = window.fetch;
  let counter = 0;

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.includes(ENDPOINT)) {
      // PATCH /feedback/:id (archive/clear) and DELETE → ack.
      if (method === 'PATCH' || method === 'DELETE') {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      // POST /feedback (submit) → return a fresh conversation id.
      if (method === 'POST') {
        counter += 1;
        return Promise.resolve(
          new Response(JSON.stringify({ id: `story-${counter}` }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      // GET /feedback (tray list).
      return Promise.resolve(
        new Response(JSON.stringify(agents), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    return realFetch(input, init);
  }) as typeof window.fetch;

  return () => {
    window.fetch = realFetch;
  };
}

/**
 * A small demo "app" surface to pick against — instrumented with
 * `data-pa-loc` / `data-pa-comp` so the composer header shows a realistic
 * file:line + enclosing component.
 */
export function buildDemoApp(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText =
    'width:520px;min-height:300px;padding:24px;border-radius:14px;background:#fff;' +
    'box-shadow:0 1px 3px rgba(0,0,0,0.1);font-family:system-ui,sans-serif;color:#18181b;';
  wrap.innerHTML = `
    <div data-pa-loc="src/PriceCard.tsx:8:3" data-pa-comp="PriceCard"
         style="border:1px solid #e4e4e7;border-radius:12px;padding:20px;max-width:280px;">
      <h3 data-pa-loc="src/PriceCard.tsx:9:5" style="margin:0 0 4px;font-size:18px;">Pro plan</h3>
      <p data-pa-loc="src/PriceCard.tsx:10:5" style="margin:0 0 16px;color:#71717a;font-size:14px;">
        Everything in Free, plus unlimited projects.
      </p>
      <div data-pa-loc="src/PriceCard.tsx:13:5" style="font-size:28px;font-weight:600;margin-bottom:16px;">
        $29<span style="font-size:14px;font-weight:400;color:#71717a;">/mo</span>
      </div>
      <button data-pa-loc="src/PriceCard.tsx:16:5" data-pa-comp="PriceCard"
              style="width:100%;padding:10px;border:0;border-radius:8px;background:#18181b;color:#fff;font-size:14px;cursor:pointer;">
        Add to cart
      </button>
    </div>
    <p style="margin-top:20px;color:#71717a;font-size:13px;">
      Click the pin (bottom-right), then click an element above to comment on it.
    </p>`;
  return wrap;
}
