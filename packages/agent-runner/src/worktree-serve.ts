// SPDX-License-Identifier: Apache-2.0
/**
 * On-demand dev servers for worktrees — the "Open app" affordance in the
 * dock's Branches view.
 *
 * A pinagent worktree (`spawnAgent: 'worktree'`) is just a git branch + a
 * directory on disk; nothing serves it. The project's single Vite/Next dev
 * server stays bound to the project root, so the only way to *see* what an
 * agent did in a worktree is the diff view. This module lets the dock stand
 * up a throwaway dev server rooted at the worktree directory on its own
 * port, so the developer can open the worktree's running app in a browser
 * tab.
 *
 * Lifecycle:
 *  - `serveWorktree` lazily spawns (or reuses) one server per feedbackId,
 *    tracked in a globalThis-pinned registry that survives Next/Vite HMR
 *    module re-eval (same pattern as the WS subscriber sets in ws-server.ts).
 *  - `stopWorktreeServer` kills one; called from every worktree-teardown
 *    path (prune / land / discard) so a served server doesn't outlive the
 *    directory it's rooted in.
 *  - A process-exit hook tears them all down so a SIGINT on the main dev
 *    server doesn't leak orphaned child servers.
 *
 * The command to run is resolved by `resolveServeCommand`: the configured
 * `worktreeServeCommand` override (plugin option → PINAGENT_WORKTREE_SERVE_COMMAND
 * env) wins; otherwise we infer it from the worktree's package.json.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { Storage } from './storage';

/** Base port for the per-worktree dev-server probe. Steps upward to find a
 *  free port. Kept clear of the WS server's 53636..53645 fallback window. */
const DEFAULT_BASE_PORT = 53700;
const PORT_PROBE_RANGE = 50;
/** How long to wait for a freshly-spawned dev server to accept connections
 *  before we report failure. Cold Vite/Next starts can be slow. */
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 250;

export interface ServeResult {
  /** Loadable app URL, e.g. `http://localhost:53700`. */
  url: string;
  port: number;
  /** True when an already-running server for this worktree was reused. */
  reused: boolean;
}

interface ServeEntry {
  port: number;
  child: ChildProcess;
  /** Resolved when the port first accepts a connection. */
  ready: Promise<void>;
}

// Pinned to globalThis so Vite/Next HMR module re-evaluation doesn't forget
// about already-running child servers and spawn duplicates. Mirrors the
// subscriber-set pinning in ws-server.ts.
const REGISTRY_SYMBOL = Symbol.for('pinagent.worktreeServers');
const registry: Map<string, ServeEntry> =
  ((globalThis as Record<symbol, unknown>)[REGISTRY_SYMBOL] as Map<string, ServeEntry>) ??
  new Map<string, ServeEntry>();
(globalThis as Record<symbol, unknown>)[REGISTRY_SYMBOL] = registry;

// Register the process-exit cleanup exactly once (HMR-safe).
const CLEANUP_SYMBOL = Symbol.for('pinagent.worktreeServersCleanup');
if (!(globalThis as Record<symbol, unknown>)[CLEANUP_SYMBOL]) {
  (globalThis as Record<symbol, unknown>)[CLEANUP_SYMBOL] = true;
  const killAll = (): void => {
    for (const id of [...registry.keys()]) killEntry(id);
  };
  process.once('exit', killAll);
  process.once('SIGINT', killAll);
  process.once('SIGTERM', killAll);
}

/**
 * Resolve the shell command that starts a dev server for a worktree.
 *
 * Resolution order:
 *  1. `override` (the `worktreeServeCommand` plugin option): trusted
 *     verbatim. A `{port}` placeholder is substituted with the chosen port;
 *     if absent, ` --port <port>` is appended so the server still binds
 *     where we expect.
 *  2. Inference from the worktree's package.json — detects the package
 *     manager from the lockfile and the framework (next vs vite) from
 *     dependencies, then runs the `dev` (or `start`) script with the
 *     framework's port flag.
 *
 * Returns null when no override is given and no runnable script is found —
 * the caller surfaces a "set worktreeServeCommand" hint.
 */
export function resolveServeCommand(args: {
  worktreePath: string;
  port: number;
  override?: string | undefined;
}): string | null {
  const { worktreePath, port, override } = args;

  if (override && override.trim().length > 0) {
    return override.includes('{port}')
      ? override.replaceAll('{port}', String(port))
      : `${override} --port ${port}`;
  }

  const pkg = readPackageJson(worktreePath);
  if (!pkg) return null;
  const scripts = pkg.scripts ?? {};
  const script = scripts.dev !== undefined ? 'dev' : scripts.start !== undefined ? 'start' : null;
  if (!script) return null;

  const pm = detectPackageManager(worktreePath);
  // Next uses `-p`, Vite (and most others) use `--port`.
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const portFlag = deps.next !== undefined ? `-p ${port}` : `--port ${port}`;

  // yarn (classic) forwards trailing args without a `--` separator; the
  // npm-family (npm/pnpm/bun) need `--` to pass args through to the script.
  return pm === 'yarn' ? `yarn ${script} ${portFlag}` : `${pm} run ${script} -- ${portFlag}`;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackageJson(dir: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return null;
  }
}

