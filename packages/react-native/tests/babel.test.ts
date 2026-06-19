// SPDX-License-Identifier: Apache-2.0
/**
 * `@pinagent/react-native/babel` — the Metro/Babel source-tagging plugin
 * (src/babel.ts).
 *
 * The plugin's JSXOpeningElement visitor only ever inspects and mutates plain
 * AST nodes, so we exercise it by invoking the visitor directly with a tiny
 * duck-typed stand-in for the `@babel/types` namespace and hand-built nodes.
 * That keeps this test free of a `@babel/core` dependency — adding one would
 * re-hash the workspace's shared babel peer-dependency graph in the lockfile
 * (and has historically flipped the nuxt-plugin onto a mismatched vite
 * identity). The behaviour under test is pure AST array manipulation, which a
 * direct invocation pins exactly.
 *
 * The load-bearing case is GENERIC WRAPPER COMPONENTS. Apps wrap the host
 * primitives — `const View = (props) => <ViewRn {...props} />` — and use the
 * wrapper everywhere. The plugin tags both the call site (`<View/>`) and the
 * wrapper's own `<ViewRn/>`; the call-site location reaches the host view
 * through `{...props}`. Because JSX props are last-wins, the spliced
 * `data-pa-loc` MUST be emitted before the spread so the forwarded location
 * overrides the wrapper's own line. Emit it after the spread and every element
 * collapses to the wrapper's `file:line` and the tapped child is unreachable.
 */
import { describe, expect, it } from 'vitest';
import pinagentSource from '../src/babel';

type N = { type?: string; [key: string]: unknown };

/**
 * Stand-in for the slice of `@babel/types` the plugin touches: type-guards
 * (string `type` checks) plus the three node factories used to build the
 * spliced attributes.
 */
const t = {
  isJSXIdentifier: (n: N | null | undefined) => n?.type === 'JSXIdentifier',
  isJSXMemberExpression: (n: N | null | undefined) => n?.type === 'JSXMemberExpression',
  isJSXNamespacedName: (n: N | null | undefined) => n?.type === 'JSXNamespacedName',
  isJSXAttribute: (n: N | null | undefined) => n?.type === 'JSXAttribute',
  isFunctionDeclaration: (n: N | null | undefined) => n?.type === 'FunctionDeclaration',
  isClassMethod: (n: N | null | undefined) => n?.type === 'ClassMethod',
  isClassPrivateMethod: (n: N | null | undefined) => n?.type === 'ClassPrivateMethod',
  isClassDeclaration: (n: N | null | undefined) => n?.type === 'ClassDeclaration',
  isClassExpression: (n: N | null | undefined) => n?.type === 'ClassExpression',
  isVariableDeclarator: (n: N | null | undefined) => n?.type === 'VariableDeclarator',
  isIdentifier: (n: N | null | undefined) => n?.type === 'Identifier',
  isObjectProperty: (n: N | null | undefined) => n?.type === 'ObjectProperty',
  isObjectMethod: (n: N | null | undefined) => n?.type === 'ObjectMethod',
  isClassProperty: (n: N | null | undefined) => n?.type === 'ClassProperty',
  isAssignmentExpression: (n: N | null | undefined) => n?.type === 'AssignmentExpression',
  jsxIdentifier: (name: string) => ({ type: 'JSXIdentifier', name }),
  stringLiteral: (value: string) => ({ type: 'StringLiteral', value }),
  jsxAttribute: (name: N, value: N) => ({ type: 'JSXAttribute', name, value }),
};

const visit = pinagentSource({ types: t }).visitor.JSXOpeningElement;

const spread = (name = 'rest'): N => ({ type: 'JSXSpreadAttribute', argument: { name } });
const jsxName = (name: string): N => ({ type: 'JSXIdentifier', name });

/** A JSXOpeningElement node with the given element name + initial attributes. */
function opening(name: string, attributes: N[] = [], line = 1, column = 0): N {
  return { name: jsxName(name), attributes, loc: { start: { line, column } } };
}

/** A FunctionDeclaration parent path so `enclosingComponentName` resolves. */
function compParent(name: string) {
  return {
    node: { type: 'FunctionDeclaration', id: { name } },
    getFunctionParent: () => null,
  };
}

