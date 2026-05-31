// SPDX-License-Identifier: Apache-2.0
import { findReanchorTarget } from './selector';

/** A user-drawn region in document coords (CSS pixels including scroll). */
export type RegionRect = { x: number; y: number; w: number; h: number };

/** Internal edge-form rect (document coords) for union math. */
type Edges = { left: number; top: number; right: number; bottom: number };

/**
 * Compute the crop bbox (document coords, CSS pixels including scroll)
 * the screenshot is narrowed to, or null to keep today's full-page
 * capture. ~16px padding around the union gives the agent a little
 * context. Three cases:
 *
 *  - No regions, no extras → null (single-pick conversations are
 *    unchanged: full-page screenshot).
 *  - No regions, with extras → union of the primary target + extras
 *    (the multi-element bbox).
 *  - With regions → union of the drawn region(s) + any extra elements,
 *    *excluding* the primary. A drawn region defines "just that" snippet;
 *    the primary in region mode is only a positioning anchor (the element
 *    under the region's centre), so folding in its full bounds would
 *    balloon the crop past what the user drew.
 */
export function computeUnionCropRect(
  primary: Element,
  extras: ReadonlyArray<{
    selector: string;
    file: string | null;
    line: number | null;
    col: number | null;
  }>,
  regions: ReadonlyArray<RegionRect> = [],
): RegionRect | null {
  if (regions.length === 0 && extras.length === 0) return null;

  const edges: Edges[] = [];

  // Drawn regions are already in document coords.
  for (const rg of regions) {
    edges.push({ left: rg.x, top: rg.y, right: rg.x + rg.w, bottom: rg.y + rg.h });
  }

  // Extra elements: resolve live, convert viewport rect → document coords.
  for (const a of extras) {
    const t = findReanchorTarget(
      a.file && a.line != null && a.col != null ? `${a.file}:${a.line}:${a.col}` : null,
      a.selector,
    );
    if (t) edges.push(toDocEdges(t.getBoundingClientRect()));
  }

  // The primary's own bounds only join the union for element-only picks
  // (no region drawn) — see the doc comment above.
  if (regions.length === 0 && primary.isConnected) {
    edges.push(toDocEdges(primary.getBoundingClientRect()));
  }
  if (edges.length === 0) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of edges) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  const pad = 16;
  const docLeft = left - pad;
  const docTop = top - pad;
  const docRight = right + pad;
  const docBottom = bottom + pad;
  return {
    x: Math.max(0, Math.floor(docLeft)),
    y: Math.max(0, Math.floor(docTop)),
    w: Math.ceil(docRight - docLeft),
    h: Math.ceil(docBottom - docTop),
  };
}

function toDocEdges(r: DOMRect): Edges {
  return {
    left: r.left + window.scrollX,
    top: r.top + window.scrollY,
    right: r.right + window.scrollX,
    bottom: r.bottom + window.scrollY,
  };
}
