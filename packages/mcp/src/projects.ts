// SPDX-License-Identifier: Apache-2.0
// The set of Pinagent projects one MCP process serves.
//
// Each project is one dev-server root — the directory holding a
// `.pinagent/db.sqlite`. Classic installs serve exactly one (`single`); a
// monorepo with several wired apps can point one server at all of them
// (`PINAGENT_PROJECT_ROOTS` / `PINAGENT_WORKSPACE_ROOT`, see root.ts) instead
// of registering one MCP server per app. Every project keeps its own
// `Storage` over its own SQLite file — there is no merged store; the set only
// fans reads out and routes id-addressed calls to the DB that holds the id.
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { discoverProjectRoots, type ProjectRootsConfig } from './root';
import { type FeedbackRecord, isInsideRoot, Storage } from './storage';

export interface Project {
  /** Short, unique label (path relative to the workspace / common ancestor). */
  readonly name: string;
  /** Absolute project root — where the dev server runs and `.pinagent/` lives. */
  readonly root: string;
  readonly storage: Storage;
}

export type Located =
  | { ok: true; project: Project; rec: FeedbackRecord }
  | { ok: false; error: string };

/** How often a workspace scan may re-run to pick up newly created `.pinagent/` dirs. */
const DEFAULT_RESCAN_MS = 10_000;

export interface ProjectSetOptions {
  rescanMs?: number;
  now?: () => number;
}

export class ProjectSet {
  /**
   * True when configured for multiple roots. Gates every multi-root
   * addition to tool schemas, output and channel events, so a classic
   * single-root server's surface is unchanged.
   */
  readonly multi: boolean;
  private readonly workspaceRoot: string | null;
  private readonly labelBase: string | null;
  private readonly byRoot = new Map<string, Project>();
  private readonly names = new Set<string>();
  private readonly rescanMs: number;
  private readonly now: () => number;
  private lastScan = Number.NEGATIVE_INFINITY;

  private constructor(
    multi: boolean,
    roots: string[],
    workspaceRoot: string | null,
    opts: ProjectSetOptions,
    storage?: Storage,
  ) {
    this.multi = multi;
    this.workspaceRoot = workspaceRoot;
    this.rescanMs = opts.rescanMs ?? DEFAULT_RESCAN_MS;
    this.now = opts.now ?? Date.now;
    this.labelBase = workspaceRoot ?? commonAncestor(roots);
    for (const root of roots) this.add(root, storage);
  }

  /** The classic one-root server. */
  static single(root: string, storage: Storage = new Storage(root)): ProjectSet {
    return new ProjectSet(false, [root], null, {}, storage);
  }

  static fromConfig(cfg: ProjectRootsConfig, opts: ProjectSetOptions = {}): ProjectSet {
    if (!cfg.multi) return ProjectSet.single(cfg.roots[0] ?? process.cwd());
    return new ProjectSet(true, cfg.roots, cfg.workspaceRoot, opts);
  }

  /**
   * Every served project, explicit roots first, then discovered ones in scan
   * order. With a workspace root configured this re-scans at most once per
   * `rescanMs` (or immediately with `fresh: true`) so an app whose dev server
   * first runs mid-session is picked up without restarting the MCP server.
   */
  list(opts: { fresh?: boolean } = {}): Project[] {
    if (this.workspaceRoot) {
      const t = this.now();
      if (opts.fresh || t - this.lastScan >= this.rescanMs) {
        this.lastScan = t;
        for (const root of discoverProjectRoots(this.workspaceRoot)) this.add(root);
      }
    }
    return [...this.byRoot.values()];
  }

  /** Resolve a `project` tool argument (a project name or absolute root). */
  select(selector: string): { ok: true; project: Project } | { ok: false; error: string } {
    const find = (projects: Project[]) =>
      projects.find((p) => p.name === selector) ??
      (isAbsolute(selector) ? projects.find((p) => p.root === resolve(selector)) : undefined);
    const hit = find(this.list()) ?? (this.workspaceRoot ? find(this.list({ fresh: true })) : null);
    if (hit) return { ok: true, project: hit };
    return {
      ok: false,
      error: `unknown project "${selector}" — expected one of: ${this.describe()}`,
    };
  }