/** Run the visitor over a node; returns the (mutated) attributes array. */
function run(
  node: N,
  state: Partial<{ filename: string; cwd: string }>,
  parent: unknown = null,
): N[] {
  const path = { node, getFunctionParent: () => parent };
  visit(path, { cwd: '/proj', ...state });
  return node.attributes as N[];
}

const PROJ = { filename: '/proj/src/Foo.tsx', cwd: '/proj' };
const idxOfLoc = (attrs: N[]) =>
  attrs.findIndex((a) => a.type === 'JSXAttribute' && (a.name as N).name === 'data-pa-loc');
const idxOfComp = (attrs: N[]) =>
  attrs.findIndex((a) => a.type === 'JSXAttribute' && (a.name as N).name === 'data-pa-comp');
const idxOfSpread = (attrs: N[]) => attrs.findIndex((a) => a.type === 'JSXSpreadAttribute');
const locValue = (attrs: N[]) => {
  const attr = attrs[idxOfLoc(attrs)];
  return ((attr?.value as N)?.value as string) ?? null;
};

describe('pinagent-source babel plugin', () => {
  it('tags an authored element with data-pa-loc (project-relative file:line:col)', () => {
    const attrs = run(opening('View', [], 1, 0), PROJ);
    expect(locValue(attrs)).toBe('src/Foo.tsx:1:1');
  });

  it('emits a 1-indexed column (babel columns are 0-indexed)', () => {
    const attrs = run(opening('View', [], 3, 6), PROJ);
    expect(locValue(attrs)).toBe('src/Foo.tsx:3:7');
  });

  describe('generic wrapper precedence (the core fix)', () => {
    it('prepends data-pa-loc BEFORE a spread so a forwarded call-site loc wins', () => {
      const attrs = run(opening('ViewRn', [spread('props')]), PROJ);
      const loc = idxOfLoc(attrs);
      const sp = idxOfSpread(attrs);
      expect(loc).toBeGreaterThanOrEqual(0);
      expect(sp).toBeGreaterThanOrEqual(0);
      // Prepend, not append: the literal must precede the spread so a
      // `data-pa-loc` arriving through `{...props}` overrides it at runtime.
      expect(loc).toBeLessThan(sp);
      expect(loc).toBe(0);
    });

    it('keeps the spliced loc before the spread amid other attributes', () => {
      const style: N = { type: 'JSXAttribute', name: jsxName('style') };
      const attrs = run(opening('ViewRn', [style, spread('rest')]), PROJ);
      expect(idxOfLoc(attrs)).toBeLessThan(idxOfSpread(attrs));
    });

    it('prepends data-pa-comp before the spread too', () => {
      const attrs = run(opening('ViewRn', [spread('props')]), PROJ, compParent('Dashboard'));
      const comp = attrs[idxOfComp(attrs)];
      expect((comp?.value as N)?.value).toBe('Dashboard');
      expect(idxOfComp(attrs)).toBeLessThan(idxOfSpread(attrs));
    });
  });

  it('is idempotent — skips an element already carrying data-pa-loc', () => {
    const tagged: N = {
      type: 'JSXAttribute',
      name: jsxName('data-pa-loc'),
      value: { type: 'StringLiteral', value: 'src/Other.tsx:9:9' },
    };
    const attrs = run(opening('View', [tagged]), PROJ);
    expect(
      attrs.filter((a) => a.type === 'JSXAttribute' && (a.name as N).name === 'data-pa-loc'),
    ).toHaveLength(1);
    expect(locValue(attrs)).toBe('src/Other.tsx:9:9');
  });

  it('skips fragments', () => {
    const attrs = run(opening('Fragment', []), PROJ);
    expect(idxOfLoc(attrs)).toBe(-1);
  });

  it('does not tag files inside node_modules', () => {
    const attrs = run(opening('View', []), {
      filename: '/proj/node_modules/pkg/Foo.js',
      cwd: '/proj',
    });
    expect(idxOfLoc(attrs)).toBe(-1);
  });

  it('skips files resolved outside the project root', () => {
    const attrs = run(opening('View', []), { filename: '/elsewhere/Foo.tsx', cwd: '/proj' });
    expect(idxOfLoc(attrs)).toBe(-1);
  });
});
