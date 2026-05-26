// SPDX-License-Identifier: Apache-2.0
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const TREES = [
  { dir: 'packages', license: 'Apache-2.0' },
  { dir: 'ee/packages', license: 'Elastic-2.0' },
  { dir: 'apps/cli', license: 'Apache-2.0' },
  { dir: 'apps/cloud', license: 'Elastic-2.0' },
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', '.next', '__generated__']);
const EXTENSIONS = new Set(['.ts', '.tsx']);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot !== -1 && EXTENSIONS.has(entry.name.slice(dot))) {
        yield path;
      }
    }
  }
}

const failures = [];

for (const { dir, license } of TREES) {
  const root = join(ROOT, dir);
  const expected = `SPDX-License-Identifier: ${license}`;
  for await (const file of walk(root)) {
    const content = await readFile(file, 'utf8');
    const firstLine = content.split('\n', 1)[0] ?? '';
    if (!firstLine.includes(expected)) {
      failures.push({ file: relative(ROOT, file), expected });
    }
  }
}

if (failures.length > 0) {
  console.error(`Missing or incorrect SPDX headers in ${failures.length} file(s):\n`);
  for (const { file, expected } of failures) {
    console.error(`  ${file}  (expected: // ${expected})`);
  }
  console.error(
    '\nAdd the header as the first line of each file. See plan: pinpoint-monorepo spec §3.3.',
  );
  process.exit(1);
}

console.log('SPDX headers OK.');