type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

function detectPackageManager(dir: string): PackageManager {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(dir, 'bun.lockb'))) return 'bun';
  // package-lock.json or nothing → npm is the safe default.
  return 'npm';
}

/**
 * Start (or reuse) a dev server for the given worktree and return its URL.
 *
 * Throws when the conversation has no worktree, the worktree directory is
 * gone, no command can be resolved, or the server doesn't accept
 * connections within the readiness timeout.
 */
export async function serveWorktree(
  projectRoot: string,
  feedbackId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ServeResult> {
  // Reuse a live server if one is already running for this worktree.
  const existing = registry.get(feedbackId);
  if (existing && isAlive(existing.child)) {
    await existing.ready;
    return { url: `http://localhost:${existing.port}`, port: existing.port, reused: true };
  }
  if (existing) registry.delete(feedbackId); // dead entry — clear it

  const storage = new Storage(projectRoot);
  const rec = await storage.read(feedbackId);
  if (!rec) throw new Error('conversation not found');
  if (!rec.worktreePath) throw new Error('conversation has no worktree to serve');
  if (!existsSync(rec.worktreePath)) {
    throw new Error(`worktree no longer exists at ${rec.worktreePath}`);
  }

  const basePort = Number(env.PINAGENT_WORKTREE_SERVE_BASE_PORT) || DEFAULT_BASE_PORT;
  const port = await findFreePort(basePort);

  const command = resolveServeCommand({
    worktreePath: rec.worktreePath,
    port,
    override: env.PINAGENT_WORKTREE_SERVE_COMMAND,
  });
  if (!command) {
    throw new Error(
      "couldn't infer a dev command for this worktree — set `worktreeServeCommand` in the pinagent plugin options",
    );
  }

  // Log the child's output so a failed start is debuggable instead of silent.
  const logDir = join(projectRoot, '.pinagent', 'logs');
  await mkdir(logDir, { recursive: true });
  const logStream = createWriteStream(join(logDir, `${feedbackId}-serve.log`), { flags: 'a' });

  // detached so we get a process group we can kill as a unit — `pnpm run dev`
  // spawns node which spawns the bundler; killing only the shell would orphan
  // the grandchildren. shell:true because the resolved command is a full
  // command line (trusted: developer config or their own package.json script).
  const child = spawn(command, {
    cwd: rec.worktreePath,
    env,
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  const ready = waitForPort(port, child);
  registry.set(feedbackId, { port, child, ready });

  // If the child dies before we ever marked it ready, drop the entry so a
  // retry re-spawns rather than reusing a corpse.
  child.once('exit', () => {
    if (registry.get(feedbackId)?.child === child) registry.delete(feedbackId);
  });

  try {
    await ready;
  } catch (err) {
    killEntry(feedbackId);
    throw err;
  }

  return { url: `http://localhost:${port}`, port, reused: false };
}

/** Stop the dev server for one worktree, if any. No-op when none is running. */
export function stopWorktreeServer(feedbackId: string): void {
  killEntry(feedbackId);
}

function killEntry(feedbackId: string): void {
  const entry = registry.get(feedbackId);
  if (!entry) return;
  registry.delete(feedbackId);
  const pid = entry.child.pid;
  if (pid === undefined) return;
  try {
    // Negative pid → kill the whole process group (see detached:true above).
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Already dead, or no group — fall back to killing the child directly.
    try {
      entry.child.kill('SIGTERM');
    } catch {
      // Nothing left to kill.
    }
  }
}

function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null && !child.killed;
}

/**
 * Find a free TCP port at or above `start`, walking upward. Throws if the
 * whole probe range is occupied.
 */
async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + PORT_PROBE_RANGE; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port in range ${start}..${start + PORT_PROBE_RANGE - 1}`);
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Resolve once `port` accepts a TCP connection (the dev server is up), or
 * reject if the child exits first or the readiness timeout elapses.
 */
function waitForPort(port: number, child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let settled = false;

    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    child.once('exit', (code) =>
      finish(new Error(`dev server exited before becoming ready (code ${code ?? 'unknown'})`)),
    );

    const attempt = (): void => {
      if (settled) return;
      const socket = createConnection({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        finish();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          finish(new Error(`dev server didn't start within ${READY_TIMEOUT_MS / 1000}s`));
          return;
        }
        setTimeout(attempt, READY_POLL_MS);
      });
    };

    attempt();
  });
}
