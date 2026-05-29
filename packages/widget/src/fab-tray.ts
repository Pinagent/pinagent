// SPDX-License-Identifier: Apache-2.0
import { createAgentTray, type RawFeedback, shouldAutoExpand, type TrayAgent } from './agent-tray';
import { BRAND_CREAM } from './brand';
import { ENDPOINT, ICON_GRIP, ICON_MINIMIZE, STATUS_LABEL, trayRowMeta } from './constants';
import type { WidgetContext } from './context';
import { buildPinIcon } from './pin-icon';

/**
 * The floating action button and the running-agents tray it expands into.
 *
 * When unresolved agents exist the FAB becomes a draggable tray listing
 * each one with Open / Stop / Clear. With none (or while actively picking)
 * it collapses back to the pin. The `createAgentTray` controller owns the
 * data + coalescing; this half owns the DOM, the per-row actions, and the
 * drag/snap-to-corner behaviour shared by both presentations.
 */
export function createFabTray(ctx: WidgetContext): {
  applyFabPresentation(): void;
  start(): void;
} {
  const { fab, state, wsClient } = ctx;

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
  // User minimized the tray while agents are still running: collapse to
  // the pin (which then shows a running badge) instead of the panel. Held
  // in memory, not persisted — a reload returns to the expanded default.
  // Reset whenever a *new* agent appears or the list empties (see the tray
  // render callback) so "auto-expand on a new run" still holds.
  let minimized = false;

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
    // Minimized pin with agents behind it: a click re-expands the tray
    // rather than starting a pick.
    if (minimized && trayAgents.length > 0) {
      minimized = false;
      applyFabPresentation();
      return;
    }
    if (state.mode === 'picking') ctx.exitPicking();
    else if (state.mode === 'idle') ctx.enterPicking();
  });

  // Keyboard activation for the collapsed pin (role="button"). Disabled in
  // tray mode, where the inner buttons are individually focusable.
  fab.addEventListener('keydown', (e) => {
    if (fab.classList.contains('tray')) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (minimized && trayAgents.length > 0) {
      minimized = false;
      applyFabPresentation();
      return;
    }
    if (state.mode === 'picking') ctx.exitPicking();
    else if (state.mode === 'idle') ctx.enterPicking();
  });

  // Collapsed pin: the pick icon plus (when the dock is mounted) a small
  // chip teaching the ⌘⇧P dock shortcut. Decorative + pointer-events:none,
  // so a click on the chip falls through to the FAB → opens the picker.
  //
  // `hidden` carries the agents the user minimized away (empty when the
  // pin is collapsed for the ordinary no-agents reason). When present the
  // pin grows a count badge — and a pulse ring while any of them is still
  // working — so the developer can see at a glance that runs are live
  // behind the minimized pin, and a click re-expands the tray.
  function renderPinContent(hidden: TrayAgent[] = []) {
    fab.replaceChildren();
    fab.appendChild(buildPinIcon(26, BRAND_CREAM));

    const working = hidden.filter((a) => a.status === 'working').length;
    fab.classList.toggle('running', working > 0);

    if (hidden.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'fab-agent-badge';
      badge.textContent = String(hidden.length);
      badge.setAttribute('aria-hidden', 'true');
      fab.appendChild(badge);
      const label =
        working > 0
          ? `${hidden.length} agent${hidden.length === 1 ? '' : 's'} running — click to expand`
          : `${hidden.length} agent${hidden.length === 1 ? '' : 's'} — click to expand`;
      fab.title = label;
      fab.setAttribute('aria-label', label);
      return;
    }

    let title = ctx.hotkeyChar
      ? `Pinagent — press ${ctx.hotkeyChar.toUpperCase()} or click to pick · Shift+N to hop between active widgets`
      : 'Pinagent — pick an element';
    if (ctx.dockEnabled) {
      const dockShortcut = ctx.isMac ? '⌘⇧P' : 'Ctrl⇧P';
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
        ctx.toast('Couldn’t clear agent', 'error');
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
    if (ctx.dockEnabled) {
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
    // Collapse the tray back to the pin while agents keep running. The pin
    // then carries a count badge + pulse (see renderPinContent); a new run
    // or a click re-expands.
    const min = document.createElement('button');
    min.type = 'button';
    min.className = 'pa-tray-min';
    min.title = 'Minimize';
    min.setAttribute('aria-label', 'Minimize running-agents tray');
    min.innerHTML = ICON_MINIMIZE;
    min.addEventListener('click', (ev) => {
      ev.stopPropagation();
      minimized = true;
      applyFabPresentation();
    });
    // The tray replaces the pin, so keep a way to start a new pick.
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'pa-tray-pick';
    pick.title = 'Pick an element';
    pick.setAttribute('aria-label', 'Pick an element');
    pick.appendChild(buildPinIcon(15, BRAND_CREAM));
    pick.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (state.mode === 'picking') ctx.exitPicking();
      else ctx.enterPicking();
    });
    handle.append(grip, heading, min, pick);
    fab.appendChild(handle);

    const list = document.createElement('ul');
    list.className = 'pa-tray-list';
    for (const agent of agents) list.appendChild(buildAgentRow(agent));
    fab.appendChild(list);
  }

  function applyFabPresentation() {
    const hasAgents = state.mode !== 'picking' && trayAgents.length > 0;
    const showTray = hasAgents && !minimized;
    fab.classList.toggle('tray', showTray);
    if (showTray) {
      renderTrayContent(trayAgents);
      fab.removeAttribute('tabindex');
      fab.setAttribute('role', 'region');
      fab.setAttribute('aria-label', `Running agents (${trayAgents.length})`);
    } else {
      // Minimized-with-agents collapses to the pin but passes the hidden
      // agents through so it can show the running badge + pulse and its
      // own aria-label. The ordinary no-agents pin renders the picker hint.
      const hidden = hasAgents ? trayAgents : [];
      renderPinContent(hidden);
      fab.setAttribute('tabindex', '0');
      fab.setAttribute('role', 'button');
      if (hidden.length === 0) fab.setAttribute('aria-label', 'Pinagent — pick an element');
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
      // A newly-appeared agent (or the list emptying) returns the FAB to
      // its expanded default — minimize only suppresses the agents that
      // were present when the user collapsed, so "auto-expand on a new
      // run" still holds.
      const prevIds = new Set(trayAgents.map((a) => a.id));
      if (shouldAutoExpand(prevIds, agents)) minimized = false;
      trayAgents = agents;
      applyFabPresentation();
    },
  });

  function start() {
    // Compose the initial pin (title + chip) and kick off the fetch/subscribe.
    applyFabPresentation();
    tray.start();
  }

  return { applyFabPresentation, start };
}
