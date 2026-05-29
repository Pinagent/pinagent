// SPDX-License-Identifier: Apache-2.0
/**
 * `isInsideRoot` is the second half of `get_source_context`'s
 * path-traversal defense (the `..` string check is the first). It must
 * accept the root itself and any descendant, and reject anything that
 * `path.relative` resolves to outside the root — including sibling
 * directories whose name shares a prefix with the root.
 */
import { describe, expect, it } from 'vitest';
import { isInsideRoot } from '../src/storage';

const ROOT = '/home/user/project';

describe('isInsideRoot', () => {
  it('accepts the root directory itself', () => {
    expect(isInsideRoot(ROOT, ROOT)).toBe(true);
  });

  it('accepts files nested inside the root', () => {
    expect(isInsideRoot(ROOT, `${ROOT}/src/App.tsx`)).toBe(true);
    expect(isInsideRoot(ROOT, `${ROOT}/a/b/c/deep.ts`)).toBe(true);
  });

  it('rejects parent and ancestor paths', () => {
    expect(isInsideRoot(ROOT, '/home/user')).toBe(false);
    expect(isInsideRoot(ROOT, '/etc/passwd')).toBe(false);
  });

  it('rejects a path that escapes via ..', () => {
    expect(isInsideRoot(ROOT, `${ROOT}/../secrets`)).toBe(false);
  });

  it('rejects a sibling directory that shares the root name prefix', () => {
    // `/home/user/project-evil` must NOT be considered inside
    // `/home/user/project` — a naive `startsWith` check would wrongly
    // accept it; `path.relative` yields `../project-evil`.
    expect(isInsideRoot(ROOT, '/home/user/project-evil/x.ts')).toBe(false);
  });

  it('normalizes the target before comparing', () => {
    expect(isInsideRoot(ROOT, `${ROOT}/src/../lib/y.ts`)).toBe(true);
  });
});
