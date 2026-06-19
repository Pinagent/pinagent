// SPDX-License-Identifier: Apache-2.0
/**
 * Pinagent brand palette for the React Native widget.
 *
 * Mirrors BRAND_INK / BRAND_CREAM / BRAND_GOLD in `packages/ui/src/tokens.ts`. That
 * package is web-only (React-DOM + Tailwind) so the native widget can't import
 * it — keep these in sync if the brand palette changes there.
 */

/** Dark charcoal — the FAB surface / ink-mode surfaces and primary text. */
export const BRAND_INK = '#201B21';
/** Warm cream — the pin mark on dark surfaces, light backgrounds, brand identity. */
export const BRAND_CREAM = '#FCF9E8';
/** Gold accent — focus rings; the active picking state. */
export const BRAND_GOLD = '#FFD700';
