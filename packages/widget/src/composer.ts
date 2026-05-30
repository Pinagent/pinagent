// SPDX-License-Identifier: Apache-2.0
import { composerHTML, ICON_STOP, ICON_X } from './composer-html';
import { wireComposerIframe } from './composer-iframe';
import {
  AUTO_CLOSE_MS,
  BUBBLE_SIZE,
  COMPOSER_H,
  ENDPOINT,
  IFRAME_W,
  MAX_TA_H,
  MIN_TA_H,
  MINI_H,
  STREAM_H,
} from './constants';
import type { Click, PickExtra, WidgetContext } from './context';
import { getBrowserDb } from './db/client';
import type { PendingRow } from './db/reads';
import { deleteConversation } from './db/writes';
import { openConversationInDock } from './dock-bridge';
import { pickNextActive } from './keyboard';
import { quickActionsFor } from './quick-actions';
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
import type {
  AgentState,
  Composer,
  ComposerMeta,
  ExtraAnchor,
  InstanceInfo,
  QueuedNodeRef,
} from './types';

/**
 * Composer lifecycle: creating the per-element feedback widget (iframe +
 * bubble + drag handle + pointer tail), wiring its pre-submit form and
 * post-submit stream pane, and tracking which composer is expanded.
 *
 * Reads/writes `ctx.composers` and `ctx.expandedComposer`; reaches the
 * picker (enter/exit) and FAB/tray (toast) through `ctx`.
 */
