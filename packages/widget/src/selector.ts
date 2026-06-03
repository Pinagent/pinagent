// SPDX-License-Identifier: Apache-2.0

/**
 * Tag-only chain from a bounded ancestor down to `el`, used by the
 * composer header to render a breadcrumb (`<div> > <section> > <button>`)
 * where the last entry is the picked element. Stops at `html`/`body`
 * if it reaches them inside `maxDepth`. Lowercased so the breadcrumb
 * reads as HTML-style identifiers.
 */
export function breadcrumbTags(el: Element, maxDepth = 4): string[] {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth < maxDepth) {
    const tag = cur.tagName.toLowerCase();
    parts.unshift(tag);
    if (tag === 'html' || tag === 'body') break;
    cur = cur.parentElement;
    depth++;
  }
  return parts;
}

/**
 * Short human label for the picked element. Tries the labelling
 * sources users actually reach for in this order: `aria-label`, then
 * visible text (textContent collapsed), then `title`, then `alt` (on
 * <img>). Returns null when no label applies — the header omits the
 * "quoted label" row in that case. Truncates to `max` so a paragraph
 * doesn't blow up the header height.
 */
export function describeElementLabel(el: Element, max = 40): string | null {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return truncate(aria.trim(), max);
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.length > 0) return truncate(text, max);
  const title = el.getAttribute('title');
  if (title?.trim()) return truncate(title.trim(), max);
  if (el.tagName.toLowerCase() === 'img') {
    const alt = el.getAttribute('alt');
    if (alt?.trim()) return truncate(alt.trim(), max);
  }
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function shortSelector(el: Element, maxDepth = 4): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth < maxDepth) {
    const tag = cur.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') {
      parts.unshift(tag);
      break;
    }
    let part = tag;
    if (cur.id) {
      part += `#${CSS.escape(cur.id)}`;
      parts.unshift(part);
      break;
    }
    const parent: Element | null = cur.parentElement;
    if (parent) {
      const tagName = cur.tagName;
      const siblings: Element[] = Array.from(parent.children).filter((c) => c.tagName === tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    cur = parent;
    depth++;
  }
  return parts.join(' > ');
}

export interface PaLoc {
  file: string;
  line: number;
  col: number;
}

/**
 * Like `findLoc`, but also returns the element the `data-pa-loc` was
 * found on plus the raw attribute string. Call sites that need to reason
 * about the *resolved* element (instance counting, fingerprinting) want
 * this; `findLoc` stays as the thin value-only wrapper most callers use.
 */
export interface LocHit {
  el: Element;
  raw: string;
  loc: PaLoc;
}

