// SPDX-License-Identifier: Apache-2.0
import type { Server as HttpServer } from 'node:http';
import { join } from 'node:path';
import { conversations } from '@pinagent/db';
import {
  type AgentEvent,
  type ClientMessage,
  ClientMessageSchema,
  type ProjectEvent,
  type ServerMessage,
  type WorktreeWireState,
} from '@pinagent/shared';
import { sql } from 'drizzle-orm';
import { type WebSocket, WebSocketServer } from 'ws';
import {
  countWorktreeChanges,
  discardWorktree,
  interruptRun,
  mergeWorktree,
  reopenConversation,
  runFollowUpTurn,
} from './agent';
import { resolveAsk } from './ask-user';
import { getOrCreateBus } from './bus';
import { getDb } from './db/client';
import { enqueue } from './merge-queue';
import { onProjectChange } from './project-events';
import { maybeStartRelayClient } from './relay-client';
import { type ProjectSettingsPatch, SettingsStore } from './settings-store';
import { Storage } from './storage';
import { clearWarning, isStale, sweepStaleWorktrees } from './worktree-ttl';

const DEFAULT_PORT = 53636;
const WS_PATH = '/__pinagent/ws';
const PORT_FALLBACK_RANGE = 10;

const SINGLETON_KEY = Symbol.for('pinagent.ws-server');

interface ServerHandle {
  port: number;
  wss: WebSocketServer;
  httpServer: HttpServer | null;
}

interface GlobalHolder {
  [SINGLETON_KEY]?: ServerHandle | Promise<ServerHandle>;
}

/**
 * Attempt to bind a WebSocketServer on `port`. Resolves to the bound
 * server, or `null` if the port is in use. Other errors propagate.
 */
function tryBind(port: number): Promise<WebSocketServer | null> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, path: WS_PATH });
    const onListening = () => {
      wss.off('error', onError);
      resolve(wss);
    };
    const onError = (err: NodeJS.ErrnoException) => {
      wss.off('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        wss.close();
        resolve(null);
      } else {
        reject(err);
      }
    };
    wss.once('listening', onListening);
    wss.once('error', onError);
  });
}

/**
 * Start (or return the existing) WebSocket server for this dev process.
 *
 * Next 16 / Vite HMR can load the config more than once (workers, HMR) — the
 * singleton keyed off a global Symbol prevents us from binding the same port
 * twice. The cached entry is a Promise during in-flight bind so concurrent
 * callers (parallel Turbopack re-evaluations) share one bind attempt.
 *
 * If `PINAGENT_WS_PORT` is already taken — typically by a stale dev server
 * from another pinagent project on this machine — we walk up to
 * `PORT_FALLBACK_RANGE` ports forward to find a free one. We then mutate
 * `process.env.PINAGENT_WS_PORT` so the route handler's widget-bundle
 * prelude (next-plugin/route.ts) reports the actually-bound port, not the
 * requested one. Without this, the widget would connect to the stale
 * stranger and silently see no events.
 *
 * We run on a dedicated port rather than hijacking Next's underlying http
 * server because Next App Router routes can't perform an upgrade. The widget
 * learns the port from a prelude injected into /__pinagent/widget.js by the
 * route handler (see `widget-config.ts`).
 */
