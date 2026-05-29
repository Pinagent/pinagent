// SPDX-License-Identifier: Apache-2.0
/**
 * The webpack loader entry (loader.ts) wraps the same `transformJsx` the
 * Vite plugin uses. These tests drive it through a fake LoaderContext so
 * the resource-filtering, project-relative path derivation, and error
 * propagation are covered without a webpack harness.
 */
import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import pinagentLoader from '../src/loader';

interface CbResult {
  err: Error | null;
  content?: string;
}

/**
 * Invoke the loader with a synthetic context and capture the async
 * callback result. `rootContext` defaults to a POSIX-style root; the
 * loader joins with `sep` internally, so tests use `sep` to stay
 * platform-neutral.
 */
function run(source: string, resourcePath: string, rootContext = `${sep}project`): CbResult {
  let captured: CbResult | undefined;
  const ctx = {
    resourcePath,
    rootContext,
    async: () => (err: Error | null, content?: string) => {
      captured = { err, content };
    },
  };
  pinagentLoader.call(ctx, source);
  if (!captured) throw new Error('loader did not invoke its async callback');
  return captured;
}

const p = (...parts: string[]) => parts.join(sep);

describe('pinagentLoader resource filtering', () => {
  it('passes non-jsx/tsx files through untouched', () => {
    const src = 'export const x = 1;';
    const { err, content } = run(src, p('', 'project', 'src', 'util.ts'));
    expect(err).toBeNull();
    expect(content).toBe(src);
  });

  it('passes node_modules files through untouched even if they are tsx', () => {
    const src = 'export const C = () => <div/>;';
    const { err, content } = run(src, p('', 'project', 'node_modules', 'lib', 'C.tsx'));
    expect(err).toBeNull();
    expect(content).toBe(src);
  });
});

describe('pinagentLoader transform', () => {
  it('injects data-pa-loc with the project-relative path for a tsx file', () => {
    const src = 'export const C = () => <div>hi</div>;';
    const { err, content } = run(src, p('', 'project', 'src', 'Foo.tsx'));
    expect(err).toBeNull();
    // relPath is derived from rootContext and normalized to POSIX.
    expect(content).toMatch(/data-pa-loc="src\/Foo\.tsx:\d+:\d+"/);
  });

  it('returns the original source when transform finds no JSX', () => {
    // A .tsx file with no JSX: transformJsx returns null, loader falls back
    // to the original source rather than emitting `undefined`.
    const src = 'export const n: number = 1;';
    const { err, content } = run(src, p('', 'project', 'src', 'NoJsx.tsx'));
    expect(err).toBeNull();
    expect(content).toBe(src);
  });

  it('treats a resource outside the root by its absolute path', () => {
    const src = 'export const C = () => <span/>;';
    const { content } = run(src, p('', 'elsewhere', 'Bar.tsx'), p('', 'project'));
    // Outside rootContext -> relativeFrom returns the absolute path, which
    // still gets POSIX-normalized into the attribute.
    expect(content).toMatch(/data-pa-loc=".*Bar\.tsx:\d+:\d+"/);
  });
});
