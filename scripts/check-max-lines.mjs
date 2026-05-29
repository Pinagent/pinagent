// SPDX-License-Identifier: Apache-2.0
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const MAX_LINES = 1000;

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css']);

// Files that predate the cap. Split them and remove from this list — do not add new entries.
const ALLOWLIST = new Set(['packages/widget/src/widget.ts', 'packages/agent-runner/src/agent.ts']);

function isGenerated(path) {
  return path.includes('__generated__') || path.includes('/dist/') || path.endsWith('.d.ts');
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const failures = [];

for (const file of tracked) {
  const dot = file.lastIndexOf('.');
  if (dot === -1 || !EXTENSIONS.has(file.slice(dot))) continue;
  if (isGenerated(file) || ALLOWLIST.has(file)) continue;

  const content = await readFile(join(ROOT, file), 'utf8');
  const lines = content.split('\n').length;
  if (lines > MAX_LINES) {
    failures.push({ file, lines });
  }
}

if (failures.length > 0) {
  failures.sort((a, b) => b.lines - a.lines);
  console.error(`The following file(s) exceed the ${MAX_LINES}-line limit:\n`);
  for (const { file, lines } of failures) {
    console.error(`  ${file}  (${lines} lines)`);
  }
  console.error(`\nSplit them into smaller modules to stay under ${MAX_LINES} lines.`);
  process.exit(1);
}

console.log(`File line counts OK (max ${MAX_LINES}).`);
