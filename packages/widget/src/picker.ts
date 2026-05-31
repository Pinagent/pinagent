// SPDX-License-Identifier: Apache-2.0
import type { Click, WidgetContext } from './context';
import { locAncestors } from './selector';

/**
 * Element-picking session. While active, the cursor turns into the pin,
 * a hint banner shows, and mousemove highlights the element under the
 * pointer. A plain click commits the picked element to a new composer;
 * Cmd/Ctrl-click accumulates additional anchors first. ↑/↓ walk the
 * highlight up and down the source-tagged ancestry so a parent element a
 * descendant visually covers (e.g. a `<nav>`/`<aside>`/`<div>` wrapping the
 * `<a>` under the cursor) can still be targeted. The controller owns the
 * in-progress `pendingPicks` and the rAF that keeps their outlines pinned
 * through scroll/reflow.
 */
export function createPicker(ctx: WidgetContext): {
  enterPicking(): void;
  exitPicking(): void;
} {
  const { state, fab, root, host, outline } = ctx;

  // Cmd-click (mac) / Ctrl-click (win/linux) accumulates targets during
  // a single pick session. A plain click then commits the whole group
  // (the plain-clicked element becomes the primary anchor; everything
  // queued here becomes the additional anchors). Cleared on exit.
  type PendingPick = { target: Element; click: Click; outline: HTMLDivElement };
  const pendingPicks: PendingPick[] = [];
  let pendingPicksRaf: number | null = null;
  const MOD_LABEL = ctx.isMac ? 'Cmd' : 'Ctrl';

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
    // Clear any pending "add to conversation" routing — whether we
    // committed a pick or the user cancelled with Esc.
    ctx.pickRouteComposer = null;
    fab.classList.remove('active');
    document.documentElement.classList.remove('pa-picking');
    outline.style.display = 'none';
    const hint = root.querySelector('[data-pp="hint"]');
    if (hint) hint.remove();
    if (ctx.expandedComposer) {
      ctx.expandedComposer.iframe.style.pointerEvents = 'auto';
    }
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('keydown', onKey, true);
    clearPendingPicks();
    resetHover();
    if (pendingPicksRaf !== null) {
      cancelAnimationFrame(pendingPicksRaf);
      pendingPicksRaf = null;
    }
    // Restore the tray if agents are still running.
    ctx.applyFabPresentation();
  }

  function onMove(e: MouseEvent) {
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

    // Plain click — commit. Snapshot pending picks (and the routing
    // target) before exitPicking wipes them. If a conversation requested
    // the pick (the "add element" action), route the element into it as a
    // queued follow-up; otherwise open a fresh composer.
    const extras = pendingPicks.map((p) => ({ target: p.target, click: p.click }));
    const routeTo = ctx.pickRouteComposer;
    exitPicking();
    const click = { x: e.clientX, y: e.clientY };
    if (routeTo) ctx.addNodeToComposer(routeTo, target, click, extras);
    else ctx.openComposer(target, click, extras);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      exitPicking();
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
    // "Add to conversation" mode reads differently — the pick joins a
    // running agent rather than starting a new comment.
    const adding = ctx.pickRouteComposer !== null;
    // Once the highlight is walked onto a parent, lead with which element the
    // click will actually target. Offer the ↑/↓ hint whenever a parent exists.
    const target = currentTarget();
    const prefix = levelIndex > 0 && target ? `<${target.tagName.toLowerCase()}> · ` : '';
    const climb = levels.length > 1 ? ' ↑/↓ for parent.' : '';
    if (pendingPicks.length === 0) {
      hint.textContent = adding
        ? `${prefix}Click an element to add it to the conversation.${climb} Esc to cancel.`
        : `${prefix}Click an element. ${MOD_LABEL}-click to add more.${climb} Esc to cancel.`;
    } else {
      const n = pendingPicks.length;
      hint.textContent = `${prefix}${n} selected. Click to ${adding ? 'add' : 'comment'}. ${MOD_LABEL}-click to add more.${climb} Esc to cancel.`;
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

    const target = document.elementFromPoint(e.clientX, e.clientY);

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
