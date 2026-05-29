// SPDX-License-Identifier: Apache-2.0
/**
 * `pinagent init` — scaffold pinagent into a target project.
 *
 * pinagent is always a plugin embedded in the host app's own dev server
 * (Vite, Next, or Nuxt), so `init` cannot "just run" — it wires the project up:
 *
 *   - appends `.pinagent` to `.gitignore` (the on-disk feedback store
 *     must never be committed),
 *   - registers the MCP server in `.mcp.json` so a coding agent can read
 *     pending feedback,
 *   - for Next, creates the `app/pinagent/[[...slug]]/route.ts` handler
 *     (a deterministic re-export file the plugin's rewrite forwards to).
 *
 * The two genuinely risky edits — inserting the plugin into an arbitrary
 * `vite.config`/`next.config` and mounting `<Pinagent />` in the root
 * layout — are NOT automated. Rewriting hand-authored config via regex
 * corrupts more projects than it helps, so `init` instead prints the
 * exact snippet to paste. Everything it DOES touch is deterministic and
 * idempotent: re-running `init` on a wired project is a no-op.
 *
 * The pure planners (`planGitignore`, `planMcpJson`, `renderNextRoute`,
 * `detectRuntime`, `parseInitArgs`) are split from the fs executor so the
 * unit tests can pin behaviour without a real project on disk — the same
 * split `transcript.ts` uses.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type Runtime = 'vite' | 'next' | 'nuxt' | 'unknown';
export type PackageManager = 'pnpm' | 'yarn' | 'bun' | 'npm';

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts'];
const NEXT_CONFIGS = [
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.mts',
  'next.config.cjs',
];
const NUXT_CONFIGS = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs', 'nuxt.config.mts'];

/** Which supported runtime config files are present in `root`. */
export function configsPresent(root: string): { vite: boolean; next: boolean; nuxt: boolean } {
  const has = (names: string[]) => names.some((n) => existsSync(join(root, n)));
  return { vite: has(VITE_CONFIGS), next: has(NEXT_CONFIGS), nuxt: has(NUXT_CONFIGS) };
}

/**
 * Detect the host runtime from its config file. Pinagent supports React on
 * Vite or Next.js, and Vue on Nuxt. Nuxt is checked first because it runs
 * Vite under the hood — a Nuxt project's `nuxt.config.*` is the definitive
 * signal even if a stray `vite.config.*` is also present. If a project has
 * both vite and next configs, Vite wins here and `runInit` separately warns
 * about the ambiguity rather than letting the choice be silent.
 */
export function detectRuntime(root: string): Runtime {
  const { vite, next, nuxt } = configsPresent(root);
  if (nuxt) return 'nuxt';
  if (vite) return 'vite';
  if (next) return 'next';
  return 'unknown';
}

