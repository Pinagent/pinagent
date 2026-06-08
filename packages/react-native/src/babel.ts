// SPDX-License-Identifier: Apache-2.0
/**
 * Metro/Babel source-tagging plugin — the React Native analog of the web
 * `@pinagent/babel-plugin`.
 *
 * It splices a `data-pa-loc="<file>:<line>:<col>"` prop (plus a
 * `data-pa-comp="<EnclosingComponent>"` companion) onto every authored JSX
 * element, exactly mirroring what the web babel plugin emits as a DOM
 * attribute. On React Native that prop survives onto the host fiber's
 * `memoizedProps`, so {@link resolvePick} can read it back at tap time.
 *
 * ## Why this exists (and didn't used to)
 *
 * The original RN design leaned on each fiber's `_debugSource`, populated in
 * dev by `@babel/plugin-transform-react-jsx-source` — "reuse RN's, no custom
 * plugin needed". **React 19 removed `_debugSource`** (the `ReactElement`
 * constructor no longer takes a `source` arg; the `__source` prop is consumed
 * by `jsxDEV` and never reaches `memoizedProps`), and **RN 0.81+ dropped the
 * `source` field from `getInspectorDataForViewAtPoint`**. So the runtime no
 * longer carries any source location — we have to inject our own, at build
 * time, the same way web does.
 *
 * Wire it into `babel.config.js` (dev only) BEFORE `babel-preset-expo`'s JSX
 * transform so the attribute is present when JSX lowers to `jsxDEV`:
 *
 *   const pinagentSource = require('@pinagent/react-native/babel').default;
 *   module.exports = (api) => {
 *     api.cache(true);
 *     const dev = process.env.NODE_ENV !== 'production';
 *     return {
 *       presets: ['babel-preset-expo'],
 *       plugins: dev ? [pinagentSource] : [],
 *     };
 *   };
 *
 * Typed loosely (no `@babel/*` type deps) on purpose — like {@link inspector},
 * this is a thin, version-tolerant shim over an external toolchain that this
 * otherwise web-only monorepo doesn't carry types for.
 */
import { isAbsolute, relative, sep } from 'node:path';

/** The attribute the web plugin emits — reused verbatim so reads match. */
const ATTR = 'data-pa-loc';
/** Companion attribute carrying the enclosing component name. */
const COMP_ATTR = 'data-pa-comp';

// Minimal structural typing for the slice of Babel we touch. Babel hands the
// plugin a `types` namespace and node paths; we lean on duck-typing rather
// than pulling in @types/babel__core.
// biome-ignore lint/suspicious/noExplicitAny: external babel AST, typed loosely
type Any = any;

interface PluginState {
  filename?: string;
  cwd?: string;
  opts?: { projectRoot?: string };
  file?: { opts?: { filename?: string; cwd?: string; root?: string } };
}

function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

/**
 * Walk up to the nearest enclosing React component — the closest
 * function/class ancestor with a PascalCase name. Lowercase callbacks
 * (`items.map(x => <Row/>)`) are skipped, so list items report the component
 * that owns the list. Mirrors `@pinagent/babel-plugin`'s `transform.ts`.
 */
function enclosingComponentName(path: Any, t: Any): string | null {
  let fn = path.getFunctionParent?.();
  while (fn) {
    const name = inferFunctionName(fn, t);
    if (name && /^[A-Z]/.test(name)) return name;
    fn = fn.getFunctionParent?.();
  }
  return null;
}

function inferFunctionName(fnPath: Any, t: Any): string | null {
  const node = fnPath.node;
  if (t.isFunctionDeclaration(node) && node.id) return node.id.name;
  if (t.isClassMethod(node) || t.isClassPrivateMethod(node)) {
    const cls = fnPath.findParent((p: Any) => p.isClassDeclaration() || p.isClassExpression());
    if (cls) {
      const clsNode = cls.node;
      if ((t.isClassDeclaration(clsNode) || t.isClassExpression(clsNode)) && clsNode.id) {
        return clsNode.id.name;
      }
      return nameFromBinding(cls, t);
    }
    return null;
  }
  return nameFromBinding(fnPath, t);
}

function nameFromBinding(p: Any, t: Any): string | null {
  const pn = p.parentPath?.node;
  if (!pn) return null;
  if (t.isVariableDeclarator(pn) && t.isIdentifier(pn.id)) return pn.id.name;
  if ((t.isObjectProperty(pn) || t.isObjectMethod(pn)) && t.isIdentifier(pn.key))
    return pn.key.name;
  if ((t.isClassProperty(pn) || t.isClassMethod(pn)) && t.isIdentifier(pn.key)) return pn.key.name;
  if (t.isAssignmentExpression(pn) && t.isIdentifier(pn.left)) return pn.left.name;
  return null;
}

function isFragment(name: Any, t: Any): boolean {
  if (t.isJSXIdentifier(name)) return name.name === 'Fragment';
  if (t.isJSXMemberExpression(name)) {
    return t.isJSXIdentifier(name.property) && name.property.name === 'Fragment';
  }
  return t.isJSXNamespacedName(name);
}

/** Resolve the project root used to make paths relative. */
function rootFor(state: PluginState): string | undefined {
  return state.opts?.projectRoot ?? state.file?.opts?.root ?? state.cwd ?? state.file?.opts?.cwd;
}

/** Resolve the file being transformed. */
function filenameFor(state: PluginState): string | undefined {
  return state.filename ?? state.file?.opts?.filename;
}

export interface PinagentBabelOptions {
  /** Project root for project-relative paths. Defaults to Babel's cwd/root. */
  projectRoot?: string;
}

/**
 * The Babel plugin. Default export so a `babel.config.js` can `require()` it
 * and drop the function straight into `plugins`.
 */
export default function pinagentSource(babel: { types: Any }): Any {
  const t = babel.types;
  return {
    name: 'pinagent-source',
    visitor: {
      JSXOpeningElement(path: Any, state: PluginState) {
        const node = path.node;
        if (isFragment(node.name, t)) return;

        // Already tagged? Idempotent — re-running is a no-op.
        const tagged = node.attributes.some(
          (a: Any) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === ATTR,
        );
        if (tagged) return;

        const loc = node.loc?.start;
        if (!loc) return;

        const filename = filenameFor(state);
        if (!filename || filename.includes(`${sep}node_modules${sep}`)) return;

        const root = rootFor(state);
        let rel = root && isAbsolute(filename) ? relative(root, filename) : filename;
        rel = toPosix(rel);
        // Only tag files inside the project root — skip anything resolved
        // outside it (e.g. the in-tree widget source under an out-of-root
        // package, which the developer never taps on).
        if (rel.startsWith('../')) return;

        const value = `${rel}:${loc.line}:${loc.column + 1}`;
        const attrs = [t.jsxAttribute(t.jsxIdentifier(ATTR), t.stringLiteral(value))];
        const comp = enclosingComponentName(path, t);
        if (comp) {
          attrs.push(t.jsxAttribute(t.jsxIdentifier(COMP_ATTR), t.stringLiteral(comp)));
        }
        node.attributes.push(...attrs);
      },
    },
  };
}