export function createComposerController(ctx: WidgetContext): {
  open(target: Element, click: Click, extras?: PickExtra[]): void;
  addNodeToComposer(composer: Composer, target: Element, click: Click, extras?: PickExtra[]): void;
  restore(row: PendingRow): void;
  swapTo(c: Composer): void;
  hopToNextActive(): void;
  bubbleOwner(el: HTMLElement): Composer | null;
} {
  function bubbleOwner(el: HTMLElement): Composer | null {
    for (const c of ctx.composers) {
      if (c.bubble === el) return c;
    }
    return null;
  }

  function swapTo(composer: Composer) {
    if (composer.expanded) return;
    if (ctx.expandedComposer && ctx.expandedComposer !== composer) {
      ctx.expandedComposer.minimize();
    }
    composer.expand();
    ctx.expandedComposer = composer;
  }

  /**
   * Cycle to the next composer with an in-flight agent run. Lets the
   * user keep tabs on multiple concurrent agents without hunting
   * bubbles by hand. Iteration order is insertion-order (the Set
   * preserves it). Wraps around. No-op if there's 0 or 1 active.
   */
  function hopToNextActive() {
    const active = Array.from(ctx.composers).filter(
      (c) => c.agentState === 'running' || c.agentState === 'pending',
    );
    const next = pickNextActive(active, ctx.expandedComposer);
    if (next) swapTo(next);
  }

  function open(target: Element, click: Click, extras: PickExtra[] = []) {
    if (ctx.expandedComposer) {
      ctx.expandedComposer.minimize();
    }
    const composer = createComposer(target, click, extras);
    ctx.composers.add(composer);
    ctx.expandedComposer = composer;
  }

  /**
   * Add a freshly-picked element to a running conversation as a queued
   * follow-up (text location only — no screenshot, so it rides the
   * existing `user_message` frame). Resolves the same loc/selector/
   * component context `createComposer` does, folds it into a short
   * message, and hands it to the live stream handler's enqueue. Expands
   * the conversation so the user sees the queued item land.
   */
  function addNodeToComposer(
    composer: Composer,
    target: Element,
    _click: Click,
    _extras: PickExtra[] = [],
  ): void {
    if (!composer.feedbackId || !composer.enqueueFollowUp) {
      ctx.toast('Conversation not ready yet', 'error');
      return;
    }
    const loc = findLoc(target);
    const selector = shortSelector(target);
    const component = componentOf(target);
    const tag = target.tagName.toLowerCase();
    const node: QueuedNodeRef = {
      file: loc?.file ?? null,
      line: loc?.line ?? null,
      col: loc?.col ?? null,
      selector,
      component,
      tag,
    };
    const where = loc ? `${loc.file}:${loc.line}:${loc.col}` : selector;
    const inComp = component ? ` in <${component}>` : '';
    const content = `Also look at this <${tag}>${inComp} (${where}).`;
    composer.enqueueFollowUp(content, node);
    swapTo(composer);
  }

  /**
   * Restoration entry — pull a pending conversation from the cache
   * back into the UI as a minimized bubble. If the target element
   * can't be located (DOM changed since the conversation was
   * created), we skip it. The user can still find the agent run on
   * the server via the markdown log; we just don't surface a bubble
   * with no anchor.
   */
  function restore(row: PendingRow): void {
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
    for (const c of ctx.composers) {
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
    ctx.composers.add(composer);
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

  function createComposer(target: Element, click: Click, extras: PickExtra[] = []): Composer {
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

    // Dismiss/archive control — only shown alongside the anchor-lost dot.
    // The orphaned dot is otherwise a dead end (its target is gone), so
    // this gives the user an explicit way to archive the pin and clear it
    // off the page. Lives in document.body next to the bubble so it tracks
    // the same page coords through scroll/layout.
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'pa-anchor-lost-dismiss';
    dismissBtn.type = 'button';
    dismissBtn.textContent = '✕';
    dismissBtn.title = 'Archive — remove this pin';
    dismissBtn.hidden = true;
    document.body.appendChild(dismissBtn);

    // Floating-bubble action row (viewState: 'bubble'). Same affordances
    // as the minimal bar — stop while running, cancel (stop + dismiss)
    // always — revealed on hover of the dot or the row. Lives in
    // document.body next to the bubble so reposition() can track it.
    const bubbleActions = document.createElement('div');
    bubbleActions.className = 'pa-bubble-actions';
    bubbleActions.hidden = true;
    const baStop = document.createElement('button');
    baStop.className = 'pa-ba-btn';
    baStop.type = 'button';
    baStop.title = 'Stop the agent';
    baStop.setAttribute('aria-label', 'Stop the agent');
    baStop.innerHTML = ICON_STOP;
    const baCancel = document.createElement('button');
    baCancel.className = 'pa-ba-btn danger';
    baCancel.type = 'button';
    baCancel.title = 'Cancel — stop and dismiss';
    baCancel.setAttribute('aria-label', 'Cancel — stop and dismiss');
    baCancel.innerHTML = ICON_X;
    bubbleActions.appendChild(baStop);
    bubbleActions.appendChild(baCancel);
    document.body.appendChild(bubbleActions);

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
      // Stop only makes sense while the agent is in flight; cancel stays.
      baStop.hidden = !(next === 'running' || next === 'pending');
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
            composer.reviewingLost = false;
            bubble.classList.remove('anchor-lost');
            bubble.removeAttribute('title');
          }
        } else if (!composer.anchorLost) {
          composer.anchorLost = true;
          bubble.classList.add('anchor-lost');
          bubble.title = 'Anchor lost — element removed. Click to open the conversation.';
        }
      } else if (composer.anchorLost) {
        composer.anchorLost = false;
        composer.reviewingLost = false;
        bubble.classList.remove('anchor-lost');
        bubble.removeAttribute('title');
      }

      const r = composer.target.getBoundingClientRect();
      // Anchor = where the user clicked, expressed in document coords.
      // Moves with the target as it scrolls/layout-shifts.
      const anchorDocX = r.left + window.scrollX + relX;
      const anchorDocY = r.top + window.scrollY + relY;
      // Anchor in viewport coords (used to decide above/below placement
      // and whether the anchor has scrolled out of view).
      const anchorViewportY = r.top + relY;
      const anchorViewportX = r.left + relX;

      // Dot (floating bubble) shows in three cases:
      //  - anchor lost (existing fallback — no live element to pin to),
      //  - the user explicitly collapsed to the bubble (viewState),
      //  - the anchored element scrolled out of view while minimal.
      // Expanded stays put even off-screen (the user opened it on purpose).
      const anchorLostDot = composer.anchorLost && !!composer.feedbackId && !composer.reviewingLost;
      const offScreen =
        !!composer.feedbackId &&
        (anchorViewportY < 0 ||
          anchorViewportY > window.innerHeight ||
          anchorViewportX < 0 ||
          anchorViewportX > window.innerWidth);
      const offScreenDot = offScreen && composer.viewState === 'minimal';
      const showDot = anchorLostDot || composer.viewState === 'bubble' || offScreenDot;
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
      // shows where the widget is/was). When the dot is showing because
      // the anchor scrolled off-screen, clamp it to the viewport edges so
      // it stays reachable instead of scrolling away with the anchor.
      let bubbleTop = iframeTop - BUBBLE_SIZE / 2;
      let bubbleLeft = iframeLeft - BUBBLE_SIZE / 2;
      if (offScreenDot && !anchorLostDot) {
        bubbleTop = Math.max(
          window.scrollY + 8,
          Math.min(window.scrollY + window.innerHeight - BUBBLE_SIZE - 8, bubbleTop),
        );
        bubbleLeft = Math.max(
          window.scrollX + 8,
          Math.min(window.scrollX + window.innerWidth - BUBBLE_SIZE - 8, bubbleLeft),
        );
      }
      bubble.style.top = `${bubbleTop}px`;
      bubble.style.left = `${bubbleLeft}px`;

      // Dismiss button: nestled at the bubble's upper-right corner so it
      // reads as an "x to remove" affordance on the orphaned dot.
      const DISMISS_SIZE = 16;
      dismissBtn.style.top = `${bubbleTop - DISMISS_SIZE / 2}px`;
      dismissBtn.style.left = `${bubbleLeft + BUBBLE_SIZE - DISMISS_SIZE / 2}px`;

      // Bubble action row: tucked just under the dot, left-aligned with it.
      bubbleActions.style.top = `${bubbleTop + BUBBLE_SIZE + 4}px`;
      bubbleActions.style.left = `${bubbleLeft}px`;

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
      // Archive control is for the orphaned (anchor-lost) dot only; the
      // deliberate bubble/off-screen dot uses the hover action row instead.
      dismissBtn.hidden = !anchorLostDot;
      // The stop/cancel action row rides the non-orphaned dot.
      bubbleActions.hidden = !showDot || anchorLostDot;
      if (bubbleActions.hidden) bubbleActions.classList.remove('show');
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
      reviewingLost: false,
      userOffsetX: 0,
      userOffsetY: 0,
      turn: 0,
      agentState: 'pending',
      expanded: true,
      viewState: 'expanded',
      needsInput: false,
      streamFitH: null,
      followUpQueue: [],
      autoCloseTimer: null,
      close() {
        // User-initiated dismissal — drop from cache so it doesn't
        // come back on the next reload. Markers (status='fixed') would
        // also suppress restoration, but the user explicitly said
        // "go away" so we don't keep their transcript around either.
        composer.cancelAutoClose();
        if (composer.feedbackId) {
          ctx.wsClient.unsubscribe(composer.feedbackId);
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
        dismissBtn.remove();
        bubbleActions.remove();
        dragHandle.remove();
        pointer.remove();
        ctx.composers.delete(composer);
        if (ctx.expandedComposer === composer) ctx.expandedComposer = null;
      },
      expand() {
        composer.expanded = true;
        composer.viewState = 'expanded';
        // Reading the conversation cancels any pending completion auto-close.
        composer.cancelAutoClose();
        // Chrome first (it toggles `.follow`/`.header-block` visibility),
        // then refit so a measured loading-gap fit reflects the right
        // chrome; refitStream applies the height + repositions.
        applyMiniChrome();
        composer.refitStream();
      },
      minimize() {
        // Minimized = the single-line minimal bar, NOT a hidden iframe.
        // The iframe stays visible at MINI_H with `body.mini` toggled on;
        // reposition() decides iframe-vs-dot visibility. Multiple minimal
        // bars can coexist (one per anchored agent) — only the *full*
        // expanded composer is tracked by expandedComposer.
        composer.expanded = false;
        composer.viewState = 'minimal';
        applyMiniChrome();
        composer.refitStream();
        if (ctx.expandedComposer === composer) ctx.expandedComposer = null;
      },
      toBubble() {
        // Collapse to the floating status dot. The iframe stays in the DOM
        // (body.mini chrome applied) but reposition() hides it in favour of
        // the bubble while viewState is 'bubble'.
        composer.expanded = false;
        composer.viewState = 'bubble';
        applyMiniChrome();
        composer.refitStream();
        reposition();
        if (ctx.expandedComposer === composer) ctx.expandedComposer = null;
      },
      scheduleAutoClose() {
        // Tidy a finished conversation that's still collapsed. No-op while
        // expanded (the user is reading) or when a timer is already armed.
        if (composer.viewState === 'expanded') return;
        if (composer.autoCloseTimer != null) return;
        composer.autoCloseTimer = setTimeout(() => {
          composer.autoCloseTimer = null;
          composer.close();
        }, AUTO_CLOSE_MS);
      },
      cancelAutoClose() {
        if (composer.autoCloseTimer != null) {
          clearTimeout(composer.autoCloseTimer);
          composer.autoCloseTimer = null;
        }
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
      // Expanding clears the attention state (the answer form is now
      // visible); minimizing re-applies it when a question is still
      // pending, so the collapsed bar shows the alert + answer icon
      // rather than a stop icon for a not-actually-running agent.
      idoc.body.classList.toggle('needs-input', !composer.expanded && composer.needsInput);
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
      // When the anchor is lost, try to re-anchor first — if the element
      // came back (HMR / re-render), reconnect to it and expand as usual.
      if (composer.anchorLost) {
        if (tryReanchor(composer)) {
          composer.anchorLost = false;
          composer.reviewingLost = false;
          bubble.classList.remove('anchor-lost');
          bubble.removeAttribute('title');
          reposition();
          return;
        }
        // Re-anchor failed — the element is genuinely gone. Rather than
        // leaving a dead checkmark dot, route the user to the
        // conversation: into the dock if it's mounted, otherwise re-show
        // the composer card inline (positioned at the detached target's
        // last rect; the user can drag it). The dismiss button on the dot
        // remains the archive path.
        if (composer.feedbackId) {
          if (ctx.dockEnabled) {
            openConversationInDock(composer.feedbackId);
            ctx.openDock?.();
          } else {
            composer.reviewingLost = true;
            composer.expanded = true;
            reposition();
          }
        }
        return;
      }
      swapTo(composer);
    });

    // Archive the orphaned pin and remove it from the page. Fire-and-forget
    // PATCH (same archive endpoint the tray's Clear uses); close() handles
    // the local teardown regardless of the request outcome.
    dismissBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (composer.feedbackId) {
        void fetch(`${ENDPOINT}/${composer.feedbackId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ archived: true }),
        }).catch(() => ctx.toast('Couldn’t archive', 'error'));
      }
      composer.close();
    });

    // Bubble action row (viewState: 'bubble' / off-screen dot). Reveal on
    // hover/focus of either the dot or the row, with a short hide delay so
    // the pointer can cross the gap. Mirrors the extras-popover pattern.
    let baHideTimer: ReturnType<typeof setTimeout> | null = null;
    function showBubbleActions() {
      if (bubbleActions.hidden) return;
      if (baHideTimer) {
        clearTimeout(baHideTimer);
        baHideTimer = null;
      }
      bubbleActions.classList.add('show');
    }
    function scheduleHideBubbleActions() {
      if (baHideTimer) clearTimeout(baHideTimer);
      baHideTimer = setTimeout(() => bubbleActions.classList.remove('show'), 160);
    }
    bubble.addEventListener('mouseenter', showBubbleActions);
    bubble.addEventListener('mouseleave', scheduleHideBubbleActions);
    bubbleActions.addEventListener('mouseenter', showBubbleActions);
    bubbleActions.addEventListener('mouseleave', scheduleHideBubbleActions);
    baStop.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (composer.feedbackId) ctx.wsClient.sendInterrupt(composer.feedbackId);
    });
    baCancel.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (composer.feedbackId) ctx.wsClient.sendInterrupt(composer.feedbackId);
      composer.close();
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
        ctx.root.appendChild(el);
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
      wireComposerIframe({
        ctx,
        composer,
        iframe,
        click,
        loc,
        selector,
        setAgentState,
        applyMiniChrome,
        swapTo,
        hopToNextActive,
      });
    });

    return composer;
  }

  return { open, addNodeToComposer, restore, swapTo, hopToNextActive, bubbleOwner };
}
