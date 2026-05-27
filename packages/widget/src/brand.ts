// SPDX-License-Identifier: Apache-2.0
/**
 * Pinagent brand primitives. Single source of truth for the pin
 * shape and the two brand colors — imported by the widget bundle,
 * the picker cursor data URL, the `<Logo>` component, and any
 * marketing surface that needs the mark.
 *
 * Colors re-exported from @pinagent/ui/tokens so the dock, the widget,
 * and any other surface share one canonical palette.
 */

import { BRAND_CREAM, BRAND_GOLD, BRAND_INK } from '@pinagent/ui/tokens';

export { BRAND_CREAM, BRAND_GOLD, BRAND_INK };

/**
 * Pin teardrop path on a 93x93 viewBox. The full mark sits on a
 * cream square; the FAB and cursor draw just the pin.
 */
export const PIN_PATH =
  'M38.0761 27C24.2046 27 16.7486 43.8193 26.2852 53.7027L26.4587 53.8761L47.2659 74.6834L68.0732 53.8761L68.2466 53.7027C77.9567 43.8193 70.3273 27 56.4558 27L38.0761 27Z';

export const BRAND_VIEWBOX = '0 0 93 93';

/**
 * `cursor: url(...)` value used while picking. The pin is rotated
 * 135° around the viewBox centre so the tip points to ~10:30,
 * matching how an arrow cursor normally aims. Cream stroke + dark
 * fill stay legible on both light and dark backgrounds.
 *
 * Pre-encoded as a `data:image/svg+xml;utf8,...` string so the
 * widget can drop it straight into a CSS rule. Browsers that won't
 * render SVG cursors fall back to `crosshair` via the caller's rule.
 */
export const PICKER_CURSOR_DATA_URL = `url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 93 93'%3E%3Cg transform='rotate(135 46.5 46.5)'%3E%3Cpath d='${PIN_PATH}' fill='%23201B21' stroke='%23FCF9E8' stroke-width='4' stroke-linejoin='round'/%3E%3C/g%3E%3C/svg%3E") 9 9`;
