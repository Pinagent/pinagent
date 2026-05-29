// SPDX-License-Identifier: Apache-2.0
/**
 * Tap point → source location, the React Native way.
 *
 * This is the RN analog of the web widget's DOM walk for `data-pa-loc`.
 * RN's own dev Inspector (Dev Menu → "Show Inspector") resolves a touch
 * to a component + source file using exactly this internal API; we lean
 * on the same machinery rather than reinventing it.
 *
 * Source data comes from each fiber's `_debugSource`
 * (`{ fileName, lineNumber, columnNumber }`), populated by the
 * `@babel/plugin-transform-react-jsx-source` transform Metro runs in dev.
 * So `data-pa-loc` (web, build-time) ↔ `_debugSource` (RN, dev-only).
 *
 * The shape returned by `getInspectorDataForViewAtPoint` has shifted
 * across RN versions, so every read here is defensive: we extract what we
 * can and degrade to `loc: null` rather than throw inside a tap handler.
 */
import type { PickResult } from './types';

// Internal RN module — not a public export, but the path has been stable
// and is what the built-in Inspector imports. Typed loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-var-requires
type InspectorFn = (
  inspectedView: number | null,
  locationX: number,
  locationY: number,
  callback: (data: RawInspectorData) => void,
) => void;

interface RawFiberLike {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
}

interface RawHierarchyItem {
  name?: string;
  getInspectorData?: (toFiber: unknown) => {
    source?: RawFiberLike | null;
  };
}

interface RawInspectorData {
  frame?: { left: number; top: number; width: number; height: number } | null;
  hierarchy?: RawHierarchyItem[];
  /** Newer RN returns the closest fiber directly. */
  closestInstance?: { _debugSource?: RawFiberLike } | null;
  /** Some versions surface the resolved source straight on the payload. */
  source?: RawFiberLike | null;
}

let cachedFn: InspectorFn | null | undefined;

function loadInspector(): InspectorFn | null {
  if (cachedFn !== undefined) return cachedFn;
  try {
    // Lazy require so a production build (where this whole widget is
    // tree-shaken / `__DEV__`-gated away) never reaches into RN internals.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const mod = require('react-native/Libraries/Inspector/getInspectorDataForViewAtPoint');
    cachedFn = (mod?.default ?? mod) as InspectorFn;
  } catch {
    cachedFn = null;
  }
  return cachedFn;
}

/**
 * Turn an absolute `_debugSource.fileName` into the project-relative,
 * POSIX path the rest of pinagent expects (matching what the web babel
 * plugin emits). Falls back to the raw filename if it isn't under root.
 */
function toProjectRelative(fileName: string, projectRoot: string): string {
  const norm = fileName.replace(/\\/g, '/');
  const root = projectRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  if (root && norm.startsWith(`${root}/`)) return norm.slice(root.length + 1);
  return norm;
}

function pickSource(data: RawInspectorData): RawFiberLike | null {
  if (data.source?.fileName) return data.source;
  if (data.closestInstance?._debugSource?.fileName) {
    return data.closestInstance._debugSource;
  }
  // Walk the hierarchy from the tapped element outward and take the first
  // frame that carries a source — i.e. the nearest authored component.
  for (let i = (data.hierarchy?.length ?? 0) - 1; i >= 0; i--) {
    const item = data.hierarchy?.[i];
    const src = item?.getInspectorData?.(() => null)?.source;
    if (src?.fileName) return src;
  }
  return null;
}

function nameChainOf(data: RawInspectorData): string[] {
  return (data.hierarchy ?? [])
    .map((h) => h.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
}

/**
 * Resolve a tap (in window coordinates) to a {@link PickResult}.
 *
 * @param rootTag  The native tag of the inspected root view. In an app
 *   you get this from a ref on your top-level container
 *   (`findNodeHandle(ref.current)`); the POC widget owns that ref.
 */
export function resolvePick(
  rootTag: number | null,
  x: number,
  y: number,
  projectRoot: string,
): Promise<PickResult> {
  const fn = loadInspector();
  if (!fn) {
    // Inspector unavailable (release build, or an RN version that moved
    // the module). Degrade gracefully — the comment can still be filed
    // with `loc: null`, which the server accepts.
    return Promise.resolve({ loc: null, nameChain: [], frame: null });
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: PickResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    // The callback is sometimes never invoked if the point misses every
    // view; guard with a microtask-ish fallback so the picker can't hang.
    const timer = setTimeout(() => done({ loc: null, nameChain: [], frame: null }), 250);
    try {
      fn(rootTag, x, y, (data) => {
        clearTimeout(timer);
        const src = pickSource(data);
        const frame = data.frame
          ? {
              x: data.frame.left,
              y: data.frame.top,
              width: data.frame.width,
              height: data.frame.height,
            }
          : null;
        done({
          loc:
            src?.fileName && typeof src.lineNumber === 'number'
              ? {
                  file: toProjectRelative(src.fileName, projectRoot),
                  line: src.lineNumber,
                  col: src.columnNumber ?? 0,
                }
              : null,
          nameChain: nameChainOf(data),
          frame,
        });
      });
    } catch {
      clearTimeout(timer);
      done({ loc: null, nameChain: [], frame: null });
    }
  });
}
