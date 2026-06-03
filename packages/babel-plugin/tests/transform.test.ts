// SPDX-License-Identifier: Apache-2.0
import { parse } from '@babel/parser';
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
    const out = transform('const X = <Foo />;');
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
    const out = transform('const X = <><span>a</span></>;');
    expect(out).not.toBeNull();
    // The <span> gets tagged. The fragment itself doesn't have a name
    // to attach an attribute to.
    const matches = out!.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(1);
    expect(out).toContain('<span data-pa-loc=');
  });

  it('is idempotent — running twice does not double-tag', () => {
    const once = transform('const X = <Foo />;');
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
    const out = transform('const X = <Foo.Bar />;');
    expect(out).not.toBeNull();
    expect(out).toMatch(tagPattern);
  });

  it('skips namespaced names (e.g. <svg:circle />) — uncommon, opt-out by spec', () => {
    const out = transform('const X = <svg:circle />;');
    // No tag added → no mutation → null
    expect(out).toBeNull();
  });

  it('preserves source line/column relationship to the inserted attribute', () => {
    // <Foo on line 1 col 11 (0-indexed col 10, +1 → 11)
    const out = transform('const X = <Foo />;');
    expect(out).toContain(`data-pa-loc="${RELPATH}:1:11"`);
  });

  it('uses ts:false when given a plain .jsx file', () => {
    // No TS-specific syntax in the input but parser must still accept it
    // without the typescript plugin.
    const out = transformJsx('const X = <Foo />;', { relPath: 'Foo.jsx', ts: false });
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

describe('transformJsx — data-pa-comp (enclosing component)', () => {
  it('tags the enclosing function component name', () => {
    const out = transform(`
      function PriceCard() {
        return <div><button>Buy</button></div>;
      }
    `);
    expect(out).not.toBeNull();
    // Both host nodes carry the same enclosing component.
    expect(out).toContain('<div data-pa-loc=');
    const comps = out!.match(/data-pa-comp="PriceCard"/g) ?? [];
    expect(comps.length).toBe(2);
  });

  it('tags arrow-function components assigned to a PascalCase const', () => {
    const out = transform('const PriceCard = () => <div>hi</div>;');
    expect(out).toContain('data-pa-comp="PriceCard"');
  });

  it('reports the owning component for JSX inside a .map() callback', () => {
    // The <li> lives in an anonymous arrow callback — the nearest
    // PascalCase owner is PriceList, which is what every instance shares.
    const out = transform(`
      function PriceList({ items }) {
        return <ul>{items.map((i) => <li>{i}</li>)}</ul>;
      }
    `);
    expect(out).not.toBeNull();
    expect(out).toMatch(/<li data-pa-loc="[^"]+" data-pa-comp="PriceList"/);
    expect(out).toMatch(/<ul data-pa-loc="[^"]+" data-pa-comp="PriceList"/);
  });

  it('uses the nearest component for nested component definitions', () => {
    const out = transform(`
      function Outer() {
        function Inner() { return <span/>; }
        return <Inner/>;
      }
    `);
    expect(out).not.toBeNull();
    expect(out).toContain('<span data-pa-loc=');
    expect(out).toMatch(/<span [^>]*data-pa-comp="Inner"/);
    expect(out).toMatch(/<Inner [^>]*data-pa-comp="Outer"/);
  });

  it('tags class-component JSX with the class name', () => {
    const out = transform(`
      class PriceCard extends Component {
        render() { return <div/>; }
      }
    `);
    expect(out).not.toBeNull();
    expect(out).toContain('data-pa-comp="PriceCard"');
  });

  it('omits data-pa-comp outside any PascalCase component', () => {
    // Top-level JSX in a module — no enclosing component.
    const out = transform('const x = <div/>;');
    expect(out).not.toBeNull();
    expect(out).toContain('data-pa-loc=');
    expect(out).not.toContain('data-pa-comp=');
  });

  it('omits data-pa-comp for JSX in a lowercase helper', () => {
    const out = transform(`
      function renderRow() { return <tr/>; }
    `);
    expect(out).not.toBeNull();
    expect(out).not.toContain('data-pa-comp=');
  });

  it('stays idempotent with the component attribute present', () => {
    const once = transform('function PriceCard() { return <div/>; }');
    expect(once).not.toBeNull();
    expect(once).toContain('data-pa-comp="PriceCard"');
    // Re-running finds the element already tagged → no mutation → null.
    expect(transform(once!)).toBeNull();
  });

  it('tags a generic component without producing unparseable output', () => {
    // Type args (`<string>`) sit between the name and the attributes; the tag
    // must land AFTER them, not inside the `<...>`.
    const out = transform('const X = <Foo<string> a={1} />;');
    expect(out).not.toBeNull();
    expect(out).toMatch(tagPattern);
    // The attribute lands after the type arguments…
    expect(out).toContain('<Foo<string> data-pa-loc=');
    // …and the result is valid TSX (strict parse, no error recovery).
    expect(() =>
      parse(out as string, {
        sourceType: 'module',
        // biome-ignore lint/suspicious/noExplicitAny: babel plugin tuple typing
        plugins: ['jsx', 'typescript'] as any,
        errorRecovery: false,
      }),
    ).not.toThrow();
  });

  it('tags a generic member-expression component', () => {
    const out = transform('const X = <UI.Table<Row> rows={[]} />;');
    expect(out).toContain('<UI.Table<Row> data-pa-loc=');
    expect(() =>
      parse(out as string, {
        sourceType: 'module',
        // biome-ignore lint/suspicious/noExplicitAny: babel plugin tuple typing
        plugins: ['jsx', 'typescript'] as any,
        errorRecovery: false,
      }),
    ).not.toThrow();
  });
});
