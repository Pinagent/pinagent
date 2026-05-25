import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { resolveAsk } from './ask-user';
import { type AgentEvent, getOrCreateBus } from './event-bus';
import {
  type ClientMessage,
  ClientMessageSchema,
  type ServerMessage,
} from './ws-protocol';

const DEFAULT_PORT = 53636;
const WS_PATH = '/__pinpoint/ws';

const SINGLETON_KEY = Symbol.for('pinpoint.ws-server');

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
 * learns the port from a prelude injected into /__pinpoint/widget.js by the
 * route handler (see `widget-config.ts`).
 */
export function startWsServer(): ServerHandle {
  const g = globalThis as GlobalHolder;
  const existing = g[SINGLETON_KEY];
  if (existing) return existing;

  const envPort = process.env.PINPOINT_WS_PORT;
  const port = envPort ? Number(envPort) : DEFAULT_PORT;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`[pinpoint] invalid PINPOINT_WS_PORT: ${envPort}`);
  }

  const wss = new WebSocketServer({ port, path: WS_PATH });

  wss.on('connection', (socket) => {
    attachConnection(socket);
  });

  wss.on('listening', () => {
    // eslint-disable-next-line no-console
    console.log(`[pinpoint] WebSocket server listening on ws://127.0.0.1:${port}${WS_PATH}`);
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
        `[pinpoint] WebSocket server already running on port ${port} (duplicate bind ignored)`,
      );
      // Clear the singleton slot so a future startWsServer call could try
      // again on a different port if the user changed PINPOINT_WS_PORT —
      // unlikely, but harmless.
      if (g[SINGLETON_KEY]?.wss === wss) delete g[SINGLETON_KEY];
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[pinpoint] WebSocket server error:', err);
  });

  const handle: ServerHandle = { port, wss, httpServer: null };
  g[SINGLETON_KEY] = handle;

  // Best-effort cleanup so a SIGINT doesn't leak the port.
  process.once('SIGINT', () => wss.close());
  process.once('SIGTERM', () => wss.close());

  return handle;
}

/** Per-connection state — which feedback ids this socket is subscribed to. */
interface ConnectionState {
  subscriptions: Map<string, () => void>; // feedbackId → unsubscribe
  alive: boolean;
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
    for (const unsub of state.subscriptions.values()) unsub();
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
        },
      });
      state.subscriptions.set(msg.feedbackId, unsub);
      return;
    }
    case 'unsubscribe': {
      const unsub = state.subscriptions.get(msg.feedbackId);
      if (unsub) {
        unsub();
        state.subscriptions.delete(msg.feedbackId);
      }
      return;
    }
    case 'ask_response': {
      const ok = resolveAsk(msg.askId, msg.answer);
      if (!ok) sendError(socket, undefined, `no pending ask ${msg.askId}`);
      return;
    }
    case 'user_message': {
      // Multi-turn entrypoint. Imported lazily so the module graph doesn't
      // cycle (agent.ts → event-bus → ws-server → agent.ts).
      const { runFollowUpTurn } = await import('./agent');
      try {
        await runFollowUpTurn(msg.feedbackId, msg.content);
      } catch (err) {
        sendError(socket, msg.feedbackId, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    case 'interrupt': {
      const { interruptRun } = await import('./agent');
      const interrupted = interruptRun(msg.feedbackId);
      if (!interrupted) {
        sendError(socket, msg.feedbackId, 'no in-flight run to interrupt');
      }
      return;
    }
    case 'ping': {
      send(socket, { type: 'pong' });
      return;
    }
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
