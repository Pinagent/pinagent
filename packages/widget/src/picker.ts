// SPDX-License-Identifier: Apache-2.0
import type { Click, RegionRect, WidgetContext } from './context';
import { setDockHidden } from './dock-bridge';
import { locAncestors } from './selector';

/** Minimum drawn size (px) for a region to count — guards stray clicks. */
const MIN_REGION_PX = 8;

/**
 * `document.elementFromPoint` that descends through open shadow roots. The
 * native call returns a shadow *host* for a click inside a web component's
 * shadow tree, so walking up from the host would resolve the wrong (outer)
 * `data-pa-loc` or none. Descend via each host's `shadowRoot.elementFromPoint`
 * to the real leaf the user clicked. Closed shadow roots can't be pierced
 * (`shadowRoot` is null) — we stop at the host, the best we can do. The depth
 * guard caps pathological nesting. (Cross-origin iframes remain opaque — their
 * document isn't reachable from the host page.)
 */
export function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  for (let depth = 0; el?.shadowRoot && depth < 20; depth++) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/**
 * Element-picking session. While active, the cursor turns into the pin,
 * a hint banner shows, and mousemove highlights the element under the
 * pointer. A plain click commits the picked element to a new composer;
 * Cmd/Ctrl-click accumulates additional anchors first. Pressing `R`
 * toggles a region-snip sub-mode where the user drags out a rectangle to
 * capture a specific section of the page; `Enter` commits the current
 * selection (handy for region-only snips). ↑/↓ walk the highlight up and
 * down the source-tagged ancestry so a parent element a descendant
 * visually covers (e.g. a `<nav>`/`<aside>`/`<div>` wrapping the `<a>`
 * under the cursor) can still be targeted. The controller owns the
 * in-progress `pending` selections (elements + regions), each tagged with
 * a 1-based order badge, and the rAF that keeps their outlines pinned
 * through scroll/reflow.
 */
