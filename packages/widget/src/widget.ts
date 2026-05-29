// SPDX-License-Identifier: Apache-2.0
import { createAgentTray, type RawFeedback, type TrayAgent } from './agent-tray';
import { BRAND_CREAM } from './brand';
import { composerHTML } from './composer-html';
import { createWsClient, resolveDockEnabled, resolveHotkey } from './config';
import {
  BUBBLE_SIZE,
  COMPOSER_H,
  DOC_STYLES,
  ENDPOINT,
  ICON_GRIP,
  IFRAME_W,
  MAX_TA_H,
  MIN_TA_H,
  MINI_H,
  STATUS_LABEL,
  STREAM_H,
  trayRowMeta,
} from './constants';
import { computeUnionCropRect } from './crop';
import { flushBrowserDb, getBrowserDb, initBrowserDb } from './db/client';
import { getConversationMessages, listPendingForCurrentPage, type PendingRow } from './db/reads';
import { deleteConversation, recordConversationStart } from './db/writes';
import { isHopKey, pickNextActive, shouldIgnoreHotkey } from './keyboard';
import { buildPinIcon } from './pin-icon';
import { quickActionsFor } from './quick-actions';
import { capturePageScreenshot } from './screenshot';
import {
  breadcrumbTags,
  componentOf,
  componentPath,
  describeElementLabel,
  elementFingerprint,
  findLoc,
  findLocEl,
  findReanchorTarget,
  locInstanceInfo,
  shortSelector,
} from './selector';
import { attachStreamHandler } from './stream-handler';
import { STYLES } from './styles';
import type {
  AgentState,
  Composer,
  ComposerMeta,
  ExtraAnchor,
  InstanceInfo,
  LifecycleEls,
  ReplayMessage,
} from './types';

interface State {
  mode: 'idle' | 'picking';
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
  const dockEnabled = resolveDockEnabled();

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

  // Cmd-click (mac) / Ctrl-click (win/linux) accumulates targets during
  // a single pick session. A plain click then commits the whole group
  // (the plain-clicked element becomes the primary anchor; everything
  // queued here becomes the additional anchors). Cleared on exit.
  type PendingPick = { target: Element; click: { x: number; y: number }; outline: HTMLDivElement };
  const pendingPicks: PendingPick[] = [];
  let pendingPicksRaf: number | null = null;
  const IS_MAC = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const MOD_LABEL = IS_MAC ? 'Cmd' : 'Ctrl';