export function findLocEl(start: Element): LocHit | null {
  let cur: Element | null = start;
  while (cur && cur.nodeType === 1) {
    const raw = cur.getAttribute?.('data-pa-loc');
    if (raw) {
      const parts = raw.split(':');
      if (parts.length >= 3) {
        const col = Number(parts[parts.length - 1]);
        const line = Number(parts[parts.length - 2]);
        const file = parts.slice(0, parts.length - 2).join(':');
        if (Number.isFinite(line) && Number.isFinite(col) && file) {
          return { el: cur, raw, loc: { file, line, col } };
        }
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

export function findLoc(start: Element): PaLoc | null {
  return findLocEl(start)?.loc ?? null;
}

/**
 * Every element from `start` (inclusive) up to the document root that carries
 * a *valid* `data-pa-loc`, ordered innermost→outermost. The picker uses this
 * to let the user walk the highlight up the source-tagged ancestry with ↑/↓
 * when a descendant visually covers the parent the developer actually wants to
 * comment on (e.g. an `<a>` filling its `<nav>`/`<aside>`/`<div>` wrappers).
 * Elements whose attribute is missing or unparseable are skipped, so every
 * entry resolves to a real `file:line`.
 */
export function locAncestors(start: Element): Element[] {
  const out: Element[] = [];
  let cur: Element | null = start;
  while (cur && cur.nodeType === 1) {
    // findLocEl returns the nearest tagged ancestor; it equals `cur` only when
    // `cur` itself carries a valid data-pa-loc — exactly the levels we want.
    if (findLocEl(cur)?.el === cur) out.push(cur);
    cur = cur.parentElement;
  }
  return out;
}

/**
 * Nearest enclosing component name, read from the `data-pa-comp`
 * attribute the Babel plugin stamps alongside `data-pa-loc`. Walks up
 * the same way `findLoc` does so the result lines up with the resolved
 * source location. Null in uninstrumented apps or on elements outside
 * any PascalCase component.
 */
export function componentOf(start: Element): string | null {
  let cur: Element | null = start;
  while (cur && cur.nodeType === 1) {
    const comp = cur.getAttribute?.('data-pa-comp');
    if (comp?.trim()) return comp.trim();
    cur = cur.parentElement;
  }
  return null;
}

/**
 * The chain of distinct enclosing components from the outermost down to
 * (and including) the one wrapping `start`, e.g. `["App", "PriceList",
 * "PriceCard"]`. A single component spans many nested host nodes that
 * all carry the same `data-pa-comp`, so consecutive duplicates are
 * collapsed — the array tracks *component boundaries*, not DOM depth.
 * Capped at `max` entries (keeping the innermost) so a deep tree can't
 * bloat the payload. Empty when nothing is instrumented.
 */
export function componentPath(start: Element, max = 8): string[] {
  const inner: string[] = [];
  let cur: Element | null = start;
  let last: string | null = null;
  while (cur && cur.nodeType === 1) {
    const comp = cur.getAttribute?.('data-pa-comp')?.trim();
    if (comp && comp !== last) {
      inner.push(comp);
      last = comp;
    }
    cur = cur.parentElement;
  }
  // `inner` is innermost→outermost; reverse to outer→inner for reading.
  inner.reverse();
  return inner.length > max ? inner.slice(inner.length - max) : inner;
}

/**
 * Position of `el` among every live element that shares its exact
 * `data-pa-loc` value, in document order. `total > 1` means the same JSX
 * literal is rendered more than once (the `.map()` case) and the bare
 * `file:line` is ambiguous; `index` says which one the user clicked.
 * `index` is 0-based; -1 if `el` isn't itself tagged.
 */
export function locInstanceInfo(el: Element, raw: string): { index: number; total: number } {
  const all = document.querySelectorAll('[data-pa-loc]');
  let total = 0;
  let index = -1;
  for (let i = 0; i < all.length; i++) {
    const node = all[i];
    if (node?.getAttribute('data-pa-loc') === raw) {
      if (node === el) index = total;
      total++;
    }
  }
  return { index, total };
}

/**
 * A compact, human-readable fingerprint of an element's distinguishing
 * content — used to tell the agent *which* `.map()` item was clicked
 * when the `file:line` is shared across instances. Combines the tag, a
 * trimmed text snippet, and the identity-ish attributes that usually
 * differ row-to-row (id, test ids, links, images, labels).
 */
export function elementFingerprint(el: Element, maxText = 60): string {
  const parts: string[] = [el.tagName.toLowerCase()];
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text) parts.push(`"${truncate(text, maxText)}"`);
  for (const attr of ['id', 'data-testid', 'name', 'href', 'src', 'alt', 'title', 'aria-label']) {
    const v = el.getAttribute(attr)?.trim();
    if (v) parts.push(`${attr}=${truncate(v, 40)}`);
  }
  return parts.join(' ');
}

/**
 * Phase G — re-anchor lookup. Given the metadata captured at pick time,
 * try to find a live DOM element. `data-pa-loc` is preferred because it
 * pins to the exact JSX source location (immune to layout shuffles);
 * the CSS selector is the fallback for elements that lost their attribute
 * (e.g. compiled-away in production, dynamically inserted, or living in
 * a third-party component the Babel plugin never visited).
 *
 * When the same JSX literal renders multiple times via `.map()`, several
 * live nodes share one `data-pa-loc`. `instance` (captured at pick time)
 * disambiguates: prefer the node whose fingerprint still matches (survives
 * row reordering), else the captured positional index, else the first match.
 * Without it we fall back to the first match. The CSS `selector` is the last
 * resort for elements that lost their attribute. Returns `null` when nothing
 * resolves.
 */
export function findReanchorTarget(
  dataPaLoc: string | null,
  selector: string | null,
  instance?: { index: number; fingerprint: string } | null,
): Element | null {
  if (dataPaLoc) {
    // Iterate rather than escape the value into a CSS attribute selector —
    // some host paths contain characters (quotes, backslashes, brackets)
    // that need careful CSS escaping and a `\` rule that happy-dom doesn't
    // accept the same way real browsers do. Iterating sidesteps that.
    const matches: Element[] = [];
    const candidates = document.querySelectorAll('[data-pa-loc]');
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el?.getAttribute('data-pa-loc') === dataPaLoc) matches.push(el);
    }
    if (matches.length > 0) {
      // Single match, or no instance info to disambiguate with → take it.
      if (matches.length === 1 || !instance) return matches[0] ?? null;
      // The picked `.map()` row, identified first by fingerprint (robust to
      // reordering), then by its captured position, then first as a backstop.
      const byFingerprint = matches.find((el) => elementFingerprint(el) === instance.fingerprint);
      if (byFingerprint) return byFingerprint;
      return matches[instance.index] ?? matches[0] ?? null;
    }
  }
  if (selector) {
    try {
      const found = document.querySelector(selector);
      if (found) return found;
    } catch {
      // Selector no longer parses after the page changed shape — e.g.
      // a `:nth-of-type` chain whose siblings disappeared.
    }
  }
  return null;
}
