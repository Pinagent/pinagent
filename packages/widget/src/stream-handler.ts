// SPDX-License-Identifier: Apache-2.0
import { isNotionalCost, isUntrackedCost, type WorktreeWireState } from '@pinagent/shared';
import { getBrowserDb } from './db/client';
import {
  deleteConversationMessages,
  markConversationResolved,
  recordEvent,
  recordUserMessage,
} from './db/writes';
import type {
  AgentEvent,
  AgentState,
  Composer,
  LifecycleEls,
  QueuedFollowUp,
  QueuedNodeRef,
  ReplayMessage,
} from './types';
import type { WidgetWsClient } from './ws-client';

export function attachStreamHandler(
  client: WidgetWsClient,
  idoc: Document,
  composer: Composer,
  setAgentState: (s: AgentState) => void,
  header: HTMLElement,
  log: HTMLElement,
  footer: HTMLElement,
  stopBtn: HTMLButtonElement,
  followInput: HTMLTextAreaElement,
  followSend: HTMLButtonElement,
  lifecycle: LifecycleEls,
  /**
   * Historical messages to replay before going live. Restoration on
   * reload uses this to repopulate the stream pane from the browser
   * cache. Replayed events are NOT re-persisted (they're already in
   * the DB).
   */
  replayed?: ReplayMessage[],
): void {
  if (!composer.feedbackId) return;
  const feedbackId = composer.feedbackId;
  // The single-line minimal bar's label mirrors the expanded header text.
  const miniLabel = idoc.getElementById('pa-mini-label');
  // Set the status text on both surfaces at once — the expanded header and
  // the minimal bar — so they never drift.
  function setStatus(text: string) {
    header.textContent = text;
    if (miniLabel) miniLabel.textContent = text;
  }
  let activeTextBlock: HTMLElement | null = null;
  let lastToolChip: HTMLElement | null = null;
  // Human-readable label of the most recent tool call, reused for the
  // mini-card tooltip on both tool_use (running) and tool_result (done).
  let lastToolLabel: string | null = null;
  let pendingAskId: string | null = null;
  let pendingAskFormRoot: HTMLElement | null = null;
  let apiKeySource: string | null = null;
  let turnRunning = true;
  // Live turn count from `progress` events, shown in the footer while a
  // run is in flight. Overwritten by the authoritative `numTurns` on
  // `result`; reset at the start of each run.
  let liveTurns = 0;
  let worktreeState: WorktreeWireState = 'none';
  // Last known uncommitted-file count for this worktree, surfaced by the
  // server in the `worktree_state` broadcast. `null` means unknown
  // (server couldn't run `git status`, or the worktree is gone) — the
  // label omits the count rather than showing a misleading "0 changes".
  let worktreeChanges: number | null = null;

  // Browser-cache writes (recordEvent, and the reconnect delete) run
  // through one serial chain so a reconnect's "wipe this conversation's
  // messages" can't race the replay's re-inserts: the delete is enqueued
  // before the replayed events, so it always lands first and the replay
  // rebuilds exactly one copy.
  let dbWriteChain: Promise<unknown> = Promise.resolve();
  function queueDbWrite(run: () => Promise<unknown>): void {
    dbWriteChain = dbWriteChain
      .catch(() => {})
      .then(run)
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[pinagent:db] cache write failed:', err);
      });
  }

  function setStopVisible(visible: boolean) {
    stopBtn.hidden = !visible;
  }
  setStopVisible(true);

  // Header "thinking" spinner — visible whenever a turn is in flight,
  // including the gap between submit and the first event. CSS picks
  // it up from the `.running` class via a ::before pseudo-element,
  // which survives `header.textContent = ...` updates.
  function setHeaderRunning(running: boolean) {
    if (running) header.classList.add('running');
    else header.classList.remove('running');
    // Land/Discard are gated on `!turnRunning`; refresh the row so the
    // buttons disable as soon as a new turn starts and re-enable the
    // moment one ends, without each call site having to know about
    // lifecycle state.
    renderLifecycle();
  }
  setHeaderRunning(true);

  // The left footer button is "Stop" while a turn is in flight and
  // "Dismiss" once it's terminal — giving an on-screen way to remove a
  // finished conversation now that the right button is a Minimize/
  // Expand toggle (wired in wireComposerIframe). showDismiss() flips it
  // to the terminal mode.
  stopBtn.addEventListener('click', () => {
    if (turnRunning) {
      client.sendInterrupt(feedbackId);
      stopBtn.disabled = true;
      stopBtn.textContent = 'Stopping…';
      return;
    }
    composer.close();
  });

  function showDismiss() {
    stopBtn.disabled = false;
    stopBtn.textContent = 'Dismiss';
    setStopVisible(true);
  }

  function el(tag: string, className?: string, text?: string): HTMLElement {
    const node = idoc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function append(node: HTMLElement) {
    // First real transcript node ends the loading gap: it both reveals the
    // log (`.log:empty` no longer matches) and restores the iframe to its
    // normal height. refitStream is a cheap no-op once the log is non-empty.
    const wasEmpty = !log.firstChild;
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    if (wasEmpty) composer.refitStream();
  }

  // Mini-card activity affordance. When minimized the user can't watch
  // the transcript scroll, so each new tool activity (a) sets a tooltip
  // on the card with the current action and (b) briefly pulses the card
  // border. The pulse is a one-shot CSS animation; removing the class on
  // `animationend` lets the next activity re-trigger it.
  const card = idoc.querySelector('.card') as HTMLElement | null;
  idoc.body.addEventListener('animationend', (e) => {
    if (e.animationName === 'pa-activity-pulse') idoc.body.classList.remove('activity');
  });
  function noteActivity(label: string) {
    if (card) card.title = label;
    if (!composer.expanded) idoc.body.classList.add('activity');
  }

  // Enclosing-component + loop-instance context (from #166), surfaced in
  // the stream pane as two spans:
  //  - `.sc-comp` (`in <Component>`) mirrors what the expanded
  //    header-block shows, for when that block is hidden in the mini
  //    card; CSS hides it again when expanded to avoid duplication.
  //  - `.sc-instance` (`item N of M`) is shown in both states — the
  //    loop instance isn't surfaced anywhere else in the UI.
  // Populated once; the anchor is fixed for the conversation's life.
  (function renderStreamContext() {
    const ctx = idoc.getElementById('pa-stream-context');
    if (!ctx) return;
    let any = false;
    if (composer.component) {
      const comp = el('span', 'sc-comp', `in <${composer.component}>`);
      if (composer.componentPath.length > 1) comp.title = composer.componentPath.join(' › ');
      ctx.appendChild(comp);
      any = true;
    }
    if (composer.instance && composer.instance.total > 1) {
      // 0-based index → human "item N of M".
      ctx.appendChild(
        el(
          'span',
          'sc-instance',
          `item ${composer.instance.index + 1} of ${composer.instance.total}`,
        ),
      );
      any = true;
    }
    ctx.hidden = !any;
  })();

  // The follow-up box stays usable while a turn is in flight — typing then
  // *queues* rather than being blocked. It's only truly disabled while the
  // agent is waiting on a direct answer (an unanswered ask_user), which
  // must be answered through the ask form, not the queue. The `enabled`
  // argument is retained for call-site compatibility but the real gate is
  // `pendingAskId`.
  function setFollowEnabled(_enabled: boolean) {
    const blocked = !!pendingAskId;
    followInput.disabled = blocked;
    followSend.disabled = blocked || followInput.value.trim().length === 0;
    followInput.placeholder = blocked
      ? 'Answer the question above to continue.'
      : turnRunning
        ? 'Queue a follow-up…'
        : 'Send a follow-up…';
  }

  function renderAskUserForm(askId: string, question: string, options?: string[]) {
    if (pendingAskFormRoot) pendingAskFormRoot.remove();
    pendingAskId = askId;
    // Record on the composer so minimizing mid-question re-surfaces the
    // attention state (see applyMiniChrome).
    composer.needsInput = true;

    const wrap = el('div', 'ask-form');
    wrap.appendChild(el('div', 'ask-question', question));

    if (options && options.length > 0) {
      const opts = el('div', 'ask-options');
      for (const o of options) {
        const btn = el('button', 'ask-option') as HTMLButtonElement;
        btn.type = 'button';
        btn.textContent = o;
        btn.addEventListener('click', () => submitAnswer(o));
        opts.appendChild(btn);
      }
      wrap.appendChild(opts);
    }

    const row = el('div', 'ask-row');
    const ta = el('textarea', 'ask-input') as HTMLTextAreaElement;
    ta.placeholder = 'Type your answer…';
    ta.rows = 2;
    const sendBtn = el('button', 'btn primary') as HTMLButtonElement;
    sendBtn.type = 'button';
    sendBtn.textContent = 'Send';
    sendBtn.disabled = true;
    ta.addEventListener('input', () => {
      sendBtn.disabled = ta.value.trim().length === 0;
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) sendBtn.click();
      }
    });
    sendBtn.addEventListener('click', () => {
      const answer = ta.value.trim();
      if (!answer) return;
      submitAnswer(answer);
    });
    row.appendChild(ta);
    row.appendChild(sendBtn);
    wrap.appendChild(row);

    pendingAskFormRoot = wrap;
    append(wrap);
    setTimeout(() => ta.focus(), 0);
    setFollowEnabled(false);

    function submitAnswer(answer: string) {
      client.sendAskResponse(askId, answer);
      const replaced = el('div', 'ask-resolved');
      replaced.appendChild(el('div', 'ask-question', question));
      replaced.appendChild(el('div', 'ask-answer', answer));
      wrap.replaceWith(replaced);
      pendingAskFormRoot = null;
      pendingAskId = null;
      composer.needsInput = false;
      idoc.body.classList.remove('needs-input');
      setFollowEnabled(!turnRunning);
      // Answering resumes the turn; drain any follow-ups queued behind it.
      if (composer.followUpQueue.length > 0) flushQueue();
    }
  }

  // --- Client-side follow-up queue ------------------------------------
  // The server rejects a `user_message` while a turn is in flight, so
  // typed follow-ups (and elements picked mid-run) are held here and
  // flushed one-per-turn-end, FIFO. The queue itself lives on `composer`
  // (so it survives reconnects); `queuedNodes` is the parallel list of
  // rendered "pending" bubbles, which do NOT survive an onReset wipe — on
  // a mismatch the flush just appends a fresh committed bubble instead.
  const queuedNodes: HTMLElement[] = [];
  // The item the optimistic send put on the wire, kept so a "turn already
  // in progress" race can re-queue it rather than drop it.
  let lastSent: QueuedFollowUp | null = null;

  // Render a queued (not-yet-sent) follow-up: a dimmed bubble with a
  // "queued" tag, plus an element pill when it carries a picked node.
  function renderQueued(item: QueuedFollowUp): HTMLElement {
    const node = el('div', 'user-msg pending');
    node.appendChild(el('span', 'queued-tag', 'queued'));
    if (item.node) node.appendChild(el('span', 'q-pill', `<${item.node.tag}>`));
    node.appendChild(idoc.createTextNode(item.content));
    append(node);
    return node;
  }

  // Actually put a follow-up on the wire and flip the UI to running.
  // `pendingNode`, when present, is the queued bubble being promoted to a
  // committed one (drop the `.pending` styling rather than append a dup).
  function sendFollowUp(item: QueuedFollowUp, pendingNode: HTMLElement | null) {
    // Bump turn BEFORE recording — every event from this point until the
    // next user message belongs to the new turn.
    composer.turn += 1;
    const db = getBrowserDb();
    if (db) {
      void recordUserMessage(db, feedbackId, composer.turn, item.content).catch((err) =>
        // eslint-disable-next-line no-console
        console.warn('[pinagent:db] recordUserMessage failed:', err),
      );
    }
    lastSent = item;
    client.sendUserMessage(feedbackId, item.content);
    if (pendingNode) pendingNode.classList.remove('pending');
    else append(el('div', 'user-msg', item.content));
    turnRunning = true;
    liveTurns = 0;
    setHeaderRunning(true);
    stopBtn.disabled = false;
    stopBtn.textContent = 'Stop';
    setStopVisible(true);
    setFollowEnabled(false);
    setStatus('Working…');
    footer.textContent = '';
    composer.cancelAutoClose();
    setAgentState('running');
  }

  // Send the next queued item when the agent is idle. One per turn-end.
  function flushQueue() {
    if (turnRunning || pendingAskId) return;
    const next = composer.followUpQueue.shift();
    if (!next) return;
    const pendingNode = queuedNodes.shift() ?? null;
    sendFollowUp(next, pendingNode);
  }

  // Public entry: enqueue a follow-up. Sends immediately if idle, else
  // parks it (rendered as "queued") to flush at the next turn-end.
  function enqueueFollowUp(content: string, node?: QueuedNodeRef) {
    const item: QueuedFollowUp = node ? { content, node } : { content };
    if (turnRunning || pendingAskId) {
      composer.followUpQueue.push(item);
      queuedNodes.push(renderQueued(item));
      composer.cancelAutoClose();
    } else {
      sendFollowUp(item, null);
    }
  }
  composer.enqueueFollowUp = enqueueFollowUp;

  followInput.addEventListener('input', () => {
    // The send button is enabled whenever there's text — even mid-turn,
    // since sending now just queues.
    followSend.disabled = followInput.value.trim().length === 0 || !!pendingAskId;
  });
  followInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!followSend.disabled) followSend.click();
    }
  });
  followSend.addEventListener('click', () => {
    const content = followInput.value.trim();
    if (!content) return;
    enqueueFollowUp(content);
    followInput.value = '';
    followSend.disabled = true;
  });
  setFollowEnabled(false);

  function processEvent(event: AgentEvent) {
    switch (event.type) {
      case 'init': {
        const session = String(event.sessionId ?? '').slice(0, 8);
        const model = String(event.model ?? 'claude');
        apiKeySource = typeof event.apiKeySource === 'string' ? event.apiKeySource : null;
        setStatus(`Working · ${model}${session ? ` · ${session}` : ''}`);
        turnRunning = true;
        liveTurns = 0;
        setHeaderRunning(true);
        stopBtn.disabled = false;
        stopBtn.textContent = 'Stop';
        setStopVisible(true);
        setFollowEnabled(false);
        setAgentState('running');
        break;
      }
      case 'progress': {
        // Live turn count, ticking up as the agent works. The footer is
        // the same element the final `result` fills in with turns·cost,
        // so this reads naturally on both the mini card and expanded.
        const t = typeof event.turn === 'number' ? event.turn : liveTurns;
        liveTurns = t;
        if (turnRunning) footer.textContent = `${t} turn${t === 1 ? '' : 's'}`;
        break;
      }
      case 'text': {
        const text = String(event.text ?? '');
        if (!text) break;
        if (!activeTextBlock) {
          activeTextBlock = el('div', 'msg', text);
          append(activeTextBlock);
        } else {
          activeTextBlock.textContent = `${activeTextBlock.textContent ?? ''}\n${text}`;
          log.scrollTop = log.scrollHeight;
        }
        lastToolChip = null;
        break;
      }
      case 'tool_use': {
        activeTextBlock = null;
        const name = String(event.name ?? 'tool');
        const summary = String(event.summary ?? '');
        const chip = el('div', 'chip');
        chip.appendChild(el('span', 'chip-name', name));
        if (summary) chip.appendChild(el('span', 'chip-summary', summary));
        const status = el('span', 'chip-status', '…');
        chip.appendChild(status);
        lastToolChip = chip;
        lastToolLabel = summary ? `${name} · ${summary}` : name;
        append(chip);
        noteActivity(lastToolLabel);
        break;
      }
      case 'tool_result': {
        const ok = !!event.ok;
        if (lastToolChip) {
          const status = lastToolChip.querySelector('.chip-status');
          if (status) {
            status.textContent = ok ? '✓' : '✗';
            (status as HTMLElement).classList.add(ok ? 'ok' : 'err');
          }
        } else {
          append(el('div', `chip ${ok ? '' : 'err'}`, ok ? '✓ tool result' : '✗ tool result'));
        }
        if (lastToolLabel && card) card.title = `${lastToolLabel} ${ok ? '✓' : '✗'}`;
        lastToolChip = null;
        break;
      }
      case 'ask_user': {
        activeTextBlock = null;
        lastToolChip = null;
        const askId = String(event.askId ?? '');
        const question = String(event.question ?? '');
        const options = Array.isArray(event.options) ? (event.options as string[]) : undefined;
        if (!askId || !question) break;
        renderAskUserForm(askId, question, options);
        // If we're minimized, the answer form isn't visible — pulse the
        // card and swap the header so the developer knows the agent is
        // blocked on them. Cleared when they expand (applyMiniChrome).
        if (!composer.expanded) {
          idoc.body.classList.add('needs-input');
          setStatus('Needs your input');
        }
        // A blocked agent shouldn't auto-close out from under the user.
        composer.cancelAutoClose();
        break;
      }
      case 'error': {
        activeTextBlock = null;
        lastToolChip = null;
        append(el('div', 'err-line', String(event.message ?? 'error')));
        setAgentState('error');
        turnRunning = false;
        setHeaderRunning(false);
        showDismiss();
        if (!pendingAskId) setFollowEnabled(true);
        // Terminal: stop the conversation from restoring on next
        // reload. The transcript stays in the cache (it's still
        // useful for review) — only the status flips.
        const db = getBrowserDb();
        if (db) {
          void markConversationResolved(db, feedbackId, 'wontfix').catch(() => {});
        }
        break;
      }
      case 'status_changed': {
        // Server-authoritative status flip — the agent called
        // resolve_feedback (or similar) and the server's Storage
        // wrote the new status. Mirror that into the browser cache
        // so this conversation stops showing as pending on reload.
        const status = String(event.status ?? '');
        if (status === 'fixed' || status === 'wontfix' || status === 'deferred') {
          const db = getBrowserDb();
          if (db) {
            const resolvedRaw = event.resolvedAt;
            const resolvedAt = typeof resolvedRaw === 'string' ? new Date(resolvedRaw) : null;
            void markConversationResolved(db, feedbackId, status, resolvedAt).catch(() => {});
          }
          // Surface the resolution in the live UI too.
          const noteRaw = event.note;
          if (typeof noteRaw === 'string' && noteRaw) {
            append(el('div', 'msg', `Resolved (${status}): ${noteRaw}`));
          } else {
            append(el('div', 'msg', `Resolved (${status}).`));
          }
          setAgentState(status === 'fixed' ? 'done' : 'error');
        }
        break;
      }
      case 'result': {
        activeTextBlock = null;
        lastToolChip = null;
        const subtype = String(event.subtype ?? '');
        const cost = typeof event.totalCostUsd === 'number' ? event.totalCostUsd : 0;
        const turns = typeof event.numTurns === 'number' ? event.numTurns : 0;
        const ok = subtype === 'success';
        setStatus(ok ? 'Done' : `Ended: ${subtype}`);
        const turnsLabel = `${turns} turn${turns === 1 ? '' : 's'}`;
        if (isUntrackedCost(apiKeySource)) {
          // BYO-model CLI: the wrapped CLI doesn't report cost, so the 0 is a
          // placeholder, not "free". Say so rather than printing "$0.0000".
          footer.textContent = `${turnsLabel} · cost not tracked`;
          footer.title = 'The wrapped CLI agent does not report token cost';
        } else if (isNotionalCost(apiKeySource)) {
          footer.textContent = `${turnsLabel} · subscription`;
          footer.title = `≈ $${cost.toFixed(4)} API-equivalent (not billed — Claude subscription)`;
        } else {
          footer.textContent = `${turnsLabel} · $${cost.toFixed(4)}`;
          footer.title = '';
        }
        turnRunning = false;
        setHeaderRunning(false);
        showDismiss();
        setAgentState(ok ? 'done' : 'error');
        if (!pendingAskId) {
          setFollowEnabled(true);
          // Queued follow-ups take precedence over tidying up: drain the
          // next one. Only when the queue is empty (and the run actually
          // succeeded) do we arm the completion auto-close.
          if (composer.followUpQueue.length > 0) flushQueue();
          else if (ok) composer.scheduleAutoClose();
        }
        // Terminal: flip status so restoration scans skip this.
        const db = getBrowserDb();
        if (db) {
          void markConversationResolved(db, feedbackId, ok ? 'fixed' : 'wontfix').catch(() => {});
        }
        break;
      }
    }
  }

  // Replay history before going live. User-typed follow-ups stored
  // with role='user' render as the same user-msg bubble the live
  // path emits at send time.
  if (replayed !== undefined) {
    if (replayed.length > 0) {
      for (const m of replayed) {
        composer.turn = m.turn;
        if (m.role === 'user') {
          const content = m.content as { text?: string } | null;
          const text = content?.text ?? '';
          if (text) append(el('div', 'user-msg', text));
        } else {
          const event = m.content as AgentEvent;
          if (event && typeof event === 'object' && typeof event.type === 'string') {
            processEvent(event);
          }
        }
      }
    } else {
      // Restored widget with no recorded transcript — typically a
      // pre-writes orphan or a conversation whose agent finished
      // before we tracked events. Whatever it was, the server has no
      // live run for it. Bail out of the default "Working..." state
      // so the user isn't stuck staring at a spinner.
      turnRunning = false;
      setHeaderRunning(false);
      showDismiss();
      setStatus('(no transcript saved)');
      setFollowEnabled(true);
      setAgentState('done');
    }
  }

  // Size the card to the loading-gap fit when the log is still empty (a
  // fresh run with nothing replayed). No-op when replayed content already
  // fills the log; the first streamed event grows it back via append().
  composer.refitStream();

  /**
   * Render the lifecycle row from the current `worktreeState` +
   * `turnRunning`. Called from both the worktree_state listener and
   * after turn transitions (because Land/Discard are disabled while a
   * turn is running). Idempotent — safe to call repeatedly.
   */
  function branchSummary(): string {
    // Worktree branches are always named `pinagent/<feedbackId>` (see
    // `createWorktree` in agent-runner). Show the full branch in the label
    // so the dev can match it against `git branch` output.
    const branch = `pinagent/${feedbackId}`;
    if (worktreeChanges === null) return branch;
    const noun = worktreeChanges === 1 ? 'change' : 'changes';
    return `${branch} · ${worktreeChanges} ${noun}`;
  }

  function renderLifecycle(extra?: { commitSha?: string; message?: string }) {
    const { row, label, landBtn, discardBtn } = lifecycle;
    const cls = row.classList;
    cls.remove('landed', 'discarded', 'conflict', 'busy');

    if (worktreeState === 'none') {
      row.hidden = true;
      return;
    }
    row.hidden = false;

    const canAct = !turnRunning && !pendingAskId;
    switch (worktreeState) {
      case 'active':
        label.textContent = canAct ? branchSummary() : `Working on ${branchSummary()}`;
        landBtn.hidden = false;
        discardBtn.hidden = false;
        landBtn.disabled = !canAct;
        discardBtn.disabled = !canAct;
        landBtn.textContent = 'Land';
        discardBtn.textContent = 'Discard';
        if (extra?.message) label.textContent = `Last attempt: ${extra.message}`;
        break;
      case 'landing':
        cls.add('busy');
        label.textContent = 'Landing…';
        landBtn.hidden = false;
        discardBtn.hidden = true;
        landBtn.disabled = true;
        landBtn.textContent = 'Landing…';
        break;
      case 'landed':
        cls.add('landed');
        label.textContent = extra?.commitSha
          ? `Landed · ${extra.commitSha.slice(0, 12)}`
          : 'Landed';
        landBtn.hidden = true;
        discardBtn.hidden = true;
        break;
      case 'discarding':
        cls.add('busy');
        label.textContent = 'Discarding…';
        landBtn.hidden = true;
        discardBtn.hidden = false;
        discardBtn.disabled = true;
        discardBtn.textContent = 'Discarding…';
        break;
      case 'discarded':
        cls.add('discarded');
        label.textContent = 'Discarded';
        landBtn.hidden = true;
        discardBtn.hidden = true;
        break;
      case 'conflict':
        cls.add('conflict');
        label.textContent = 'Merge conflict — resolve in editor, then retry';
        landBtn.hidden = false;
        discardBtn.hidden = false;
        landBtn.disabled = !canAct;
        discardBtn.disabled = !canAct;
        landBtn.textContent = 'Retry land';
        discardBtn.textContent = 'Discard';
        break;
      case 'ttl_warning':
        label.textContent = `Old worktree · ${branchSummary()} — review or discard`;
        landBtn.hidden = false;
        discardBtn.hidden = false;
        landBtn.disabled = !canAct;
        discardBtn.disabled = !canAct;
        landBtn.textContent = 'Land';
        discardBtn.textContent = 'Discard';
        break;
    }
  }

  lifecycle.landBtn.addEventListener('click', () => {
    if (lifecycle.landBtn.disabled) return;
    client.sendLandRequest(feedbackId);
    // Optimistic — the server echoes 'landing' too, but reacting now
    // avoids a flash of "Ready to land or discard" between click and
    // the round-trip.
    worktreeState = 'landing';
    renderLifecycle();
  });

  lifecycle.discardBtn.addEventListener('click', () => {
    if (lifecycle.discardBtn.disabled) return;
    // One-click discard. The transcript stays in the cache so the
    // user can still read what the agent did even though the worktree
    // is gone. A confirm dialog felt heavier than the destructive
    // surface warrants — discard only throws away uncommitted edits,
    // and the user has the transcript to remember what was done.
    client.sendDiscardRequest(feedbackId);
    worktreeState = 'discarding';
    renderLifecycle();
  });

  function renderConflicts(files: string[]) {
    const wrap = el('div', 'conflict-block');
    wrap.appendChild(el('div', 'conflict-title', `Merge conflicts in ${files.length} file(s)`));
    for (const f of files) wrap.appendChild(el('div', 'conflict-file', f));
    append(wrap);
  }

  client.subscribe(feedbackId, {
    onEvent(event) {
      // Persist before rendering so a render error doesn't lose the
      // event from the cache. Best-effort — DB unreachable doesn't
      // break the live UI. `progress` is a transient live signal (the
      // authoritative count is on the persisted `result`), so skip it
      // to avoid one cache row per turn.
      const db = getBrowserDb();
      if (db && event.type !== 'progress') {
        // Capture the turn now — the write is serialised and may run
        // after composer.turn advances.
        const turn = composer.turn;
        queueDbWrite(() => recordEvent(db, feedbackId, turn, event));
      }
      processEvent(event);
    },
    onReset() {
      // Reconnect: the server is about to replay the full transcript.
      // Clear the rendered log + render accumulators and wipe the cached
      // messages so the replay rebuilds exactly one copy in both the DOM
      // and the browser mirror. The delete rides the same write chain as
      // recordEvent, so it lands before the replayed re-inserts.
      log.replaceChildren();
      activeTextBlock = null;
      lastToolChip = null;
      lastToolLabel = null;
      pendingAskId = null;
      pendingAskFormRoot = null;
      composer.needsInput = false;
      // The rendered "queued" bubbles were just wiped with the log. Drop
      // their DOM refs but keep `composer.followUpQueue` — those messages
      // still need to send. flushQueue tolerates the now-empty queuedNodes
      // (shift → undefined → append a fresh committed bubble).
      queuedNodes.length = 0;
      const db = getBrowserDb();
      if (db) queueDbWrite(() => deleteConversationMessages(db, feedbackId));
    },
    onDone() {
      turnRunning = false;
      setHeaderRunning(false);
      setStopVisible(false);
      if (!pendingAskId) {
        setFollowEnabled(true);
        if (composer.followUpQueue.length > 0) flushQueue();
      }
      renderLifecycle();
    },
    onWorktreeState(payload) {
      worktreeState = payload.state;
      if (typeof payload.changesCount === 'number') {
        worktreeChanges = payload.changesCount;
      }
      if (payload.state === 'conflict' && payload.conflicts && payload.conflicts.length > 0) {
        renderConflicts(payload.conflicts);
      }
      renderLifecycle({
        ...(payload.commitSha ? { commitSha: payload.commitSha } : {}),
        ...(payload.message ? { message: payload.message } : {}),
      });
    },
    onError(message) {
      // A follow-up that lost the race against the server's still-active
      // run gets bounced with "a turn is already in progress". Don't
      // surface that as an error or drop the message — re-queue it to the
      // front; the active turn's result/done will flush it. (Best-effort:
      // its rendered bubble was already promoted, so it re-renders fresh.)
      if (lastSent && /turn (is )?already in progress/i.test(message)) {
        composer.followUpQueue.unshift(lastSent);
        lastSent = null;
        return;
      }
      append(el('div', 'err-line', message));
      // Server-side "no in-flight run to interrupt" — the agent
      // already ended (likely while we were offline, or before
      // restore). Reset the UI so the user can dismiss without the
      // Stop button staying stuck at "Stopping…".
      if (message.includes('no in-flight run')) {
        turnRunning = false;
        setHeaderRunning(false);
        setStopVisible(false);
        stopBtn.disabled = false;
        stopBtn.textContent = 'Stop';
        setStatus('(agent run not active)');
        setAgentState('done');
        if (!pendingAskId) setFollowEnabled(true);
      }
    },
  });
}