  function enterPicking() {
    state.mode = 'picking';
    // Collapse the tray (if showing) back to the pin — picking owns the FAB.
    applyFabPresentation();
    fab.classList.add('active');
    document.documentElement.classList.add('pa-picking');

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.dataset.pp = 'hint';
    root.appendChild(hint);
    updatePickHint();

    // Suspend pointer-events on the expanded composer iframe so clicks
    // pass through to the underlying page. Bubbles stay clickable so the
    // user can quickly swap to a minimized composer.
    if (expandedComposer) {
      expandedComposer.iframe.style.pointerEvents = 'none';
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKey, true);

    // Keep the persistent selection outlines pinned to their elements
    // while the user keeps picking — the page may scroll or reflow.
    const tick = () => {
      for (const p of pendingPicks) positionSelectionOutline(p.outline, p.target);
      pendingPicksRaf = requestAnimationFrame(tick);
    };
    pendingPicksRaf = requestAnimationFrame(tick);
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
    clearPendingPicks();
    if (pendingPicksRaf !== null) {
      cancelAnimationFrame(pendingPicksRaf);
      pendingPicksRaf = null;
    }
    // Restore the tray if agents are still running.
    applyFabPresentation();
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

    const additive = e.metaKey || e.ctrlKey;
    if (additive) {
      // Toggle: same element re-clicked with the modifier deselects.
      const existingIdx = pendingPicks.findIndex((p) => p.target === target);
      if (existingIdx >= 0) {
        const removed = pendingPicks.splice(existingIdx, 1)[0];
        if (removed) removed.outline.remove();
      } else {
        const ol = document.createElement('div');
        ol.className = 'selection-outline';
        root.appendChild(ol);
        positionSelectionOutline(ol, target);
        pendingPicks.push({ target, click: { x: e.clientX, y: e.clientY }, outline: ol });
      }
      updatePickHint();
      return;
    }

    // Plain click — commit. Snapshot pending picks before exitPicking
    // wipes them, then hand the array to the composer as extras.
    const extras = pendingPicks.map((p) => ({ target: p.target, click: p.click }));
    exitPicking();
    openComposer(target, { x: e.clientX, y: e.clientY }, extras);
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

  function positionSelectionOutline(el: HTMLDivElement, target: Element): void {
    const r = target.getBoundingClientRect();
    el.style.top = `${r.top}px`;
    el.style.left = `${r.left}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }

  function clearPendingPicks(): void {
    for (const p of pendingPicks) p.outline.remove();
    pendingPicks.length = 0;
  }

  function updatePickHint(): void {
    const hint = root.querySelector('[data-pp="hint"]');
    if (!hint) return;
    if (pendingPicks.length === 0) {
      hint.textContent = `Click an element. ${MOD_LABEL}-click to add more. Esc to cancel.`;
    } else {
      const n = pendingPicks.length;
      hint.textContent = `${n} selected. Click to comment. ${MOD_LABEL}-click to add more. Esc to cancel.`;
    }
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

  function openComposer(
    target: Element,
    click: { x: number; y: number },
    extras: Array<{ target: Element; click: { x: number; y: number } }> = [],
  ) {
    if (expandedComposer) {
      expandedComposer.minimize();
    }
    const composer = createComposer(target, click, extras);
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

  function createComposer(
    target: Element,
    click: { x: number; y: number },
    extras: Array<{ target: Element; click: { x: number; y: number } }> = [],
  ): Composer {
    const locHit = findLocEl(target);
    const loc = locHit?.loc ?? null;
    const selector = shortSelector(target);
    // Enclosing-component context (from `data-pa-comp`). `component` and
    // the path read off the same walk-up as the loc; `instance` is only
    // meaningful when the resolved loc is shared by several live nodes
    // (a `.map()`), so we leave it null otherwise to keep single-pick
    // payloads byte-identical to before.
    const component = componentOf(target);
    const compPath = componentPath(target);
    let instance: InstanceInfo | null = null;
    if (locHit) {
      const info = locInstanceInfo(locHit.el, locHit.raw);
      if (info.total > 1) {
        instance = {
          index: Math.max(0, info.index),
          total: info.total,
          fingerprint: elementFingerprint(locHit.el),
        };
      }
    }
    // Resolve each extra once, deriving both the wire anchor (sent to
    // the server on submit) and the display row (the badge popover).
    const extraData = extras.map(({ target: t, click: c }) => {
      const eloc = findLoc(t);
      return {
        anchor: {
          file: eloc?.file ?? null,
          line: eloc?.line ?? null,
          col: eloc?.col ?? null,
          selector: shortSelector(t),
          clickX: c.x,
          clickY: c.y,
          component: componentOf(t),
        } as ExtraAnchor,
        display: { tag: t.tagName.toLowerCase(), label: describeElementLabel(t), loc: eloc },
      };
    });
    const extraAnchors: ExtraAnchor[] = extraData.map((d) => d.anchor);
    const meta: ComposerMeta = {
      tag: target.tagName.toLowerCase(),
      label: describeElementLabel(target),
      loc,
      component,
      breadcrumbs: breadcrumbTags(target),
      chips: quickActionsFor(target),
      extraCount: extraAnchors.length,
      extras: extraData.map((d) => d.display),
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
      // Mirror onto the mini card so its border can echo the bubble
      // palette (done = ready tint, error = error tint) while minimized.
      const idoc = iframe.contentDocument;
      if (idoc?.body) idoc.body.dataset.agentState = next;
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

      // When minimized post-submit we keep the iframe visible as the
      // mini progress card (MINI_H); only the dashed anchor-lost dot
      // falls back to hiding it. Expanded uses the full height.
      const showDot = composer.anchorLost && !!composer.feedbackId;
      const composerH = currentIframeH();
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
      dragHandle.hidden = showDot || !composer.expanded;

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

      // Single source of truth for iframe/dot/pointer visibility. The
      // iframe is shown in both expanded and mini states; the dashed
      // dot only takes over when the anchor was lost (no live element
      // to pin a card to). The tail points at the element whenever the
      // iframe is visible.
      iframe.hidden = showDot;
      bubble.hidden = !showDot;
      pointer.style.display = showDot ? 'none' : '';
    }

    // Single source of truth for the iframe's height, read by both the
    // height setters (expand/minimize/refitStream) and the rAF placement
    // loop (reposition) so the pointer tail and above/below decision track
    // the real height. `streamFitH` (the loading-gap fit) wins when set.
    function currentIframeH(): number {
      if (composer.streamFitH != null) return composer.streamFitH;
      if (composer.expanded) return composer.feedbackId ? STREAM_H : currentComposerH;
      return MINI_H;
    }

    const composer: Composer = {
      feedbackId: null,
      target,
      iframe,
      bubble,
      dragHandle,
      dataPaLoc,
      selector,
      extraAnchors,
      component,
      componentPath: compPath,
      instance,
      anchorLost: false,
      userOffsetX: 0,
      userOffsetY: 0,
      turn: 0,
      agentState: 'pending',
      expanded: true,
      streamFitH: null,
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
        clearExtraFlashes();
        iframe.remove();
        bubble.remove();
        dragHandle.remove();
        pointer.remove();
        composers.delete(composer);
        if (expandedComposer === composer) expandedComposer = null;
      },
      expand() {
        composer.expanded = true;
        // Chrome first (it toggles `.follow`/`.header-block` visibility),
        // then refit so a measured loading-gap fit reflects the right
        // chrome; refitStream applies the height + repositions.
        applyMiniChrome();
        composer.refitStream();
      },
      minimize() {
        // Minimized = the mini progress card, NOT a hidden iframe. The
        // iframe stays visible at MINI_H with `body.mini` toggled on;
        // reposition() decides iframe-vs-dot visibility. Multiple mini
        // cards can coexist (one per anchored agent) — only the *full*
        // expanded composer is tracked by expandedComposer.
        composer.expanded = false;
        applyMiniChrome();
        composer.refitStream();
        if (expandedComposer === composer) expandedComposer = null;
      },
      refitStream() {
        // While the stream log is still empty (the gap between submit and
        // the first streamed event), shrink the card to hug just the
        // header + footer instead of leaving a fixed-height empty box.
        // `.log:empty` collapses the box in CSS; here we match the iframe
        // height to the natural content height so there's no dead space.
        const idoc = iframe.contentDocument;
        const log = idoc?.getElementById('pa-stream-log');
        const inLoadingGap = !!composer.feedbackId && !!log && !log.firstChild;
        if (inLoadingGap) {
          const card = idoc?.querySelector('.card') as HTMLElement | null;
          // Measure the natural height: the card is forced to fill the
          // iframe (`height: calc(100% - 2px)`), so read scrollHeight with
          // height:auto then restore — the same auto-grow trick the
          // textarea resize uses. `+2` mirrors the card's height calc.
          if (card) {
            const saved = card.style.height;
            card.style.height = 'auto';
            const natural = card.scrollHeight;
            card.style.height = saved;
            composer.streamFitH = natural + 2;
          } else {
            composer.streamFitH = null;
          }
        } else {
          composer.streamFitH = null;
        }
        iframe.style.height = `${currentIframeH()}px`;
        reposition();
      },
    };

    // Reflect expanded/mini onto the iframe document: toggle `body.mini`
    // (drives the condensed card CSS) and relabel the footer toggle
    // button. Expanding also clears any needs-input attention state,
    // since expanding is how the user gets to the answer form.
    function applyMiniChrome() {
      const idoc = iframe.contentDocument;
      if (!idoc?.body) return;
      idoc.body.classList.toggle('mini', !composer.expanded);
      if (composer.expanded) idoc.body.classList.remove('needs-input');
      const dismiss = idoc.getElementById('pa-dismiss');
      if (dismiss) dismiss.textContent = composer.expanded ? 'Minimize' : 'Expand';
    }

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
    // Flash outlines drawn while the user hovers the "+N" badge in the
    // composer header. Resolved fresh on each hover so we pick up any
    // DOM changes since the user committed.
    let extraFlashes: HTMLDivElement[] = [];
    function clearExtraFlashes(): void {
      for (const el of extraFlashes) el.remove();
      extraFlashes = [];
    }
    function flashExtras(): void {
      clearExtraFlashes();
      for (const a of composer.extraAnchors) {
        const t = findReanchorTarget(
          a.file && a.line != null && a.col != null ? `${a.file}:${a.line}:${a.col}` : null,
          a.selector,
        );
        if (!t) continue;
        const r = t.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = 'selection-outline';
        el.style.top = `${r.top}px`;
        el.style.left = `${r.left}px`;
        el.style.width = `${r.width}px`;
        el.style.height = `${r.height}px`;
        root.appendChild(el);
        extraFlashes.push(el);
      }
    }

    function onIframeMessage(ev: MessageEvent) {
      if (ev.source !== iframe.contentWindow) return;
      const data = ev.data as { type?: string; taHeight?: number } | null;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'pa-extras-hover') {
        flashExtras();
        return;
      }
      if (data.type === 'pa-extras-leave') {
        clearExtraFlashes();
        return;
      }
      if (data.type !== 'pa-composer-resize-ta') return;
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
      const openDockBtn = idoc.getElementById('pa-open-dock') as HTMLButtonElement | null;
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
      // When the host also mounts the dock, offer a jump from the open
      // conversation to that same conversation in the dock. Posts straight
      // to the dock iframe (the composer iframe is same-origin, so this
      // handler runs in the host page context). `open-conversation` opens
      // the dock if closed and navigates either way — see the dock's
      // useOpenConversationBridge (shared with the agent tray's "Open").
      if (openDockBtn && resolveDockEnabled()) {
        openDockBtn.hidden = false;
        openDockBtn.addEventListener('click', () => {
          const fid = c.feedbackId;
          if (!fid) return;
          const dockFrame = document.getElementById('__pinagent-dock') as HTMLIFrameElement | null;
          dockFrame?.contentWindow?.postMessage(
            { source: 'pinagent-host', type: 'open-conversation', feedbackId: fid },
            '*',
          );
        });
      }
      const lifecycle: LifecycleEls = {
        row: lifecycleRow,
        label: lifecycleLabel,
        landBtn,
        discardBtn,
      };

      // Minimize ⇄ Expand toggle. Expanding routes through swapTo so any
      // other full composer collapses to its own mini card first (only
      // one expanded at a time). Wired here — not in attachStreamHandler
      // — because swapTo lives in this scope.
      dismissBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (c.expanded) c.minimize();
        else swapTo(c);
      });
      // Clicking anywhere on a minimized card expands it. No-op while
      // expanded so in-card interactions (text selection, follow-up,
      // lifecycle buttons) aren't hijacked.
      streamPane.addEventListener('click', () => {
        if (!c.expanded) swapTo(c);
      });

      // "+N more" badge — present only when extras > 0. Hovering it
      // does two things: bounces a message up to the parent to flash
      // outlines on the underlying-page extras, and opens an in-composer
      // popover (`#pa-extras-pop`) listing every selected element. The
      // popover sits below the header with a small gap, so we hide it on
      // a short delay — long enough for the pointer to cross the gap and
      // land on the popover (whose own mouseenter cancels the hide).
      const extrasBadge = idoc.getElementById('pa-extras');
      const extrasPop = idoc.getElementById('pa-extras-pop');
      if (extrasBadge) {
        let hideTimer: ReturnType<typeof setTimeout> | null = null;
        const cancelHide = () => {
          if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
          }
        };
        const showPop = () => {
          cancelHide();
          extrasPop?.classList.add('open');
        };
        const scheduleHide = () => {
          cancelHide();
          hideTimer = setTimeout(() => extrasPop?.classList.remove('open'), 140);
        };
        extrasBadge.addEventListener('mouseenter', () => {
          iwin.parent.postMessage({ type: 'pa-extras-hover' }, '*');
          showPop();
        });
        extrasBadge.addEventListener('mouseleave', () => {
          iwin.parent.postMessage({ type: 'pa-extras-leave' }, '*');
          scheduleHide();
        });
        if (extrasPop) {
          extrasPop.addEventListener('mouseenter', showPop);
          extrasPop.addEventListener('mouseleave', scheduleHide);
        }
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
          // Esc steps down one level:
          // - Pre-submit (no agent): close — nothing alive to preserve.
          // - Expanded post-submit: minimize to the mini progress card
          //   (the agent keeps working / stays available for review).
          // - Already minimized: close — dismiss the card.
          if (!c.feedbackId) c.close();
          else if (c.expanded) c.minimize();
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
        // Restored conversations come back minimized (restorePending
        // calls minimize() before the iframe loads, so body.mini/height
        // weren't applied yet). Sync the chrome now that idoc exists.
        iframe.style.height = `${c.expanded ? STREAM_H : MINI_H}px`;
        applyMiniChrome();
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
          // Union bbox of primary + all live extras. When the user
          // multi-picked, this is what the agent gets — a crop tight
          // enough that the elements + a little surrounding context are
          // visible. When there are no extras, omit the crop and keep
          // today's full-page screenshot behavior.
          const cropRect = computeUnionCropRect(c.target, c.extraAnchors);
          const screenshot = await capturePageScreenshot(
            (node) =>
              node !== host &&
              node !== (c.iframe as unknown as HTMLElement) &&
              node !== (c.bubble as unknown as HTMLElement),
            cropRect,
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
            additionalAnchors: c.extraAnchors.length > 0 ? c.extraAnchors : undefined,
            // Enclosing-component context (omitted when uninstrumented so
            // the wire shape is unchanged for non-Babel-tagged apps).
            component: c.component ?? undefined,
            componentPath: c.componentPath.length > 0 ? c.componentPath : undefined,
            instance: c.instance ?? undefined,
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
                  component: c.component,
                  componentPath: c.componentPath.length > 0 ? c.componentPath : null,
                  instanceIndex: c.instance?.index ?? null,
                  instanceTotal: c.instance?.total ?? null,
                  instanceFingerprint: c.instance?.fingerprint ?? null,
                  additionalAnchors: c.extraAnchors.length > 0 ? c.extraAnchors : undefined,
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
              stopBtn,
              followInput,
              followSend,
              lifecycle,
            );
            // Auto-minimize on submit: the agent works in the background
            // as a mini progress card anchored to the element, instead
            // of the full stream popover taking over the screen.
            c.minimize();
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
  const CORNERS: readonly Corner[] = ['tl', 'tr', 'bl', 'br'];
  // Persist the FAB's corner across reloads (the deleted dock FAB did this
  // too). Best-effort: localStorage can throw in sandboxed iframes / private
  // mode, and a bad/legacy value falls back to the default corner.
  const FAB_CORNER_KEY = 'pinagent.fab-corner';
  function loadCorner(): Corner {
    try {
      const v = localStorage.getItem(FAB_CORNER_KEY);
      if (v && (CORNERS as readonly string[]).includes(v)) return v as Corner;
    } catch {
      // localStorage unavailable — use the default.
    }
    return 'br';
  }
  function saveCorner(corner: Corner): void {
    try {
      localStorage.setItem(FAB_CORNER_KEY, corner);
    } catch {
      // Non-critical; position just won't persist.
    }
  }
  let suppressNextFabClick = false;
  // Last corner the FAB/tray snapped to. Re-applied after a pin↔tray swap
  // (their sizes differ) so the surface stays anchored to the same corner,
  // and restored from localStorage so a reload keeps the user's placement.
  let currentCorner: Corner = loadCorner();
  // The agents currently shown in the tray (empty → collapsed pin).
  let trayAgents: TrayAgent[] = [];

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
    // In tray mode, only the handle drags — mousedowns on rows or their
    // action buttons must fall through to those buttons' own listeners.
    if (fab.classList.contains('tray')) {
      const t = e.target as Element | null;
      if (!t?.closest('.pa-tray-handle') || t.closest('button')) return;
    }

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
      currentCorner = nearestCorner(r.left + r.width / 2, r.top + r.height / 2);
      snapFabToCorner(currentCorner);
      saveCorner(currentCorner);
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
    // In tray mode the rows + the header's pick button own their clicks;
    // a click on the panel background does nothing.
    if (fab.classList.contains('tray')) return;
    if (state.mode === 'picking') exitPicking();
    else if (state.mode === 'idle') enterPicking();
  });

