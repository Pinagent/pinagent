// SPDX-License-Identifier: Apache-2.0
import { parse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';

// @babel/traverse default-export interop with ESM.
const traverse = (
  typeof (_traverse as unknown as { default?: unknown }).default === 'function'
    ? (_traverse as unknown as { default: typeof _traverse }).default
    : _traverse
) as typeof _traverse;

const ATTR = 'data-pa-loc';
/**
 * Companion attribute carrying the *enclosing component* name — the
 * nearest PascalCase function/class that renders this JSX. Lets the
 * widget tell the agent "you clicked inside `<PriceCard>`" instead of a
 * bare `file:line`, and (because `.map()` callbacks are skipped) gives
 * every instance in a list the same component name, which is what makes
 * loop-instance disambiguation downstream resolve to the right item.
 */
const COMP_ATTR = 'data-pa-comp';

export interface TransformOptions {
  /** Relative path (POSIX) to embed into the attribute. */
  relPath: string;
  /** TypeScript syntax? (.tsx, .ts) */
  ts: boolean;
}

export function transformJsx(code: string, opts: TransformOptions): string | null {
  // Quick filter: must contain JSX.
  if (!/<[A-Za-z]/.test(code)) return null;

  const plugins: Array<string | [string, unknown]> = [
    'jsx',
    'decorators-legacy',
    'classProperties',
  ];
  if (opts.ts) plugins.unshift('typescript');

  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(code, {
      sourceType: 'module',
      // biome-ignore lint/suspicious/noExplicitAny: babel plugin tuple typing
      plugins: plugins as any,
      tokens: false,
      errorRecovery: true,
    });
  } catch {
    return null;
  }

  // Collect splice points in a single pass. We splice attribute strings
  // straight into the original source (rather than running a codegen
  // pass) so source maps stay intact — pushing nodes onto the AST would
  // require a full reprint. Original `loc`/`end` offsets are unaffected
  // by anything we do here, so one traversal is enough.
  const points: SplicePoint[] = [];

  traverse(ast, {
    JSXOpeningElement(path) {
      const node = path.node;

      // Skip fragments — they don't accept arbitrary props and React
      // logs a console warning if you give them any. `<>...</>` uses a
      // separate JSXFragment node and never enters this visitor, but
      // `<Fragment>`, `<React.Fragment>`, and similarly-named imports
      // do. Match by property name to cover all three forms.
      const name = node.name;
      if (t.isJSXIdentifier(name)) {
        if (name.name === 'Fragment') return;
      } else if (t.isJSXMemberExpression(name)) {
        const prop = name.property;
        if (t.isJSXIdentifier(prop) && prop.name === 'Fragment') return;
      } else if (t.isJSXNamespacedName(name)) {
        // Skip namespaced (uncommon).
        return;
      }

      // Already tagged? (idempotent — re-running on tagged output is a no-op)
      const has = node.attributes.some(
        (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === ATTR,
      );
      if (has) return;

      const loc = node.loc?.start;
      if (!loc) return;
      const nameEnd = name.end;
      if (typeof nameEnd !== 'number') return;

      const value = `${opts.relPath}:${loc.line}:${loc.column + 1}`;
      let insertion = ` ${ATTR}="${escapeAttr(value)}"`;
      const comp = enclosingComponentName(path);
      if (comp) insertion += ` ${COMP_ATTR}="${escapeAttr(comp)}"`;
      // Insert immediately after the element name.
      points.push({ pos: nameEnd, insertion });
    },
  });

  if (points.length === 0) return null;

  // Splice from the end so earlier insertions don't shift later offsets.
  points.sort((a, b) => b.pos - a.pos);
  let out = code;
  for (const p of points) {
    out = out.slice(0, p.pos) + p.insertion + out.slice(p.pos);
  }
  return out;
}

interface SplicePoint {
  pos: number;
  insertion: string;
}

/**
 * Walk up from a JSX node to the nearest enclosing React component —
 * the closest function/class ancestor whose inferred name is PascalCase.
 * Lowercase callbacks (`items.map(item => <li/>)`) and plain helpers are
 * skipped, so JSX rendered inside a `.map()` still reports the component
 * that owns the list (`PriceCard`), not the anonymous arrow. Returns null
 * when no PascalCase owner can be determined (e.g. JSX in a top-level
 * helper that returns markup).
 */
function enclosingComponentName(path: NodePath): string | null {
  let fn: NodePath | null = path.getFunctionParent();
  while (fn) {
    const name = inferFunctionName(fn);
    if (name && /^[A-Z]/.test(name)) return name;
    fn = fn.getFunctionParent();
  }
  return null;
}

function inferFunctionName(fnPath: NodePath): string | null {
  const node = fnPath.node;

  // `function PriceCard() {}`
  if (t.isFunctionDeclaration(node) && node.id) return node.id.name;

  // Class component: `render()` (or any method) lives inside the class.
  if (t.isClassMethod(node) || t.isClassPrivateMethod(node)) {
    const cls = fnPath.findParent((p) => p.isClassDeclaration() || p.isClassExpression());
    if (cls) {
      const clsNode = cls.node;
      if ((t.isClassDeclaration(clsNode) || t.isClassExpression(clsNode)) && clsNode.id) {
        return clsNode.id.name;
      }
      const bound = nameFromBinding(cls);
      if (bound) return bound;
    }
    return null;
  }

  // Arrow / function expression: `const PriceCard = () => {}`, object
  // method shorthand, class property, or assignment.
  return nameFromBinding(fnPath);
}

function nameFromBinding(p: NodePath): string | null {
  const parent = p.parentPath;
  if (!parent) return null;
  const pn = parent.node;
  if (t.isVariableDeclarator(pn) && t.isIdentifier(pn.id)) return pn.id.name;
  if ((t.isObjectProperty(pn) || t.isObjectMethod(pn)) && t.isIdentifier(pn.key))
    return pn.key.name;
  if ((t.isClassProperty(pn) || t.isClassMethod(pn)) && t.isIdentifier(pn.key)) return pn.key.name;
  if (t.isAssignmentExpression(pn) && t.isIdentifier(pn.left)) return pn.left.name;
  return null;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
