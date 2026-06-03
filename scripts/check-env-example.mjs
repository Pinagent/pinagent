// SPDX-License-Identifier: Apache-2.0
//
// Drift check between each app's env contract file (.dev.vars.example /
// .env.example) and the variables its code actually reads. Run by
// `pnpm lint:env-example`.
//
// The example files are the human-readable contract a developer copies before
// running the cloud control plane / relay / dashboard locally (the values
// themselves live in Doppler). This guards them from rotting: if code starts
// reading a new env var, or stops reading a documented one, CI fails until the
// example file matches.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * One target = a source file we scan for env reads + the example file that must
 * document them. `extract` returns the set of variable names the source reads.
 */
const TARGETS = [
  {
    name: '@pinagent/cloud',
    source: 'apps/cloud/src/config.ts',
    example: 'apps/cloud/.dev.vars.example',
    // loadCloudConfig pulls everything via required()/positiveInt()/env.X.
    extract: (src) =>
      collect(src, [
        /\brequired\(env,\s*'([A-Z][A-Z0-9_]*)'\)/g,
        /\bpositiveInt\(env,\s*'([A-Z][A-Z0-9_]*)'\)/g,
        /\benv\.([A-Z][A-Z0-9_]*)/g,
      ]),
  },
  {
    name: '@pinagent/ee-relay',
    source: 'ee/packages/relay/src/worker.ts',
    example: 'ee/packages/relay/.dev.vars.example',
    // The `Env` interface lists bindings; keep only the string-typed ones
    // (RELAY is a DurableObjectNamespace binding, not an env var).
    extract: (src) => {
      const body = src.match(/export interface Env \{([\s\S]*?)\n\}/);
      if (!body) throw new Error('could not find `export interface Env` in worker.ts');
      return collect(body[1], [/^\s*([A-Z][A-Z0-9_]*)\??:\s*string/gm]);
    },
  },
  {
    name: '@pinagent/cloud-dashboard',
    source: 'apps/cloud-dashboard/next.config.ts',
    example: 'apps/cloud-dashboard/.env.example',
    extract: (src) => collect(src, [/\bprocess\.env\.([A-Z][A-Z0-9_]*)/g]),
  },
];

function collect(text, patterns) {
  const found = new Set();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.add(m[1]);
  }
  return found;
}

/** Variable names declared in an example file: `NAME=` lines, commented or not. */
function parseExample(text) {
  const declared = new Set();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/);
    if (m) declared.add(m[1]);
  }
  return declared;
}

let failures = 0;

for (const target of TARGETS) {
  const code = await readFile(join(ROOT, target.source), 'utf8');
  const example = await readFile(join(ROOT, target.example), 'utf8');

  const read = target.extract(code);
  const documented = parseExample(example);

  const undocumented = [...read].filter((v) => !documented.has(v)).sort();
  const stale = [...documented].filter((v) => !read.has(v)).sort();

  if (undocumented.length || stale.length) {
    failures++;
    console.error(`\n✗ ${target.name}`);
    console.error(`  source:  ${target.source}`);
    console.error(`  example: ${target.example}`);
    if (undocumented.length) {
      console.error(`  read in code but missing from the example file: ${undocumented.join(', ')}`);
    }
    if (stale.length) {
      console.error(`  documented but no longer read in code: ${stale.join(', ')}`);
    }
  } else {
    console.log(`✓ ${target.name} (${read.size} vars in sync)`);
  }
}

if (failures) {
  console.error(`\n${failures} env contract(s) out of sync. Update the example file(s) above.`);
  process.exit(1);
}
console.log('\nAll env contracts in sync.');
