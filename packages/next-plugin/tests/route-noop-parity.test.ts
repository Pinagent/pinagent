// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Verb-parity guard between the dev route handler (`src/route.ts`) and its
 * production stub (`src/route-noop.ts`).
 *
 * The `"default"` package.json export condition swaps in `route-noop` for
 * production bundles. If it exports fewer HTTP verbs than `route.ts`, a
 * consumer whose generated `route.ts` re-exports a fixed verb list
 * (`export { GET, POST, PATCH, PUT, DELETE } from ...`) hard-fails the
 * production build with "Export DELETE doesn't exist". An `export *`
 * consumer silently loses those verbs to Next's default 405 instead of
 * the stub's inert 404. Either way the two modules must agree.
 *
 * We assert on statically-parsed export NAMES (not behavior): importing
 * `src/route.ts` pulls its heavy transitive deps and runs its top-level
 * WS-server block, which `route.test.ts` already covers. Here we only need
 * the export surface, so we read the source and match the verb declarations.
 */

const SRC = join(__dirname, '..', 'src');
const HTTP_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** Collect the HTTP-verb names a module exports, by static source parse. */
function exportedVerbs(file: string): Set<string> {
  const source = readFileSync(join(SRC, file), 'utf8');
  const found = new Set<string>();
  for (const verb of HTTP_VERBS) {
    // Matches both `export const VERB =` and `export [async ]function VERB(`.
    const pattern = new RegExp(
      `^export\\s+(?:const\\s+${verb}\\s*=|(?:async\\s+)?function\\s+${verb}\\b)`,
      'm',
    );
    if (pattern.test(source)) found.add(verb);
  }
  return found;
}

describe('route / route-noop verb parity', () => {
  it('exports the same set of HTTP verbs from both modules', () => {
    const route = exportedVerbs('route.ts');
    const noop = exportedVerbs('route-noop.ts');

    // Sanity: the parser actually found verbs (guards against a regex that
    // silently matches nothing and trivially "passes" with two empty sets).
    expect(route.size).toBeGreaterThan(0);
    expect(noop.size).toBeGreaterThan(0);

    const sorted = (s: Set<string>) => [...s].sort();
    expect(sorted(noop)).toEqual(sorted(route));
  });
});
