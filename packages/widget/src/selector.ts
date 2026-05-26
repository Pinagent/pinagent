// SPDX-License-Identifier: Apache-2.0
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
