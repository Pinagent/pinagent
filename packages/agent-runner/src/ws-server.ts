// SPDX-License-Identifier: Apache-2.0
import type { Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import {
  type AgentEvent,
  type ClientMessage,
  ClientMessageSchema,
  getOrCreateBus,
  type ServerMessage,
  type WorktreeWireState,
} from '@pinagent/shared';
import { type WebSocket, WebSocketServer } from 'ws';
import { discardWorktree, interruptRun, mergeWorktree, runFollowUpTurn } from './agent';
import { resolveAsk } from './ask-user';
import { enqueue } from './merge-queue';
import { Storage } from './storage';
import { clearWarning, isStale, sweepStaleWorktrees } from './worktree-ttl';

const DEFAULT_PORT = 53636;
const WS_PATH = '/__pinagent/ws';

const SINGLETON_KEY = Symbol.for('pinagent.ws-server');

interface ServerHandle {
  port: number;
  wss: WebSocketServer;
  httpServer: HttpServer | null;
}

interface GlobalHolder {
  [SINGLETON_KEY]?: ServerHandle;
}

/**
 * Start (or return the existing) WebSocket server for this dev process.
 *
 * Next 16 can load the config more than once (workers, HMR) — the singleton
 * keyed off a global Symbol prevents us from binding the same port twice.
 *
 * We run on a dedicated port rather than hijacking Next's underlying http
 * server because Next App Router routes can't perform an upgrade. The widget
 * learns the port from a prelude injected into /__pinagent/widget.js by the
 * route handler (see `widget-config.ts`).
 */
export function startWsServer(): ServerHandle {
  const g = globalThis as GlobalHolder;
  const existing = g[SINGLETON_KEY];
  if (existing) return existing;

  const envPort = process.env.PINAGENT_WS_PORT;
  const port = envPort ? Number(envPort) : DEFAULT_PORT;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`[pinagent] invalid PINAGENT_WS_PORT: ${envPort}`);
  }

  const wss = new WebSocketServer({ port, path: WS_PATH });

  wss.on('connection', (socket) => {
    attachConnection(socket);
  });

  wss.on('listening', () => {
    // eslint-disable-next-line no-console
    console.log(`[pinagent] WebSocket server listening on ws://127.0.0.1:${port}${WS_PATH}`);
  });

  // The 'error' handler runs async, so we may have already returned the
  // handle by the time bind fails. EADDRINUSE is the common case in dev:
  // Turbopack re-evaluates route.ts on each request, which slips past the
  // global singleton; the original instance is still bound on the port,
  // so the duplicate just needs to give up quietly. Any other error stays
  // loud.
  wss.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.log(
        `[pinagent] WebSocket server already running on port ${port} (duplicate bind ignored)`,
      );
      // Clear the singleton slot so a future startWsServer call could try
      // again on a different port if the user changed PINAGENT_WS_PORT —
      // unlikely, but harmless.
      if (g[SINGLETON_KEY]?.wss === wss) delete g[SINGLETON_KEY];
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[pinagent] WebSocket server error:', err);
  });

  const handle: ServerHandle = { port, wss, httpServer: null };
  g[SINGLETON_KEY] = handle;

  // Best-effort cleanup so a SIGINT doesn't leak the port.
  process.once('SIGINT', () => wss.close());
  process.once('SIGTERM', () => wss.close());

  // Fire-and-forget orphan-worktree TTL scan. Populates a flag set the
  // next `subscribe` consults to upgrade `active` → `ttl_warning` for
  // stale conversations. Safe to ignore failures — the only consequence
  // is users don't get the nudge on this boot.
  void sweepStaleWorktrees(projectRoot());

  return handle;
}

/** Per-connection state — which feedback ids this socket is subscribed to. */
interface ConnectionState {
  subscriptions: Map<string, () => void>; // feedbackId → unsubscribe
  alive: boolean;
}

