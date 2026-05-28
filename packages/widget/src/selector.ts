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

export function findLoc(start: Element): PaLoc | null {
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
          return { file, line, col };
        }
      }
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Phase G — re-anchor lookup. Given the metadata captured at pick time,
 * try to find a live DOM element. `data-pa-loc` is preferred because it
 * pins to the exact JSX source location (immune to layout shuffles);
 * the CSS selector is the fallback for elements that lost their attribute
 * (e.g. compiled-away in production, dynamically inserted, or living in
 * a third-party component the Babel plugin never visited).
 *
 * Returns the first match for `data-pa-loc` (which may be ambiguous if the
 * same JSX literal is rendered multiple times via `.map()`), then the
 * first match for `selector`. Returns `null` when neither resolves.
 */
export function findReanchorTarget(
  dataPaLoc: string | null,
  selector: string | null,
): Element | null {
  if (dataPaLoc) {
    // Iterate rather than escape the value into a CSS attribute selector —
    // some host paths contain characters (quotes, backslashes, brackets)
    // that need careful CSS escaping and a `\` rule that happy-dom doesn't
    // accept the same way real browsers do. Iterating sidesteps that.
    const candidates = document.querySelectorAll('[data-pa-loc]');
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (el?.getAttribute('data-pa-loc') === dataPaLoc) return el;
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