// Lockfile → package manager, in the priority order we resolve a single
// directory. `package-lock.json` is included so an npm project is matched
// explicitly (and stops the walk) rather than only via the fallback.
const LOCKFILES: ReadonlyArray<readonly [file: string, pm: PackageManager]> = [
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

/**
 * Detect the package manager from the nearest lockfile so we print the
 * right add command. Walks up from `root` to the filesystem root: a
 * sub-app inside a monorepo usually has no lockfile of its own, so we
 * pick up the workspace lockfile at the repo root instead of defaulting
 * to npm. The first lockfile found wins; if none exist anywhere, npm.
 */
export function detectPackageManager(root: string): PackageManager {
  let dir = resolve(root);
  for (;;) {
    for (const [file, pm] of LOCKFILES) {
      if (existsSync(join(dir, file))) return pm;
    }
    const parent = dirname(dir);
    if (parent === dir) return 'npm';
    dir = parent;
  }
}

export function pluginPackage(runtime: 'vite' | 'next' | 'nuxt'): string {
  switch (runtime) {
    case 'vite':
      return '@pinagent/vite-plugin';
    case 'next':
      return '@pinagent/next-plugin';
    case 'nuxt':
      return '@pinagent/nuxt-plugin';
  }
}

export function addDevDepCommand(pm: PackageManager, pkg: string): string {
  switch (pm) {
    case 'pnpm':
      return `pnpm add -D ${pkg}`;
    case 'yarn':
      return `yarn add -D ${pkg}`;
    case 'bun':
      return `bun add -d ${pkg}`;
    default:
      return `npm install -D ${pkg}`;
  }
}

export interface PlanResult {
  content: string;
  changed: boolean;
}

/**
 * Ensure `.gitignore` ignores `.pinagent`. Idempotent: a project that
 * already ignores it (with or without a trailing slash) is left alone.
 */
export function planGitignore(current: string | null): PlanResult {
  const lines = current ? current.split('\n') : [];
  const already = lines.some((l) => {
    const t = l.trim().replace(/\/+$/, '');
    return t === '.pinagent';
  });
  if (already) return { content: current ?? '', changed: false };
  const block = '\n# pinagent local feedback store (never commit)\n.pinagent\n';
  if (!current || current.length === 0) {
    return { content: block.replace(/^\n/, ''), changed: true };
  }
  const sep = current.endsWith('\n') ? '' : '\n';
  return { content: `${current}${sep}${block.replace(/^\n/, '')}`, changed: true };
}

interface McpJson {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

/**
 * Register the pinagent MCP server in `.mcp.json`. Uses `npx -y
 * @pinagent/cli mcp` so the entry is self-contained regardless of the
 * project's package manager or whether the CLI is installed globally.
 * Idempotent: an existing `pinagent` server entry is preserved verbatim
 * (the developer may have customised the command or env).
 */
export function planMcpJson(current: string | null): PlanResult {
  let parsed: McpJson = {};
  if (current && current.trim().length > 0) {
    try {
      parsed = JSON.parse(current) as McpJson;
    } catch {
      // Unparseable — refuse to clobber; signal "no change" so the
      // executor can warn instead of destroying hand-edited JSON.
      return { content: current, changed: false };
    }
  }
  const servers = (parsed.mcpServers ?? {}) as Record<string, unknown>;
  if (servers.pinagent) {
    return { content: current ?? '', changed: false };
  }
  const next: McpJson = {
    ...parsed,
    mcpServers: {
      ...servers,
      pinagent: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@pinagent/cli', 'mcp'],
      },
    },
  };
  return { content: `${JSON.stringify(next, null, 2)}\n`, changed: true };
}

/**
 * The Next route handler. Must be written exactly like this — Next
 * statically parses `dynamic`/`runtime` and refuses to follow a
 * re-export for those segment-config fields, so they're declared inline
 * while the request handlers are re-exported from the plugin.
 *
 * The `@pinagent/next-plugin` specifier is assembled from a variable
 * rather than written as a contiguous `from '...'` literal: this is
 * generated file content for the *consumer's* project (which installs
 * next-plugin itself — see the printed steps), not an import by the CLI.
 * Splitting it keeps the undeclared-import linter from mistaking it for a
 * real dependency of `@pinagent/cli`.
 */
export function renderNextRoute(): string {
  const routeModule = '@pinagent/next-plugin/route';
  return [
    '// SPDX-License-Identifier: Apache-2.0',
    "export const dynamic = 'force-dynamic';",
    "export const runtime = 'nodejs';",
    `export { GET, POST, PATCH } from '${routeModule}';`,
    '',
  ].join('\n');
}

/** Locate the Next `app/` directory — `app/` or `src/app/`. */
export function findAppDir(root: string): string | null {
  if (existsSync(join(root, 'app'))) return 'app';
  if (existsSync(join(root, 'src', 'app'))) return join('src', 'app');
  return null;
}

export interface InitArgs {
  dir: string;
  dryRun: boolean;
}

/**
 * Parse argv for `pinagent init`. Pure so the argv handling is unit
 * testable without running the fs executor.
 */
export function parseInitArgs(
  argv: string[],
  cwd: string = process.cwd(),
): InitArgs | { error: string } {
  let dir: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run' || arg === '-n') {
      dryRun = true;
    } else if (arg === '--dir' || arg === '-C') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) return { error: `${arg} requires a value` };
      dir = next;
      i++;
    } else if (arg && !arg.startsWith('-') && dir === null) {
      dir = arg;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  return { dir: dir ?? cwd, dryRun };
}

const read = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, 'utf8') : null;

export interface InitResult {
  /** Exit code: 0 success, 1 unsupported runtime. */
  code: number;
  /** Lines written to stdout (also the test surface). */
  lines: string[];
}

/**
 * Execute `init`. Reads/writes files under `args.dir`; with `dryRun` it
 * reports what it WOULD do without touching disk. Returns the output
 * lines and an exit code so the caller (and tests) stay side-effect free
 * w.r.t. stdout.
 */
