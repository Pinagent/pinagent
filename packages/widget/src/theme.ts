// SPDX-License-Identifier: Apache-2.0
/**
 * Widget dark theme — the single resolved palette the widget's inline CSS
 * strings (styles.ts, composer-styles.ts, constants.ts) template from.
 *
 * The widget renders into a shadow root / iframe on arbitrary host pages and
 * has no access to Tailwind utilities or the dock's `.dark` class, so it can't
 * pick up the dock's theme at runtime. Instead it pins a dark presentation
 * (matching the dock's dark mode) and inlines these values at module-load
 * time. Surfaces come from SURFACE_DARK and status tones from STATUS_DARK in
 * @pinagent/ui/tokens, so the widget and dock can't drift.
 *
 * Re-exporting STATUS_DARK as `STATUS` keeps the existing `STATUS.<key>.<fg|
 * bg|border>` call sites unchanged — only the import path swaps from
 * @pinagent/ui/tokens to here.
 */
import { STATUS_DARK, SURFACE_DARK } from '@pinagent/ui/tokens';

export { STATUS_DARK as STATUS };

export const THEME = {
  /** Deepest surface — page level + recessed wells (textarea, log, inputs). */
  base: SURFACE_DARK.background, // #201B21
  /** Elevated panel — composer card, FAB, tray, bubbles, popovers, toast. */
  surface: SURFACE_DARK.card, // #2A2528
  /** Primary text. */
  text: SURFACE_DARK.foreground, // #FCF9E8
  /** Secondary / meta text. */
  textMuted: SURFACE_DARK.mutedForeground, // #C9BC85
  /** Faint text — placeholders, breadcrumb separators, disabled labels. */
  textFaint: 'rgba(252, 249, 232, 0.42)',
  /** Hairline borders + dividers. */
  border: SURFACE_DARK.border, // #3D3730
  /** Gold accent — focus, active picker, "+N" extras, count badges. */
  accent: SURFACE_DARK.accent, // #FFD700
  /** Soft gold focus ring. */
  ring: 'rgba(255, 215, 0, 0.45)',
  /** Primary button — inverts to cream-on-ink for a strong CTA on dark. */
  primary: SURFACE_DARK.primary, // #FCF9E8
  primaryFg: SURFACE_DARK.primaryForeground, // #201B21
  primaryHover: '#ECE7D4',
  /** Subtle cream-tint fills layered over a dark surface. */
  hover: 'rgba(252, 249, 232, 0.06)',
  hoverStrong: 'rgba(252, 249, 232, 0.10)',
  /** Highlighted inline code / tag pills (element pill, breadcrumb selected). */
  chip: 'rgba(252, 249, 232, 0.10)',
} as const;
