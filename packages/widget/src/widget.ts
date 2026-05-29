// SPDX-License-Identifier: Apache-2.0
import { BRAND_CREAM } from './brand';
import { createComposerController } from './composer';
import { createWsClient, resolveDockEnabled, resolveHotkey } from './config';
import { DOC_STYLES } from './constants';
import type { State, WidgetContext } from './context';
import { flushBrowserDb, initBrowserDb } from './db/client';
import { listPendingForCurrentPage } from './db/reads';
import { createFabTray } from './fab-tray';
import { isHopKey, shouldIgnoreHotkey } from './keyboard';
import { createPicker } from './picker';
import { buildPinIcon } from './pin-icon';
import { STYLES } from './styles';
import type { Composer } from './types';

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

  // The FAB doubles as the running-agents tray (see applyFabPresentation),
  // so it's a <div role="button"> rather than a <button>: a <button> can't
  // legally contain the tray's per-agent action buttons. Keyboard
  // activation for the collapsed pin mode is wired explicitly below.
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

  // Late-bound cross-controller actions throw until `mount` wires them
  // (right below). Controllers only invoke them at event time, so the
  // stubs are never actually called — they just make a wiring bug loud.
  const unwired = (): never => {
    throw new Error('pinagent: widget context not fully wired');
  };

  const ctx: WidgetContext = {
    host,
    root,
    fab,
    outline,
    state,
    wsClient: createWsClient(),
    hotkeyChar: resolveHotkey(),
    dockEnabled: resolveDockEnabled(),
    isMac: /Mac|iPod|iPhone|iPad/.test(navigator.platform),
    // Only one composer is expanded at a time. Opening a new one minimizes
    // the previously-expanded one to a bubble that keeps streaming in the
    // background.
    composers: new Set<Composer>(),
    expandedComposer: null,
    enterPicking: unwired,
    exitPicking: unwired,
    applyFabPresentation: unwired,
    swapTo: unwired,
    hopToNextActive: unwired,
    openComposer: unwired,
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

  // Wire the three controllers, then back-fill the cross-controller
  // actions onto ctx. Order doesn't matter — none of these construction
  // calls invoke another controller's actions synchronously.
  const composer = createComposerController(ctx);
  ctx.openComposer = composer.open;
  ctx.swapTo = composer.swapTo;
  ctx.hopToNextActive = composer.hopToNextActive;
  ctx.bubbleOwner = composer.bubbleOwner;

  const picker = createPicker(ctx);
  ctx.enterPicking = picker.enterPicking;
  ctx.exitPicking = picker.exitPicking;

  const fabTray = createFabTray(ctx);
  ctx.applyFabPresentation = fabTray.applyFabPresentation;

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
          composer.restore(row);
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

  if (ctx.hotkeyChar) {
    const hotkeyChar = ctx.hotkeyChar;
    // The pin's title (incl. this hotkey + the dock shortcut) is composed
    // in renderPinContent, which runs via applyFabPresentation below.
    document.addEventListener(
      'keydown',
      (e) => {
        if (shouldIgnoreHotkey(e)) return;
        if (e.key.toLowerCase() !== hotkeyChar) return;
        e.preventDefault();
        if (state.mode === 'picking') ctx.exitPicking();
        else ctx.enterPicking();
      },
      { capture: true },
    );

    // The dock iframe forwards the pick hotkey here when it has focus:
    // keystrokes inside the iframe never reach this page's keydown
    // listener above, so the dock relays a message instead. Mirror of
    // the host→dock `toggle-dock` bridge, in the other direction. See
    // widget-dock/src/shell/useKeyboardShortcuts.ts.
    window.addEventListener('message', (e) => {
      const data = e.data as { source?: string; type?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'pinagent-dock' || data.type !== 'enter-picker') return;
      if (state.mode === 'picking') ctx.exitPicking();
      else ctx.enterPicking();
    });
  }

  // Shift+N hops the expanded composer to the next in-flight agent.
  document.addEventListener(
    'keydown',
    (e) => {
      if (!isHopKey(e)) return;
      if (shouldIgnoreHotkey(e)) return;
      e.preventDefault();
      ctx.hopToNextActive();
    },
    { capture: true },
  );

  // Compose the initial pin (title + chip) and kick off the fetch/subscribe.
  fabTray.start();
}