export function runInit(args: InitArgs): InitResult {
  const root = args.dir;
  const lines: string[] = [];
  const note = (s: string) => lines.push(s);

  const runtime = detectRuntime(root);
  if (runtime === 'unknown') {
    note('pinagent init: no vite.config.*, next.config.*, or nuxt.config.* found in');
    note(`  ${root}`);
    note('');
    note('pinagent supports React on Vite or Next.js (App Router), and Vue on Nuxt.');
    note('Run init from your project root, or pass it explicitly:');
    note('  pinagent init --dir /path/to/app');
    return { code: 1, lines };
  }

  const pm = detectPackageManager(root);
  const pkg = pluginPackage(runtime);
  const tag = args.dryRun ? '[dry-run] would' : 'wrote';

  const runtimeLabel =
    runtime === 'vite' ? 'Vite + React' : runtime === 'next' ? 'Next.js' : 'Nuxt';
  note(`pinagent init — detected ${runtimeLabel} (${pm})`);
  // Both configs present is genuinely ambiguous — surface it rather than
  // letting detectRuntime's silent "Vite wins" tiebreak stand unseen.
  const present = configsPresent(root);
  if (present.vite && present.next) {
    note('');
    note('! found both vite.config.* and next.config.* — proceeding as Vite.');
    note('  If this project is actually Next.js, re-run against the right root:');
    note('    pinagent init --dir /path/to/next-app');
  }
  note('');

  const writeFile = (relPath: string, content: string) => {
    if (args.dryRun) return;
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };

  // 1. .gitignore
  const giPath = join(root, '.gitignore');
  const gi = planGitignore(read(giPath));
  if (gi.changed) {
    writeFile('.gitignore', gi.content);
    note(`✓ ${tag} .gitignore (ignore .pinagent)`);
  } else {
    note('· .gitignore already ignores .pinagent');
  }

  // 2. .mcp.json
  const mcpPath = join(root, '.mcp.json');
  const existingMcp = read(mcpPath);
  const mcp = planMcpJson(existingMcp);
  if (mcp.changed) {
    writeFile('.mcp.json', mcp.content);
    note(`✓ ${tag} .mcp.json (register pinagent MCP server)`);
  } else if (existingMcp && !mcp.changed && existingMcp.trim() && !isParseable(existingMcp)) {
    note('! .mcp.json exists but is not valid JSON — left untouched. Add manually:');
    note('    "pinagent": { "type": "stdio", "command": "npx",');
    note('                  "args": ["-y", "@pinagent/cli", "mcp"] }');
  } else {
    note('· .mcp.json already has a pinagent server');
  }

  // 3. Next-only: the route handler file.
  if (runtime === 'next') {
    const appDir = findAppDir(root);
    if (!appDir) {
      note('! could not find an app/ directory — create the route handler manually:');
      note('    app/pinagent/[[...slug]]/route.ts');
    } else {
      const routeRel = join(appDir, 'pinagent', '[[...slug]]', 'route.ts');
      if (existsSync(join(root, routeRel))) {
        note(`· ${routeRel} already exists`);
      } else {
        writeFile(routeRel, renderNextRoute());
        note(`✓ ${tag} ${routeRel}`);
      }
    }
  }

  // Manual steps — the edits too risky to automate.
  note('');
  note('Next steps (do these by hand):');
  note('');
  note(`  1. Install the plugin:`);
  note(`       ${addDevDepCommand(pm, pkg)}`);
  note('');
  if (runtime === 'vite') {
    note('  2. Add the plugin to vite.config.* — pinagent() first in the array:');
    note("       import pinagent from '@pinagent/vite-plugin';");
    note('       export default defineConfig({');
    note('         plugins: [pinagent(), react()],');
    note('       });');
    note('');
    note('  3. Start your dev server as usual (e.g. `npm run dev`).');
  } else if (runtime === 'nuxt') {
    // `pkg` (= @pinagent/nuxt-plugin) is interpolated rather than written as a
    // literal `'...'` so the undeclared-import linter doesn't read this example
    // snippet as a real dependency of the CLI.
    note('  2. Add the module to nuxt.config.* — in the `modules` array:');
    note('       export default defineNuxtConfig({');
    note(`         modules: ['${pkg}'],`);
    note('       });');
    note('');
    note('  3. Start your dev server as usual (e.g. `npm run dev`).');
  } else {
    // `pkg` (= @pinagent/next-plugin) is interpolated rather than written
    // as a literal `from '...'` so the undeclared-import linter doesn't read
    // these example snippets as a real dependency of the CLI.
    note('  2. Wrap next.config.* with the plugin:');
    note(`       import pinagent from '${pkg}/config';`);
    note('       export default pinagent(nextConfig);');
    note('');
    note('  3. Mount <Pinagent /> at the end of <body> in app/layout.tsx:');
    note(`       import { Pinagent } from '${pkg}';`);
    note('       // ...<body>{children}<Pinagent /></body>');
    note('');
    note('  4. Start your dev server as usual (e.g. `npm run dev`).');
  }
  note('');
  note('Then open the app, click the 💬 button, pick an element, and submit.');
  if (args.dryRun) {
    note('');
    note('(dry run — no files were written)');
  }
  return { code: 0, lines };
}

function isParseable(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}
