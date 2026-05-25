import { describe, expect, it } from 'vitest';
import { transformJsx } from '../src/transform';

const RELPATH = 'src/Foo.tsx';

function transform(code: string, ts = true): string | null {
  return transformJsx(code, { relPath: RELPATH, ts });
}

/**
 * The shape of the inserted attribute matches `<relPath>:<line>:<col>`.
 * Babel's `loc.column` is 0-indexed; transform.ts adds +1, so columns
 * match what an editor's "go to line:col" feature would expect.
 */
const tagPattern = new RegExp(`data-pa-loc="${RELPATH}:\\d+:\\d+"`);

describe('transformJsx', () => {
  it('returns null for files with no JSX', () => {
    expect(transform('const x = 1;')).toBeNull();
    expect(transform('function foo() { return "hi"; }')).toBeNull();
  });

  it('returns null for plain text / unparseable garbage', () => {
    // Babel's errorRecovery=true means most things parse — but no JSX
    // means we return null up front.
    expect(transform('not jsx at all just text')).toBeNull();
  });

  it('tags a single self-closing element', () => {
    const out = transform(`const X = <Foo />;`);
    expect(out).not.toBeNull();
    expect(out).toMatch(tagPattern);
    expect(out).toContain('<Foo data-pa-loc=');
  });

  it('tags an element with existing attributes', () => {
    const out = transform(`const X = <Foo bar="baz" />;`);
    expect(out).toMatch(tagPattern);
    // Original attrs preserved.
    expect(out).toContain('bar="baz"');
  });

  it('tags nested elements', () => {
    const out = transform(`
      function App() {
        return (
          <div>
            <span>hi</span>
          </div>
        );
      }
    `);
    expect(out).not.toBeNull();
    // Two opening elements -> two tags.
    const matches = out!.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('does not tag fragments', () => {
    const out = transform(`const X = <><span>a</span></>;`);
    expect(out).not.toBeNull();
    // The <span> gets tagged. The fragment itself doesn't have a name
    // to attach an attribute to.
    const matches = out!.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(1);
    expect(out).toContain('<span data-pa-loc=');
  });

  it('is idempotent — running twice does not double-tag', () => {
    const once = transform(`const X = <Foo />;`);
    expect(once).not.toBeNull();
    const twice = transform(once!);
    // No second tag added → no mutation → null returned.
    expect(twice).toBeNull();
  });

  it('tags conditional JSX in both branches', () => {
    const out = transform(`
      function App({ ok }) {
        return ok ? <Yes /> : <No />;
      }
    `);
    expect(out).not.toBeNull();
    expect(out).toContain('<Yes data-pa-loc=');
    expect(out).toContain('<No data-pa-loc=');
  });

  it('tags member-expression names (e.g. <Foo.Bar />)', () => {
    const out = transform(`const X = <Foo.Bar />;`);
    expect(out).not.toBeNull();
    expect(out).toMatch(tagPattern);
  });

  it('skips namespaced names (e.g. <svg:circle />) — uncommon, opt-out by spec', () => {
    const out = transform(`const X = <svg:circle />;`);
    // No tag added → no mutation → null
    expect(out).toBeNull();
  });

  it('preserves source line/column relationship to the inserted attribute', () => {
    // <Foo on line 1 col 11 (0-indexed col 10, +1 → 11)
    const out = transform(`const X = <Foo />;`);
    expect(out).toContain(`data-pa-loc="${RELPATH}:1:11"`);
  });

  it('uses ts:false when given a plain .jsx file', () => {
    // No TS-specific syntax in the input but parser must still accept it
    // without the typescript plugin.
    const out = transformJsx(`const X = <Foo />;`, { relPath: 'Foo.jsx', ts: false });
    expect(out).not.toBeNull();
  });

  it('tags every opening element in a fragment-with-children', () => {
    const out = transform(`
      const X = <>
        <a/>
        <b/>
        <c/>
      </>;
    `);
    expect(out).not.toBeNull();
    const matches = out!.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(3);
  });
});
