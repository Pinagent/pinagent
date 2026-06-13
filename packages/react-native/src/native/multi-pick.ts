// SPDX-License-Identifier: Apache-2.0
/**
 * Multi-select payload builder (ticket 008).
 *
 * On web, Cmd/Ctrl-click accumulates several elements into one comment and the
 * extras are submitted as `additionalAnchors` (landing in the
 * `widget_anchors.additional_anchors` JSON column). RN is touch-only, so the
 * composer offers an explicit "+ Add element" affordance: re-enter pick mode,
 * tap another element, and it appends a removable chip. This module turns the
 * primary anchor + the collected extras into the `additionalAnchors` array,
 * matching the web `AdditionalAnchorSchema` shape so the server accepts it
 * unchanged.
 *
 * Pure (no RN runtime imports) → unit-testable here. The RN UI state + capture
 * lives in Pinagent.tsx; this just shapes the wire payload.
 *
 * Web semantics preserved:
 * - A single pick (no extras) → `additionalAnchors` OMITTED (the server stores
 *   `additional_anchors` as null), not an empty array.
 * - The primary anchor is NOT duplicated into the extras.
 * - Each extra keeps the loc/selector it was tapped with (no breadcrumb
 *   re-anchoring for extras — that applies to the primary only, web parity).
 */
import type { AdditionalAnchor } from './types';

/** A primary or extra pick as captured by the RN composer. */
export interface ChipPick {
  /** Stable key for the chip + removal (e.g. a per-pick counter). */
  key: string;
  /** Resolved source location, or null for an unresolvable native view. */
  loc: { file: string; line: number; col: number } | null;
  /** Component name-chain ("App > Home > Button") — RN's selector stand-in. */
  selector: string;
  /** Tap point in window coordinates (the `clickX`/`clickY` the schema wants). */
  clickX: number;
  clickY: number;
  /** Innermost component name, for the chip label. */
  label: string;
}

/** Map one extra pick to the wire `AdditionalAnchor` shape. */
function toAnchor(pick: ChipPick): AdditionalAnchor {
  return {
    file: pick.loc?.file ?? null,
    line: pick.loc?.line ?? null,
    col: pick.loc?.col ?? null,
    selector: pick.selector,
    clickX: Math.round(pick.clickX),
    clickY: Math.round(pick.clickY),
  };
}

/**
 * Build the `additionalAnchors` field from the extra picks (everything after
 * the primary). Returns `undefined` when there are no extras so the caller can
 * spread it and leave the field off entirely for single-pick submits.
 *
 * @param extras the non-primary picks, in pick order (preserved on the wire).
 */
export function buildAdditionalAnchors(
  extras: readonly ChipPick[],
): AdditionalAnchor[] | undefined {
  if (extras.length === 0) return undefined;
  return extras.map(toAnchor);
}

/**
 * Remove a chip by key from a pick list, preserving order. Used for both the
 * primary+extras chip row removal and the extras-only list; the caller decides
 * which list to pass (the primary is never removable in the UI).
 */
export function removeChip(picks: readonly ChipPick[], key: string): ChipPick[] {
  return picks.filter((p) => p.key !== key);
}