  // Keyboard activation for the collapsed pin (role="button"). Disabled in
  // tray mode, where the inner buttons are individually focusable.
  fab.addEventListener('keydown', (e) => {
    if (fab.classList.contains('tray')) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (state.mode === 'picking') exitPicking();
    else if (state.mode === 'idle') enterPicking();
  });

  if (hotkeyChar) {
    // The pin's title (incl. this hotkey + the dock shortcut) is composed
    // in renderPinContent, which runs via applyFabPresentation below.
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

    // The dock iframe forwards the pick hotkey here when it has focus:
    // keystrokes inside the iframe never reach this page's keydown
    // listener above, so the dock relays a message instead. Mirror of
    // the host→dock `toggle-dock` bridge, in the other direction. See
    // widget-dock/src/shell/useKeyboardShortcuts.ts.
    window.addEventListener('message', (e) => {
      const data = e.data as { source?: string; type?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'pinagent-dock' || data.type !== 'enter-picker') return;
      if (state.mode === 'picking') exitPicking();
      else enterPicking();
    });
  }

  // ---- Running-agents tray ---------------------------------------------
  // When unresolved agents exist the FAB expands into a draggable tray
  // listing each one with Open / Stop / Clear. With none (or while actively
  // picking) it collapses back to the pin. The controller in agent-tray.ts
  // owns data + coalescing; this half owns the DOM and the per-row actions.