  /**
   * Find the project holding feedback `id`. Ids are nanoids, so a hit in
   * more than one DB only happens when a DB was copied between apps — that
   * is reported as ambiguous rather than guessed at. `noun` keeps the
   * single-root error text identical to what it always was.
   */
  async locate(id: string, selector?: string, noun = 'feedback'): Promise<Located> {
    let scope: Project[];
    if (selector && this.multi) {
      const sel = this.select(selector);
      if (!sel.ok) return sel;
      scope = [sel.project];
    } else {
      scope = this.list();
    }
    let hits = await readAll(scope, id);
    if (hits.length === 0 && this.multi && !selector && this.workspaceRoot) {
      // The id may live in an app discovered since the last scan.
      const known = new Set(scope.map((p) => p.root));
      hits = await readAll(
        this.list({ fresh: true }).filter((p) => !known.has(p.root)),
        id,
      );
    }
    if (hits.length === 1) return { ok: true, ...hits[0]! };
    if (hits.length > 1) {
      return {
        ok: false,
        error: `${noun} ${id} exists in more than one project (${hits
          .map((h) => h.project.name)
          .join(', ')}) — pass \`project\` to choose`,
      };
    }
    if (!this.multi) return { ok: false, error: `${noun} ${id} not found` };
    return {
      ok: false,
      error: selector
        ? `${noun} ${id} not found in project ${scope[0]?.name}`
        : `${noun} ${id} not found in any pinagent project (${this.describe()})`,
    };
  }

  /** The project whose root contains `abs` (the deepest one, if roots nest). */
  rootFor(abs: string): Project | null {
    let best: Project | null = null;
    for (const p of this.list()) {
      if (!isInsideRoot(p.root, abs)) continue;
      if (!best || p.root.length > best.root.length) best = p;
    }
    return best;
  }

  /** `name (root), …` — for error messages and startup logs. */
  describe(): string {
    const all = this.list();
    if (all.length === 0) {
      return this.workspaceRoot ? `none found yet under ${this.workspaceRoot}` : 'none configured';
    }
    return all.map((p) => `${p.name} (${p.root})`).join(', ');
  }

  private add(root: string, storage?: Storage): void {
    const abs = resolve(root);
    if (this.byRoot.has(abs)) return;
    const name = this.labelFor(abs);
    this.names.add(name);
    this.byRoot.set(abs, { name, root: abs, storage: storage ?? new Storage(abs) });
  }

  private labelFor(root: string): string {
    let name = root;
    if (this.labelBase) {
      const rel = relative(this.labelBase, root);
      if (rel === '') name = basename(root) || root;
      else if (!rel.startsWith('..') && !isAbsolute(rel)) name = rel.split(sep).join('/');
    }
    // Names double as the `project` tool argument, so they must be unique;
    // the absolute root always is.
    return this.names.has(name) ? root : name;
  }
}

async function readAll(
  projects: Project[],
  id: string,
): Promise<{ project: Project; rec: FeedbackRecord }[]> {
  const reads = await Promise.all(
    projects.map(async (project) => ({ project, rec: await project.storage.read(id) })),
  );
  return reads.filter((r): r is { project: Project; rec: FeedbackRecord } => r.rec !== null);
}

/** Deepest directory containing every path, or null for an empty list. */
function commonAncestor(paths: string[]): string | null {
  if (paths.length === 0) return null;
  if (paths.length === 1) return dirname(resolve(paths[0]!));
  let base = resolve(paths[0]!);
  for (const p of paths.slice(1)) {
    while (!isInsideRoot(base, p)) {
      const parent = dirname(base);
      if (parent === base) return base;
      base = parent;
    }
  }
  return base;
}
