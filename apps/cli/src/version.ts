// SPDX-License-Identifier: Apache-2.0
/**
 * Read the CLI's own version from its package.json. Resolved relative to
 * this module so it works both from `dist/index.js` (package.json one
 * level up) and from source under test.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function readVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