  // Collapsed pin: the pick icon plus (when the dock is mounted) a small
  // chip teaching the ⌘⇧P dock shortcut. Decorative + pointer-events:none,
  // so a click on the chip falls through to the FAB → opens the picker.
  function renderPinContent() {
    fab.replaceChildren();
    fab.appendChild(buildPinIcon(26, BRAND_CREAM));
    let title = hotkeyChar
      ? `Pinagent — press ${hotkeyChar.toUpperCase()} or click to pick · Shift+N to hop between active widgets`
      : 'Pinagent — pick an element';
    if (dockEnabled) {
      const dockShortcut = IS_MAC ? '⌘⇧P' : 'Ctrl⇧P';
      const chip = document.createElement('span');
      chip.className = 'fab-shortcut';
      chip.textContent = dockShortcut;
      chip.setAttribute('aria-hidden', 'true');
      fab.appendChild(chip);
      title = `${title} · ${dockShortcut} opens the dock`;
    }
    fab.title = title;
  }

  // Tell the dock (a sibling iframe the host bridge mounted) to open and
  // navigate to this conversation. Same `open-conversation` frame the
  // composer's "open in dock" button posts — see the dock's
  // useOpenConversationBridge.
  function openInDock(feedbackId: string) {
    const iframe = document.getElementById('__pinagent-dock');
    if (iframe instanceof HTMLIFrameElement && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { source: 'pinagent-host', type: 'open-conversation', feedbackId },
        '*',
      );
    }
  }

  // Clear = archive. Remove the row optimistically; the PATCH emits a
  // conversations_changed event that refreshes the tray and reconciles.
  function clearAgent(feedbackId: string) {
    tray.removeOptimistic(feedbackId);
    void fetch(`${ENDPOINT}/${feedbackId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`archive ${res.status}`);
      })
      .catch(() => {
        toast('Couldn’t clear agent', 'error');
        void tray.refresh();
      });
  }

  function makeRowBtn(
    label: string,
    danger: boolean,
    onClick: (ev: MouseEvent, btn: HTMLButtonElement) => void,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = danger ? 'pa-tray-btn danger' : 'pa-tray-btn';
    btn.textContent = label;
    btn.addEventListener('click', (ev) => onClick(ev, btn));
    return btn;
  }

  function buildAgentRow(agent: TrayAgent): HTMLLIElement {
    const row = document.createElement('li');
    row.className = 'pa-tray-row';

    const dot = document.createElement('span');
    dot.className = 'pa-status-dot';
    dot.setAttribute('data-status', agent.status);
    dot.title = STATUS_LABEL[agent.status] ?? agent.status;

    // Title + meta stacked in a column so the row stays one logical line
    // while showing the glanceable "N msg · $cost" beneath the title.
    const main = document.createElement('span');
    main.className = 'pa-tray-rowmain';
    const title = document.createElement('span');
    title.className = 'pa-tray-rowtitle';
    title.textContent = agent.title;
    title.title = agent.selector ? `${agent.title}\n${agent.selector}` : agent.title;
    main.appendChild(title);
    const metaText = trayRowMeta(agent.messageCount, agent.costUsd);
    if (metaText) {
      const meta = document.createElement('span');
      meta.className = 'pa-tray-meta';
      meta.textContent = metaText;
      main.appendChild(meta);
    }

    const actions = document.createElement('span');
    actions.className = 'pa-tray-actions';
    // Open needs the dock iframe; hide it when no dock is mounted.
    if (dockEnabled) {
      actions.appendChild(
        makeRowBtn('Open', false, (ev) => {
          ev.stopPropagation();
          openInDock(agent.id);
        }),
      );
    }
    actions.appendChild(
      makeRowBtn('Stop', false, (ev, btn) => {
        ev.stopPropagation();
        wsClient.sendInterrupt(agent.id);
        btn.disabled = true;
        btn.textContent = '…';
      }),
    );
    actions.appendChild(
      makeRowBtn('Clear', true, (ev, btn) => {
        ev.stopPropagation();
        btn.disabled = true;
        clearAgent(agent.id);
      }),
    );

    row.append(dot, main, actions);
    return row;
  }

  function renderTrayContent(agents: TrayAgent[]) {
    fab.replaceChildren();
    fab.title = '';

    const handle = document.createElement('div');
    handle.className = 'pa-tray-handle';
    const grip = document.createElement('span');
    grip.className = 'pa-tray-grip';
    grip.innerHTML = ICON_GRIP;
    grip.setAttribute('aria-hidden', 'true');
    const heading = document.createElement('span');
    heading.className = 'pa-tray-title';
    heading.textContent = `Agents · ${agents.length}`;
    // The tray replaces the pin, so keep a way to start a new pick.
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'pa-tray-pick';
    pick.title = 'Pick an element';
    pick.setAttribute('aria-label', 'Pick an element');
    pick.appendChild(buildPinIcon(15, BRAND_CREAM));
    pick.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (state.mode === 'picking') exitPicking();
      else enterPicking();
    });
    handle.append(grip, heading, pick);
    fab.appendChild(handle);

    const list = document.createElement('ul');
    list.className = 'pa-tray-list';
    for (const agent of agents) list.appendChild(buildAgentRow(agent));
    fab.appendChild(list);
  }

  function applyFabPresentation() {
    const showTray = state.mode !== 'picking' && trayAgents.length > 0;
    fab.classList.toggle('tray', showTray);
    if (showTray) {
      renderTrayContent(trayAgents);
      fab.removeAttribute('tabindex');
      fab.setAttribute('role', 'region');
      fab.setAttribute('aria-label', `Running agents (${trayAgents.length})`);
    } else {
      renderPinContent();
      fab.setAttribute('tabindex', '0');
      fab.setAttribute('role', 'button');
      fab.setAttribute('aria-label', 'Pinagent — pick an element');
    }
    // Pin and panel have very different sizes; re-anchor to the same corner
    // so the swap doesn't push the surface off-screen near an edge.
    snapFabToCorner(currentCorner);
  }

  const tray = createAgentTray({
    fetchFeedback: () =>
      fetch(ENDPOINT, { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => (Array.isArray(d) ? (d as RawFeedback[]) : [])),
    subscribeProject: (cb) => wsClient.subscribeProject(cb),
    render: (agents) => {
      trayAgents = agents;
      applyFabPresentation();
    },
  });
  // Compose the initial pin (title + chip) and kick off the fetch/subscribe.
  applyFabPresentation();
  tray.start();

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
