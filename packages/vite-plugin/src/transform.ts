import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';

// @babel/traverse default-export interop with ESM.
const traverse = (
  typeof (_traverse as unknown as { default?: unknown }).default === 'function'
    ? (_traverse as unknown as { default: typeof _traverse }).default
    : _traverse
) as typeof _traverse;

const ATTR = 'data-pa-loc';

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

  let mutated = false;

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

      // Already tagged?
      const has = node.attributes.some(
        (a) =>
          t.isJSXAttribute(a) &&
          t.isJSXIdentifier(a.name) &&
          a.name.name === ATTR,
      );
      if (has) return;

      const loc = node.loc?.start;
      if (!loc) return;

      const value = `${opts.relPath}:${loc.line}:${loc.column + 1}`;
      const attr = t.jsxAttribute(t.jsxIdentifier(ATTR), t.stringLiteral(value));
      node.attributes.push(attr);
      mutated = true;
    },
  });

  if (!mutated) return null;

  // Emit using a tiny printer so source maps stay intact: instead of full regen,
  // splice the attribute strings into the original source via location info.
  return spliceAttributes(code, ast, opts.relPath);
}

interface SplicePoint {
  pos: number;
  insertion: string;
}

function spliceAttributes(code: string, ast: ReturnType<typeof parse>, relPath: string): string {
  const points: SplicePoint[] = [];

  traverse(ast, {
    JSXOpeningElement(path) {
      const node = path.node;
      const loc = node.loc?.start;
      if (!loc) return;

      // We already added the attribute above, but here we need the *original*
      // source locations to splice into the original text without using a
      // codegen pass. So we find what we just added.
      const added = node.attributes.find(
        (a) =>
          t.isJSXAttribute(a) &&
          t.isJSXIdentifier(a.name) &&
          a.name.name === ATTR &&
          t.isStringLiteral(a.value) &&
          a.value.value === `${relPath}:${loc.line}:${loc.column + 1}`,
      );
      if (!added) return;

      // Insert immediately after the element name.
      const name = node.name;
      const nameEnd = name.end;
      if (typeof nameEnd !== 'number') return;
      const value = `${relPath}:${loc.line}:${loc.column + 1}`;
      points.push({ pos: nameEnd, insertion: ` ${ATTR}="${escapeAttr(value)}"` });
    },
  });

  if (points.length === 0) return code;

  points.sort((a, b) => b.pos - a.pos);

  let out = code;
  for (const p of points) {
    out = out.slice(0, p.pos) + p.insertion + out.slice(p.pos);
  }
  return out;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