/**
 * Worktree-state fan-out: keyed by feedbackId, value is the set of
 * sockets currently subscribed. Lives separately from the
 * `event-bus` because worktree state is a property of the conversation
 * row (durable in SQLite) rather than an agent-run event — and changes
 * to it can happen long after the agent run's bus has been finished
 * and evicted. Survives module re-eval via globalThis pinning.
 */
const WT_SUBS_SYMBOL = Symbol.for('pinagent.ws.worktreeSubs');
const worktreeSubs: Map<string, Set<WebSocket>> = ((globalThis as Record<symbol, unknown>)[
  WT_SUBS_SYMBOL
] as Map<string, Set<WebSocket>> | undefined) ?? new Map<string, Set<WebSocket>>();
(globalThis as Record<symbol, unknown>)[WT_SUBS_SYMBOL] = worktreeSubs;

function addWorktreeSub(feedbackId: string, socket: WebSocket): void {
  let set = worktreeSubs.get(feedbackId);
  if (!set) {
    set = new Set();
    worktreeSubs.set(feedbackId, set);
  }
  set.add(socket);
}

function removeWorktreeSub(feedbackId: string, socket: WebSocket): void {
  const set = worktreeSubs.get(feedbackId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) worktreeSubs.delete(feedbackId);
}

function broadcastWorktreeState(
  feedbackId: string,
  payload: Omit<Extract<ServerMessage, { type: 'worktree_state' }>, 'type' | 'feedbackId'>,
): void {
  const set = worktreeSubs.get(feedbackId);
  if (!set) return;
  const msg: ServerMessage = { type: 'worktree_state', feedbackId, ...payload };
  for (const sock of set) send(sock, msg);
}

function projectRoot(): string {
  return process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
}

function logPathFor(root: string, feedbackId: string): string {
  return join(root, '.pinagent', 'logs', `${feedbackId}.md`);
}

const PING_INTERVAL_MS = 30_000;

function attachConnection(socket: WebSocket): void {
  const state: ConnectionState = {
    subscriptions: new Map(),
    alive: true,
  };

  const ping = setInterval(() => {
    if (!state.alive) {
      // Other side didn't reply to last ping — drop it.
      socket.terminate();
      return;
    }
    state.alive = false;
    try {
      socket.ping();
    } catch {
      // Socket closing.
    }
  }, PING_INTERVAL_MS);

  socket.on('pong', () => {
    state.alive = true;
  });

  socket.on('message', (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      sendError(socket, undefined, 'invalid JSON');
      return;
    }
    const validated = ClientMessageSchema.safeParse(parsed);
    if (!validated.success) {
      sendError(socket, undefined, `invalid message: ${validated.error.message}`);
      return;
    }
    void handleClientMessage(socket, state, validated.data);
  });

  socket.on('close', () => {
    clearInterval(ping);
    for (const [feedbackId, unsub] of state.subscriptions.entries()) {
      unsub();
      removeWorktreeSub(feedbackId, socket);
    }
    state.subscriptions.clear();
  });

  socket.on('error', () => {
    // Closing is handled by 'close'; nothing to do here.
  });
}

