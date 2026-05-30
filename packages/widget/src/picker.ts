// SPDX-License-Identifier: Apache-2.0
import type { Click, WidgetContext } from './context';

/**
 * Element-picking session. While active, the cursor turns into the pin,
 * a hint banner shows, and mousemove highlights the element under the
 * pointer. A plain click commits the picked element to a new composer;
 * Cmd/Ctrl-click accumulates additional anchors first. The controller
 * owns the in-progress `pendingPicks` and the rAF that keeps their
 * outlines pinned through scroll/reflow.
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

  function enterPicking() {
    state.mode = 'picking';
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
      const owner = ctx.bubbleOwner(target as HTMLElement);
      if (owner) ctx.swapTo(owner);
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
    if (pendingPicks.length === 0) {
      hint.textContent = adding
        ? `Click an element to add it to the conversation. Esc to cancel.`
        : `Click an element. ${MOD_LABEL}-click to add more. Esc to cancel.`;
    } else {
      const n = pendingPicks.length;
      hint.textContent = `${n} selected. Click to ${adding ? 'add' : 'comment'}. ${MOD_LABEL}-click to add more. Esc to cancel.`;
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
