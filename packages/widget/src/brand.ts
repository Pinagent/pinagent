// SPDX-License-Identifier: Apache-2.0
/**
 * Pinagent brand primitives — re-exported from @pinagent/ui/tokens so
 * every surface (widget bundle, picker cursor, <Logo>, marketing pages)
 * pulls from one source. This module owns only the picker-cursor data
 * URL, which lives here because the widget is the only consumer that
 * needs the pre-encoded `cursor: url(...)` form.
 */

import {
  BRAND_CREAM,
  BRAND_GOLD,
  BRAND_INK,
  BRAND_VIEWBOX,
  PIN_PATH,
} from '@pinagent/ui/tokens';

export { BRAND_CREAM, BRAND_GOLD, BRAND_INK, BRAND_VIEWBOX, PIN_PATH };

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