async function handleClientMessage(
  socket: WebSocket,
  state: ConnectionState,
  msg: ClientMessage,
): Promise<void> {
  switch (msg.type) {
    case 'subscribe': {
      if (state.subscriptions.has(msg.feedbackId)) return;
      const bus = getOrCreateBus(msg.feedbackId);
      const unsub = bus.subscribe({
        onEvent(event: AgentEvent) {
          send(socket, { type: 'event', feedbackId: msg.feedbackId, event });
        },
        onClose() {
          send(socket, { type: 'done', feedbackId: msg.feedbackId });
          state.subscriptions.delete(msg.feedbackId);
          removeWorktreeSub(msg.feedbackId, socket);
        },
      });
      state.subscriptions.set(msg.feedbackId, unsub);
      addWorktreeSub(msg.feedbackId, socket);

      // Send the current worktree state to the new subscriber so it can
      // render Land/Discard controls (or their absence) without an HTTP
      // round-trip. Best-effort — missing rows just produce no message.
      void emitCurrentWorktreeState(socket, msg.feedbackId);
      return;
    }
    case 'unsubscribe': {
      const unsub = state.subscriptions.get(msg.feedbackId);
      if (unsub) {
        unsub();
        state.subscriptions.delete(msg.feedbackId);
      }
      removeWorktreeSub(msg.feedbackId, socket);
      return;
    }
    case 'ask_response': {
      const ok = resolveAsk(msg.askId, msg.answer);
      if (!ok) sendError(socket, undefined, `no pending ask ${msg.askId}`);
      return;
    }
    case 'user_message': {
      try {
        await runFollowUpTurn(msg.feedbackId, msg.content);
      } catch (err) {
        sendError(socket, msg.feedbackId, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    case 'interrupt': {
      const interrupted = interruptRun(msg.feedbackId);
      if (!interrupted) {
        sendError(socket, msg.feedbackId, 'no in-flight run to interrupt');
      }
      return;
    }
    case 'land_request': {
      const root = projectRoot();
      const logPath = logPathFor(root, msg.feedbackId);
      clearWarning(msg.feedbackId);
      broadcastWorktreeState(msg.feedbackId, { state: 'landing' });
      // Serialise per-project so two widgets racing to land on the same
      // HEAD branch can't interleave merges.
      const result = await enqueue(root, () => mergeWorktree(root, msg.feedbackId, logPath));
      if (result.ok) {
        broadcastWorktreeState(msg.feedbackId, {
          state: 'landed',
          ...(result.commitSha ? { commitSha: result.commitSha } : {}),
        });
      } else if (result.conflicts && result.conflicts.length > 0) {
        broadcastWorktreeState(msg.feedbackId, {
          state: 'conflict',
          conflicts: result.conflicts,
        });
      } else {
        // Non-conflict failure (no worktree, detached HEAD, etc.) —
        // revert the optimistic 'landing' state and report.
        broadcastWorktreeState(msg.feedbackId, {
          state: 'active',
          ...(result.error ? { message: result.error } : {}),
        });
      }
      return;
    }
    case 'discard_request': {
      const root = projectRoot();
      const logPath = logPathFor(root, msg.feedbackId);
      clearWarning(msg.feedbackId);
      broadcastWorktreeState(msg.feedbackId, { state: 'discarding' });
      try {
        await enqueue(root, () => discardWorktree(root, msg.feedbackId, logPath));
        broadcastWorktreeState(msg.feedbackId, { state: 'discarded' });
      } catch (err) {
        broadcastWorktreeState(msg.feedbackId, {
          state: 'active',
          message: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }
    case 'ping': {
      send(socket, { type: 'pong' });
      return;
    }
  }
}

async function emitCurrentWorktreeState(socket: WebSocket, feedbackId: string): Promise<void> {
  try {
    const storage = new Storage(projectRoot());
    const rec = await storage.read(feedbackId);
    if (!rec) return;
    // Upgrade `active` → `ttl_warning` for stale orphans surfaced by the
    // boot-time sweep. The widget renders the same Land/Discard
    // affordances but with a "Old worktree — review or discard" label.
    const state: WorktreeWireState =
      rec.worktreeState === 'active' && isStale(feedbackId)
        ? 'ttl_warning'
        : (rec.worktreeState as WorktreeWireState);
    const payload: Extract<ServerMessage, { type: 'worktree_state' }> = {
      type: 'worktree_state',
      feedbackId,
      state,
    };
    if (rec.commitSha) payload.commitSha = rec.commitSha;
    send(socket, payload);
  } catch {
    // Best-effort — the widget will still get state on the next action.
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // Socket closing mid-write; nothing useful to do.
  }
}

function sendError(socket: WebSocket, feedbackId: string | undefined, message: string): void {
  const payload: ServerMessage = feedbackId
    ? { type: 'error', feedbackId, message }
    : { type: 'error', message };
  send(socket, payload);
}