export function createPicker(ctx: WidgetContext): {
  enterPicking(): void;
  exitPicking(): void;
} {
  const { state, fab, root, host, outline } = ctx;

  // A single pick session accumulates selections, each shown with a
  // gold "1, 2, 3…" order badge. Two kinds:
  //  - element: a Cmd/Ctrl-click on a source-tagged node.
  //  - region: a dragged-out rectangle (document coords) snipping a
  //    specific area of the page.
  // A plain click (or Enter) then commits the whole group. Cleared on exit.
  type PendingElement = {
    kind: 'element';
    target: Element;
    click: Click;
    outline: HTMLDivElement;
    badge: HTMLSpanElement;
  };
  type PendingRegion = {
    kind: 'region';
    rect: RegionRect; // document coords (CSS px incl. scroll)
    outline: HTMLDivElement;
    badge: HTMLSpanElement;
  };
  type PendingSelection = PendingElement | PendingRegion;
  const pending: PendingSelection[] = [];
  let pendingPicksRaf: number | null = null;
  const MOD_LABEL = ctx.isMac ? 'Cmd' : 'Ctrl';

  // Region-snip sub-mode. `regionMode` is the armed crosshair state (no
  // drag yet); `regionDrag` holds the in-progress rubber-band. `justDrew`
  // swallows the click that fires right after a drag's mouseup so it
  // doesn't also pick the element under the release point.
  let regionMode = false;
  let regionDrag: { startX: number; startY: number; el: HTMLDivElement } | null = null;
  let justDrew = false;

  // Ancestor walk for the current hover. `levels` is the navigable chain for
  // the element under the cursor — its raw target at index 0, then each
  // enclosing `data-pa-loc` element outward. ↑/↓ move `levelIndex` along it;
  // a mousemove rebuilds the chain and snaps back to the hovered element.
  let hoverBase: Element | null = null;
  let levels: Element[] = [];
  let levelIndex = 0;

  function buildLevels(base: Element): Element[] {
    const locs = locAncestors(base);
    // When the hovered element is itself tagged it's already locs[0]; otherwise
    // keep it as the bottom rung so a plain click still targets what's hovered.
    return locs[0] === base ? locs : [base, ...locs];
  }

  function currentTarget(): Element | null {
    return levels[levelIndex] ?? hoverBase;
  }

  function resetHover(): void {
    hoverBase = null;
    levels = [];
    levelIndex = 0;
  }

  function enterPicking() {
    state.mode = 'picking';
    resetHover();
    // Collapse the tray (if showing) back to the pin — picking owns the FAB.
    ctx.applyFabPresentation();
    fab.classList.add('active');
    document.documentElement.classList.add('pa-picking');

    // Hide the dock while picking so a fullscreen/floating dock — pressing
    // the pick hotkey from inside the open dock is a supported flow — can't
    // occlude the page being picked. Restored in `exitPicking`; hiding the
    // iframe element keeps the dock's React tree (and any reply draft)
    // alive, unlike closing it.
    setDockHidden(true);

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.dataset.pp = 'hint';
    root.appendChild(hint);
    updatePickHint();

    // Suspend pointer-events on the expanded composer iframe so clicks
    // pass through to the underlying page. Bubbles stay clickable so the
    // user can quickly swap to a minimized composer.
    if (ctx.expandedComposer) {
      ctx.expandedComposer.iframe.style.pointerEvents = 'none';
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onRegionDown, true);
    document.addEventListener('mousemove', onRegionMove, true);
    document.addEventListener('mouseup', onRegionUp, true);

    // Keep the persistent selection outlines pinned while the user keeps
    // picking — the page may scroll or reflow. Elements track their live
    // bounding box; regions are fixed in document coords and converted to
    // viewport coords each frame so they scroll with the page too.
    const tick = () => {
      for (const p of pending) {
        if (p.kind === 'element') positionElementOutline(p.outline, p.target);
        else positionRegionOutline(p.outline, p.rect);
      }
      pendingPicksRaf = requestAnimationFrame(tick);
    };
    pendingPicksRaf = requestAnimationFrame(tick);
  }

  function exitPicking() {
    state.mode = 'idle';
    // Clear any pending "add to conversation" routing — whether we
    // committed a pick or the user cancelled with Esc.
    ctx.pickRouteComposer = null;
    fab.classList.remove('active');
    document.documentElement.classList.remove('pa-picking');
    setRegionMode(false);
    if (regionDrag) {
      regionDrag.el.remove();
      regionDrag = null;
    }
    justDrew = false;
    outline.style.display = 'none';
    const hint = root.querySelector('[data-pp="hint"]');
    if (hint) hint.remove();
    if (ctx.expandedComposer) {
      ctx.expandedComposer.iframe.style.pointerEvents = 'auto';
    }
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onRegionDown, true);
    document.removeEventListener('mousemove', onRegionMove, true);
    document.removeEventListener('mouseup', onRegionUp, true);
    clearPending();
    resetHover();
    if (pendingPicksRaf !== null) {
      cancelAnimationFrame(pendingPicksRaf);
      pendingPicksRaf = null;
    }
    // Reveal the dock again (no-op if it wasn't open / was already hidden).
    setDockHidden(false);
    // Restore the tray if agents are still running.
    ctx.applyFabPresentation();
  }

  function onMove(e: MouseEvent) {
    // Clear the post-drag click-swallow latch once the pointer moves: a
    // drag that ends across elements fires no `click`, so we can't rely on
    // onPick to reset it — otherwise the next genuine pick gets eaten.
    justDrew = false;
    // The element highlight is meaningless while drawing a region.
    if (regionMode || regionDrag) return;
    const target = elementFromEvent(e);
    if (!target) return;
    // A fresh hover rebuilds the ancestor chain and snaps the highlight back
    // to the element under the cursor — moving the mouse cancels any ↑/↓ walk.
    hoverBase = target;
    levels = buildLevels(target);
    levelIndex = 0;
    drawOutline(target);
    updatePickHint();
  }

  function onPick(e: MouseEvent) {
    // Swallow the click synthesized right after a region drag's mouseup —
    // otherwise it would also pick the element under the release point.
    if (justDrew) {
      justDrew = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // While the crosshair is armed but no drag happened (a bare click in
    // region mode), don't pick an element — just disarm region mode.
    if (regionMode) {
      e.preventDefault();
      e.stopPropagation();
      setRegionMode(false);
      updatePickHint();
      return;
    }
    const raw = elementFromEvent(e);
    if (!raw) return;
    // Don't pick a bubble as the new target — bubbles are part of the
    // widget's own UI. Clicking a bubble during picker = expand that
    // composer instead.
    if (raw.classList.contains('pa-bubble')) {
      e.preventDefault();
      e.stopPropagation();
      exitPicking();
      const owner = ctx.bubbleOwner(raw as HTMLElement);
      if (owner) ctx.swapTo(owner);
      return;
    }
    // Don't pick the drag handle either — silently cancel picker so the
    // user can grab the handle they were aiming for.
    if (raw.classList.contains('pa-drag-handle')) {
      e.preventDefault();
      e.stopPropagation();
      exitPicking();
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    // Commit whatever the highlight currently sits on — the user may have
    // walked it up the ancestry with ↑/↓ since the last mousemove.
    const target = currentTarget() ?? raw;

    const additive = e.metaKey || e.ctrlKey;
    if (additive) {
      // Toggle: same element re-clicked with the modifier deselects.
      const existingIdx = pending.findIndex((p) => p.kind === 'element' && p.target === target);
      if (existingIdx >= 0) {
        const removed = pending.splice(existingIdx, 1)[0];
        removed?.outline.remove();
      } else {
        addPendingElement(target, { x: e.clientX, y: e.clientY });
      }
      renumber();
      updatePickHint();
      return;
    }

    // Plain click — commit with this element as the primary anchor.
    commit({ target, click: { x: e.clientX, y: e.clientY } });
  }

  /**
   * Commit the current selection. With a `primary` (plain click), that
   * element anchors the new composer and every pending element becomes an
   * extra. Without one (Enter — typically a region-only snip), the first
   * pending element anchors, or, failing that, the element under the first
   * region's centre. Pending regions ride along as snippet crops either
   * way. Snapshots everything before `exitPicking` clears it.
   */
  function commit(primary?: { target: Element; click: Click }): void {
    const elements = pending.filter((p): p is PendingElement => p.kind === 'element');
    const regions = pending
      .filter((p): p is PendingRegion => p.kind === 'region')
      .map((p) => p.rect);

    let anchorTarget: Element | null = null;
    let anchorClick: Click;
    let extraEls: PendingElement[];

    if (primary) {
      anchorTarget = primary.target;
      anchorClick = primary.click;
      extraEls = elements;
    } else if (elements[0]) {
      anchorTarget = elements[0].target;
      anchorClick = elements[0].click;
      extraEls = elements.slice(1);
    } else if (regions[0]) {
      // Region-only: anchor the composer to the element under the first
      // region's centre so positioning / re-anchor reuse the element path.
      const rg = regions[0];
      const vx = rg.x - window.scrollX + rg.w / 2;
      const vy = rg.y - window.scrollY + rg.h / 2;
      anchorTarget = elementFromPointSafe(vx, vy) ?? document.body;
      anchorClick = { x: vx, y: vy };
      extraEls = [];
    } else {
      // Nothing selected — nothing to commit.
      return;
    }
    if (!anchorTarget) return;

    const extras = extraEls.map((p) => ({ target: p.target, click: p.click }));
    const routeTo = ctx.pickRouteComposer;
    exitPicking();
    // Mid-conversation "add element" routing stays element-only — regions
    // are a fresh-composer concept (they crop the initial screenshot).
    if (routeTo) ctx.addNodeToComposer(routeTo, anchorTarget, anchorClick, extras);
    else ctx.openComposer(anchorTarget, anchorClick, extras, regions);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      // Esc first cancels an in-progress region (drag or armed crosshair)
      // so the user doesn't lose their other picks; a second Esc exits.
      if (regionDrag) {
        regionDrag.el.remove();
        regionDrag = null;
        setRegionMode(false);
        updatePickHint();
        return;
      }
      if (regionMode) {
        setRegionMode(false);
        updatePickHint();
        return;
      }
      exitPicking();
      return;
    }
    // `R` toggles region-snip mode: drag out a rectangle to capture a
    // specific area of the page as the screenshot, instead of an element.
    if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setRegionMode(!regionMode);
      updatePickHint();
      return;
    }
    // Enter commits the current selection — the path for region-only snips
    // (and any time the user would rather commit than plain-click).
    if (e.key === 'Enter' && pending.length > 0) {
      e.preventDefault();
      commit();
      return;
    }
    // ↑ walks the highlight to the enclosing tagged element, ↓ back toward the
    // hovered one. No-op until a hover has built a multi-level chain.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (levels.length <= 1) return;
      e.preventDefault();
      levelIndex =
        e.key === 'ArrowUp'
          ? Math.min(levelIndex + 1, levels.length - 1)
          : Math.max(levelIndex - 1, 0);
      const target = currentTarget();
      if (target) drawOutline(target);
      updatePickHint();
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

  function positionElementOutline(el: HTMLDivElement, target: Element): void {
    const r = target.getBoundingClientRect();
    el.style.top = `${r.top}px`;
    el.style.left = `${r.left}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }

  function positionRegionOutline(el: HTMLDivElement, rect: RegionRect): void {
    // Stored in document coords; convert to viewport so the fixed-position
    // outline tracks the page as it scrolls.
    el.style.top = `${rect.y - window.scrollY}px`;
    el.style.left = `${rect.x - window.scrollX}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
  }

  /** Create the gold order badge appended into a selection outline. */
  function makeBadge(): HTMLSpanElement {
    const badge = document.createElement('span');
    badge.className = 'selection-badge';
    return badge;
  }

  function addPendingElement(target: Element, click: Click): void {
    const ol = document.createElement('div');
    ol.className = 'selection-outline';
    const badge = makeBadge();
    ol.appendChild(badge);
    root.appendChild(ol);
    positionElementOutline(ol, target);
    pending.push({ kind: 'element', target, click, outline: ol, badge });
  }

  function addPendingRegion(rect: RegionRect): void {
    const ol = document.createElement('div');
    ol.className = 'selection-outline';
    const badge = makeBadge();
    ol.appendChild(badge);
    root.appendChild(ol);
    positionRegionOutline(ol, rect);
    pending.push({ kind: 'region', rect, outline: ol, badge });
  }

  /** Re-stamp every selection's order badge (1-based) after add/remove. */
  function renumber(): void {
    pending.forEach((p, i) => {
      p.badge.textContent = String(i + 1);
    });
  }

  function clearPending(): void {
    for (const p of pending) p.outline.remove();
    pending.length = 0;
  }

  // ---- Region-snip sub-mode ----------------------------------------

  function setRegionMode(on: boolean): void {
    regionMode = on;
    document.documentElement.classList.toggle('pa-region', on);
    // The element hover highlight has no meaning while snipping.
    if (on) outline.style.display = 'none';
  }

  function onRegionDown(e: MouseEvent): void {
    if (!regionMode || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.createElement('div');
    el.className = 'region-drawing';
    root.appendChild(el);
    regionDrag = { startX: e.clientX, startY: e.clientY, el };
    drawRegionDrag(e.clientX, e.clientY);
  }

  function onRegionMove(e: MouseEvent): void {
    if (!regionDrag) return;
    e.preventDefault();
    drawRegionDrag(e.clientX, e.clientY);
  }

  function onRegionUp(e: MouseEvent): void {
    if (!regionDrag) return;
    e.preventDefault();
    e.stopPropagation();
    const { startX, startY, el } = regionDrag;
    el.remove();
    regionDrag = null;
    const vx = Math.min(startX, e.clientX);
    const vy = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    // A click without a real drag disarms region mode; a real drag adds
    // the region and stays in element mode for further picks.
    if (w >= MIN_REGION_PX && h >= MIN_REGION_PX) {
      addPendingRegion({ x: vx + window.scrollX, y: vy + window.scrollY, w, h });
      renumber();
    }
    setRegionMode(false);
    justDrew = true; // swallow the click that follows this mouseup
    updatePickHint();
  }

  function drawRegionDrag(curX: number, curY: number): void {
    if (!regionDrag) return;
    const { startX, startY, el } = regionDrag;
    el.style.left = `${Math.min(startX, curX)}px`;
    el.style.top = `${Math.min(startY, curY)}px`;
    el.style.width = `${Math.abs(curX - startX)}px`;
    el.style.height = `${Math.abs(curY - startY)}px`;
  }

  /** elementFromPoint with the widget host hidden, mirroring elementFromEvent. */
  function elementFromPointSafe(x: number, y: number): Element | null {
    const prevHost = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    const target = deepElementFromPoint(x, y);
    host.style.pointerEvents = prevHost;
    if (!target || target === host) return null;
    return target;
  }

  function updatePickHint(): void {
    const hint = root.querySelector('[data-pp="hint"]');
    if (!hint) return;
    // "Add to conversation" mode reads differently — the pick joins a
    // running agent rather than starting a new comment.
    const adding = ctx.pickRouteComposer !== null;
    const n = pending.length;

    // Region-snip mode has its own instruction.
    if (regionMode) {
      hint.textContent =
        n > 0
          ? `Drag to snip a region (${n} selected). R or Esc to cancel.`
          : 'Drag to snip a region of the page. R or Esc to cancel.';
      return;
    }

    // Once the highlight is walked onto a parent, lead with which element the
    // click will actually target. Offer the ↑/↓ hint whenever a parent exists.
    const target = currentTarget();
    const prefix = levelIndex > 0 && target ? `<${target.tagName.toLowerCase()}> · ` : '';
    const climb = levels.length > 1 ? ' ↑/↓ for parent.' : '';
    if (n === 0) {
      hint.textContent = adding
        ? `${prefix}Click an element to add it to the conversation.${climb} R to snip a region. Esc to cancel.`
        : `${prefix}Click an element. ${MOD_LABEL}-click to add more · R to snip a region.${climb} Esc to cancel.`;
    } else {
      hint.textContent = `${prefix}${n} selected. Click to ${adding ? 'add' : 'comment'} · ${MOD_LABEL}-click or R to add more · ↵ to ${adding ? 'add' : 'comment'}.${climb} Esc to cancel.`;
    }
  }

  function elementFromEvent(e: MouseEvent): Element | null {
    // Hide the FAB / hint / outline (shadow host) and the expanded
    // composer iframe so document.elementFromPoint sees the page
    // underneath. Bubbles stay visible — clicking one is meaningful
    // (swap to that composer).
    const prevHost = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    const prevExpanded = ctx.expandedComposer?.expanded
      ? ctx.expandedComposer.iframe.style.pointerEvents
      : null;
    if (ctx.expandedComposer?.expanded) {
      ctx.expandedComposer.iframe.style.pointerEvents = 'none';
    }

    const target = deepElementFromPoint(e.clientX, e.clientY);

    host.style.pointerEvents = prevHost;
    if (ctx.expandedComposer?.expanded && prevExpanded !== null) {
      // Inside picker mode the expanded iframe is already suspended
      // (enterPicking sets none). Restoring here would briefly re-enable
      // it between events. Honor the suspended state for the picker
      // session by re-setting to 'none' if we're still picking.
      ctx.expandedComposer.iframe.style.pointerEvents =
        state.mode === 'picking' ? 'none' : prevExpanded;
    }
    if (!target) return null;
    if (target === host) return null;
    return target;
  }

  return { enterPicking, exitPicking };
}
