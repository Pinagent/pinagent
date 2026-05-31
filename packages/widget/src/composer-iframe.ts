// SPDX-License-Identifier: Apache-2.0
import { resolveDockEnabled } from './config';
import { ENDPOINT, MINI_H, STREAM_H } from './constants';
import type { Click, WidgetContext } from './context';
import { computeUnionCropRect } from './crop';
import { getBrowserDb } from './db/client';
import { getConversationMessages } from './db/reads';
import { recordConversationStart } from './db/writes';
import { isHopKey, shouldIgnoreHotkey } from './keyboard';
import { capturePageScreenshot } from './screenshot';
import type { PaLoc } from './selector';
import { attachStreamHandler } from './stream-handler';
import type { AgentState, Composer, LifecycleEls, ReplayMessage } from './types';

/**
 * Everything that needs the composer iframe's *internal* document: the
 * pre-submit form (textarea, quick-action chips, submit → POST), the dock
 * jump button, the "+N extras" popover, the open-in-editor link, the
 * Esc/hotkey/hop key handling, and — once submitted or restored — handing
 * the stream pane to `attachStreamHandler`.
 *
 * Split out of `createComposer` so the parent keeps just the host-document
 * scaffolding (iframe/bubble/handle/pointer + positioning). Called from the
 * iframe's `load` handler, so `iframe.contentDocument` is ready.
 */
export interface WireComposerArgs {
  ctx: WidgetContext;
  composer: Composer;
  iframe: HTMLIFrameElement;
  /** Where the user clicked, captured at pick time (persisted on submit). */
  click: Click;
  loc: PaLoc | null;
  selector: string;
  setAgentState: (s: AgentState) => void;
  /** Sync the iframe body's `mini` class + dismiss-button label. */
  applyMiniChrome: () => void;
  /** Expand this composer, minimizing whatever was expanded before. */
  swapTo: (c: Composer) => void;
  /** Cycle the expanded composer to the next in-flight agent. */
  hopToNextActive: () => void;
  /** Flash page outlines on the extra picked elements (hover the "+N" badge). */
  onExtrasHover: () => void;
  /** Clear the extra-element flash outlines. */
  onExtrasLeave: () => void;
  /** Report the textarea's natural height so the host can auto-grow the pane. */
  onTextareaHeight: (natural: number) => void;
}

export function wireComposerIframe(args: WireComposerArgs): void {
  const {
    ctx,
    composer: c,
    iframe,
    click,
    loc: loc2,
    selector: selector2,
    setAgentState: setAgentState2,
    applyMiniChrome,
    swapTo,
    hopToNextActive,
    onExtrasHover,
    onExtrasLeave,
    onTextareaHeight,
  } = args;

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
  // Minimal-bar action icons + the "add another element" picker button.
  // Optional (looked up loosely) so a future markup tweak can't hard-fail
  // the whole composer.
  const addNodeBtn = idoc.getElementById('pa-add-node') as HTMLButtonElement | null;
  const miniStop = idoc.getElementById('pa-mini-stop') as HTMLButtonElement | null;
  const miniAnswer = idoc.getElementById('pa-mini-answer') as HTMLButtonElement | null;
  const miniCollapse = idoc.getElementById('pa-mini-collapse') as HTMLButtonElement | null;
  const miniCancel = idoc.getElementById('pa-mini-cancel') as HTMLButtonElement | null;
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

  // --- Minimal-bar action icons -------------------------------------
  // All live inside the stream pane, so their clicks would otherwise
  // bubble to the expand-on-click handler above — stopPropagation keeps
  // each action distinct from "expand".
  miniStop?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (c.feedbackId) ctx.wsClient.sendInterrupt(c.feedbackId);
  });
  miniAnswer?.addEventListener('click', (e) => {
    e.stopPropagation();
    // The agent is blocked on a question; expanding surfaces the answer form.
    swapTo(c);
  });
  miniCollapse?.addEventListener('click', (e) => {
    e.stopPropagation();
    c.toBubble();
  });
  miniCancel?.addEventListener('click', (e) => {
    e.stopPropagation();
    // Cancel = stop the run AND dismiss the widget.
    if (c.feedbackId) ctx.wsClient.sendInterrupt(c.feedbackId);
    c.close();
  });

  // "Add another element" — enter the picker, routed back into THIS
  // conversation as a queued follow-up. Call the controller directly
  // rather than via postMessage: the composer iframe runs no scripts of
  // its own, so this handler executes in the host realm. A host→host
  // `postMessage` here lands with `event.source === window` (not
  // `iframe.contentWindow`), which the message guard in composer.ts
  // rejects — silently dropping the pick. `ctx` + `c` are already in
  // scope, so the hop was never needed.
  addNodeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.pickRouteComposer = c;
    ctx.enterPicking();
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
      onExtrasHover();
      showPop();
    });
    extrasBadge.addEventListener('mouseleave', () => {
      onExtrasLeave();
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
    if (ctx.hotkeyChar && e.key.toLowerCase() === ctx.hotkeyChar && !shouldIgnoreHotkey(e)) {
      e.preventDefault();
      if (ctx.state.mode === 'picking') ctx.exitPicking();
      else ctx.enterPicking();
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
        ctx.wsClient,
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

  // Auto-grow: measure the textarea's natural scrollHeight after each
  // input and hand it to the host, which clamps + applies it to
  // iframe.style.height. The textarea is `flex: 1`, so it fills the pane
  // (and thus the iframe) — measuring scrollHeight as-is reports that
  // flex-filled height, which then grows the iframe, which re-fills the
  // textarea, looping unbounded on every keystroke. Drop out of flex to
  // an auto height for the measure so scrollHeight reflects the CONTENT,
  // then restore. (The standard 0-then-restore trick alone doesn't work
  // here: flex-grow overrides the inline height.)
  let lastReported = -1;
  const postTextareaHeight = () => {
    const prevFlex = ta.style.flex;
    const prevHeight = ta.style.height;
    ta.style.flex = '0 0 auto';
    ta.style.height = 'auto';
    const natural = ta.scrollHeight;
    ta.style.flex = prevFlex;
    ta.style.height = prevHeight;
    if (natural !== lastReported) {
      lastReported = natural;
      onTextareaHeight(natural);
    }
  };

  ta.addEventListener('input', () => {
    submit.disabled = ta.value.trim().length === 0;
    postTextareaHeight();
  });
  ta.addEventListener('keydown', (e) => {
    // Plain Enter submits; Shift+Enter (or Cmd/Ctrl+Enter) inserts a
    // newline for multi-line prompts. Matches the "↵ submit" hint
    // shown in the composer footer.
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
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
          node !== ctx.host &&
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
        const miniLabel = idoc.getElementById('pa-mini-label');
        if (miniLabel) miniLabel.textContent = 'Starting…';
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
          ctx.wsClient,
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
        ctx.toast('Sent', 'success');
        c.close();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.toast(`Error: ${msg}`, 'error');
      submit.disabled = false;
      submit.textContent = 'Submit';
    }
  });
}