export async function startWsServer(): Promise<ServerHandle> {
  const g = globalThis as GlobalHolder;
  const existing = g[SINGLETON_KEY];
  if (existing) return existing;

  const pending = (async (): Promise<ServerHandle> => {
    const envPort = process.env.PINAGENT_WS_PORT;
    const requested = envPort ? Number(envPort) : DEFAULT_PORT;
    if (!Number.isFinite(requested) || requested <= 0 || requested > 65535) {
      throw new Error(`[pinagent] invalid PINAGENT_WS_PORT: ${envPort}`);
    }

    let wss: WebSocketServer | null = null;
    let boundPort = requested;
    for (let i = 0; i < PORT_FALLBACK_RANGE; i++) {
      const candidate = requested + i;
      // Serial probe is intentional — we want the next free port, so each
      // attempt must finish before the next begins.
      wss = await tryBind(candidate);
      if (wss) {
        boundPort = candidate;
        break;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[pinagent] port ${candidate} in use (likely a stale dev server from another project); trying ${candidate + 1}`,
      );
    }
    if (!wss) {
      throw new Error(
        `[pinagent] no free WS port in range ${requested}..${requested + PORT_FALLBACK_RANGE - 1}`,
      );
    }

    // Surface the actual port so downstream config readers (next-plugin's
    // widget-bundle prelude) hand the widget the right URL.
    process.env.PINAGENT_WS_PORT = String(boundPort);

    // eslint-disable-next-line no-console
    console.log(`[pinagent] WebSocket server listening on ws://127.0.0.1:${boundPort}${WS_PATH}`);

    wss.on('connection', (socket) => {
      attachConnection(socket);
    });

    // Any error AFTER successful bind (not EADDRINUSE) is unexpected — log
    // and let the process keep running.
    wss.on('error', (err: NodeJS.ErrnoException) => {
      // eslint-disable-next-line no-console
      console.error('[pinagent] WebSocket server error:', err);
    });

    const handle: ServerHandle = { port: boundPort, wss, httpServer: null };
    g[SINGLETON_KEY] = handle;

    // Best-effort cleanup so a SIGINT doesn't leak the port.
    process.once('SIGINT', () => wss.close());
    process.once('SIGTERM', () => wss.close());

    // Fire-and-forget orphan-worktree TTL scan. Populates a flag set the
    // next `subscribe` consults to upgrade `active` → `ttl_warning` for
    // stale conversations. Safe to ignore failures — the only consequence
    // is users don't get the nudge on this boot.
    void sweepStaleWorktrees(projectRoot());

    // Register the project-event fan-out listener exactly once. Safe to
    // call on every startWsServer invocation — singleton-guarded inside.
    ensureProjectListener();
    // Same idea, but for writes that happen in OTHER processes (notably
    // the MCP server's `resolve_feedback` handler). In-process emits
    // bypass this poll loop entirely; it exists only to catch what the
    // in-process listener can't see.
    ensureCrossProcessProjectPoller();

    // Cloud mode (opt-in): dial out to the hosted relay as this session's
    // device socket. No-op unless PINAGENT_RELAY_URL / _TOKEN are set.
    maybeStartRelayClient();

    return handle;
  })();

  g[SINGLETON_KEY] = pending;
  try {
    return await pending;
  } catch (err) {
    if (g[SINGLETON_KEY] === pending) delete g[SINGLETON_KEY];
    throw err;
  }
}

/** Per-connection state — which feedback ids this socket is subscribed to. */
interface ConnectionState {
  subscriptions: Map<string, () => void>; // feedbackId → unsubscribe
  /** Whether this socket has sent `subscribe_project` and should get fan-out. */
  projectSubscribed: boolean;
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

/**
 * Project-wide subscribers. Sockets self-register via `subscribe_project`
 * and receive `project_event` messages whenever Storage emits a change
 * (see project-events.ts). Lives separately from `worktreeSubs` because
 * it's not keyed by feedbackId — every project subscriber gets every
 * project event.
 *
 * Pinned via globalThis so Next 16 / HMR re-evaluation doesn't lose
 * subscribers across module reloads — same approach as worktreeSubs.
 */
const PROJECT_SUBS_SYMBOL = Symbol.for('pinagent.ws.projectSubs');
const projectSubs: Set<WebSocket> =
  ((globalThis as Record<symbol, unknown>)[PROJECT_SUBS_SYMBOL] as Set<WebSocket> | undefined) ??
  new Set<WebSocket>();
(globalThis as Record<symbol, unknown>)[PROJECT_SUBS_SYMBOL] = projectSubs;

/**
 * Singleton-guarded listener registration. `onProjectChange` returns an
 * unsubscribe handle; we keep the handle around the same global slot so
 * a duplicate `startWsServer` call doesn't stack listeners (which would
 * cause each event to fan out twice, then three times, etc).
 */
const PROJECT_LISTENER_SYMBOL = Symbol.for('pinagent.ws.projectListener');

function ensureProjectListener(): void {
  const slot = globalThis as Record<symbol, unknown>;
  if (slot[PROJECT_LISTENER_SYMBOL]) return;
  const unsubscribe = onProjectChange((event) => fanoutProjectEvent(event));
  slot[PROJECT_LISTENER_SYMBOL] = unsubscribe;
}

/**
 * Watches `conversations.updatedAt` so writes from OTHER processes
 * (notably the MCP server's `resolve_feedback`, which runs as a child
 * Node process under the SDK and never touches our in-process
 * `emitProjectChange`) still trigger a dock refresh.
 *
 * Mirrors the polling pattern in `bus.ts` (per-conversation events).
 * Latency upper bound is one poll interval; the dock's TanStack Query
 * invalidation is idempotent, so the worst case if an in-process event
 * also fires is one extra refetch ~`POLL_MS` later — harmless.
 *
 * The initial watermark is seeded asynchronously; until the seed
 * resolves, the very first poll might fire a redundant
 * `conversations_changed`. That's acceptable: project subscribers
 * connect AFTER startWsServer, so they normally won't see it; if they
 * do, it's one wasted refetch on first connect.
 */
const PROJECT_POLLER_SYMBOL = Symbol.for('pinagent.ws.projectPoller');
const PROJECT_POLL_MS = 250;

function ensureCrossProcessProjectPoller(): void {
  const slot = globalThis as Record<symbol, unknown>;
  if (slot[PROJECT_POLLER_SYMBOL]) return;

  let lastSeenMs = 0;
  let polling = false;

  // Seed watermark with the current MAX so we don't fan out on every
  // pre-existing row when the dev-server boots.
  void (async () => {
    try {
      const db = getDb(projectRoot());
      const rows = await db
        .select({ max: sql<number | null>`MAX(${conversations.updatedAt})` })
        .from(conversations);
      const ms = rows[0]?.max ?? null;
      if (ms !== null) lastSeenMs = Number(ms);
    } catch {
      // Migrations may not have run yet; seed stays at 0 and the first
      // poll catches up.
    }
  })();

  const interval = setInterval(() => {
    if (polling) return;
    polling = true;
    void (async () => {
      try {
        const db = getDb(projectRoot());
        const rows = await db
          .select({ max: sql<number | null>`MAX(${conversations.updatedAt})` })
          .from(conversations);
        const ms = rows[0]?.max ?? null;
        if (ms !== null && Number(ms) > lastSeenMs) {
          lastSeenMs = Number(ms);
          fanoutProjectEvent({ type: 'conversations_changed' });
        }
      } catch {
        // Transient — skip this tick. The next one retries.
      } finally {
        polling = false;
      }
    })();
  }, PROJECT_POLL_MS);

  slot[PROJECT_POLLER_SYMBOL] = () => clearInterval(interval);
}

function fanoutProjectEvent(event: ProjectEvent): void {
  const msg: ServerMessage = { type: 'project_event', event };
  for (const sock of projectSubs) send(sock, msg);
}

/**
 * Connected VSCode-extension sockets, mapped to their reported version.
 * An entry exists for every socket that sent `extension_hello`. The dock
 * consults presence (size > 0) to decide whether to nudge the user to
 * install the editor bridge.
 *
 * Pinned to globalThis for the same Next-16 / HMR-survival reason as the
 * subscriber sets above — a module re-eval mustn't forget that an
 * extension is live and start telling docks it's missing.
 */
const EXTENSION_SOCKETS_SYMBOL = Symbol.for('pinagent.ws.extensionSockets');
const extensionSockets: Map<WebSocket, string | undefined> =
  ((globalThis as Record<symbol, unknown>)[EXTENSION_SOCKETS_SYMBOL] as
    | Map<WebSocket, string | undefined>
    | undefined) ?? new Map<WebSocket, string | undefined>();
(globalThis as Record<symbol, unknown>)[EXTENSION_SOCKETS_SYMBOL] = extensionSockets;

/**
 * Snapshot the current presence state. `version` is the last-registered
 * extension's version (newest connection wins) — good enough for the
 * single-editor common case; multi-window users just see one of them.
 */
function extensionStatusMessage(): Extract<ServerMessage, { type: 'extension_status' }> {
  let version: string | undefined;
  for (const v of extensionSockets.values()) {
    if (v) version = v;
  }
  const msg: Extract<ServerMessage, { type: 'extension_status' }> = {
    type: 'extension_status',
    present: extensionSockets.size > 0,
  };
  if (version) msg.version = version;
  return msg;
}

/** Push the current presence snapshot to every project subscriber. */
function broadcastExtensionStatus(): void {
  const msg = extensionStatusMessage();
  for (const sock of projectSubs) send(sock, msg);
}

function projectRoot(): string {
  return process.env.PINAGENT_PROJECT_ROOT ?? process.cwd();
}

function logPathFor(root: string, feedbackId: string): string {
  return join(root, '.pinagent', 'logs', `${feedbackId}.md`);
}

const PING_INTERVAL_MS = 30_000;

export function attachConnection(socket: WebSocket): void {
  const state: ConnectionState = {
    subscriptions: new Map(),
    projectSubscribed: false,
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
    if (state.projectSubscribed) {
      projectSubs.delete(socket);
      state.projectSubscribed = false;
    }
    // If this was an editor-bridge socket, presence may have just
    // dropped — tell the docks so they can re-surface the install nudge.
    if (extensionSockets.delete(socket)) {
      broadcastExtensionStatus();
    }
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
      const interrupted = await interruptRun(msg.feedbackId);
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
    case 'reopen_request': {
      const root = projectRoot();
      const logPath = logPathFor(root, msg.feedbackId);
      // Reopen is a single DB write, but go through `enqueue` anyway so
      // it serialises behind any in-flight land/discard on the same
      // project — keeps the state-machine transitions linearisable.
      const result = await enqueue(root, () => reopenConversation(root, msg.feedbackId, logPath));
      if (result.ok) {
        broadcastWorktreeState(msg.feedbackId, { state: 'none' });
      } else {
        sendError(socket, msg.feedbackId, result.error);
      }
      return;
    }
    case 'subscribe_project': {
      if (state.projectSubscribed) return;
      projectSubs.add(socket);
      state.projectSubscribed = true;
      // Seed the new subscriber with the current presence snapshot so the
      // dock can render the right Connections state (and decide whether to
      // nudge) without waiting for an extension to connect/disconnect.
      send(socket, extensionStatusMessage());
      return;
    }
    case 'unsubscribe_project': {
      if (!state.projectSubscribed) return;
      projectSubs.delete(socket);
      state.projectSubscribed = false;
      return;
    }
    case 'extension_hello': {
      // Register (or refresh the version of) this editor-bridge socket and
      // tell every dock subscriber presence is now live.
      extensionSockets.set(socket, msg.version);
      broadcastExtensionStatus();
      return;
    }
    case 'set_branch_routing': {
      // The control plane pushed an org's branch-routing policy down the
      // relay channel; mirror it into local settings, where worktree.ts
      // enforces it. `defaultBaseBranch: null` leaves the base branch as-is.
      const patch: ProjectSettingsPatch = {
        allowedBranchPatterns: msg.allowedBranchPatterns,
      };
      if (msg.defaultBaseBranch !== null) patch.baseBranch = msg.defaultBaseBranch;
      try {
        await new SettingsStore(projectRoot()).patch(patch);
      } catch (err) {
        // Bad policy (e.g. invalid branch name) shouldn't tear down the
        // connection — log and move on; the prior settings stay in effect.
        console.error('[pinagent] failed to apply pushed branch-routing policy:', err);
      }
      return;
    }
    case 'query_extension': {
      send(socket, extensionStatusMessage());
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
    // Surface the uncommitted-files count for active-ish states so the widget
    // can render `feedback/<id> · N changes` in the lifecycle label. Skipped
    // for landed/discarded (the worktree is gone). Best-effort: a `null`
    // return means we couldn't count (e.g. worktree path doesn't exist) and
    // the widget falls back to the label without the count.
    if (rec.worktreePath && (state === 'active' || state === 'ttl_warning')) {
      const n = await countWorktreeChanges(rec.worktreePath);
      if (n !== null) payload.changesCount = n;
    }
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
