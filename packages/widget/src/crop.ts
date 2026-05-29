// SPDX-License-Identifier: Apache-2.0
import { findReanchorTarget } from './selector';

/**
 * Compute the union bbox of the primary target plus any live extras,
 * in document coords (CSS pixels including scroll). Returns null when
 * there are no extras — single-pick conversations keep today's
 * full-page screenshot. ~16px padding around the union gives the
 * agent a little context.
 */
export function computeUnionCropRect(
  primary: Element,
  extras: ReadonlyArray<{
    selector: string;
    file: string | null;
    line: number | null;
    col: number | null;
  }>,
): { x: number; y: number; w: number; h: number } | null {
  if (extras.length === 0) return null;

  const rects: DOMRect[] = [];
  if (primary.isConnected) rects.push(primary.getBoundingClientRect());

  for (const a of extras) {
    const t = findReanchorTarget(
      a.file && a.line != null && a.col != null ? `${a.file}:${a.line}:${a.col}` : null,
      a.selector,
    );
    if (t) rects.push(t.getBoundingClientRect());
  }
  if (rects.length === 0) return null;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  const pad = 16;
  const docLeft = left + window.scrollX - pad;
  const docTop = top + window.scrollY - pad;
  const docRight = right + window.scrollX + pad;
  const docBottom = bottom + window.scrollY + pad;
  return {
    x: Math.max(0, Math.floor(docLeft)),
    y: Math.max(0, Math.floor(docTop)),
    w: Math.ceil(docRight - docLeft),
    h: Math.ceil(docBottom - docTop),
  };
}
