// SPDX-License-Identifier: Apache-2.0
/**
 * Pinagent design tokens — single source of truth.
 *
 * Consumed by two systems that can't share a runtime:
 *   1. The dock and any Next.js / Vite app via Tailwind 4 + globals.css.
 *      Tailwind's CSS-first config can't import TS, so globals.css mirrors
 *      these values as CSS custom properties. Keep them in sync — the comment
 *      in globals.css points back here.
 *   2. The widget's inline CSS strings (packages/widget/src/styles.ts and
 *      composer-styles.ts), which inject into a shadow root on arbitrary host
 *      pages and have no access to Tailwind utilities. Those modules import
 *      from here and template-literal values into the CSS strings.
 *
 * Pure TS — no React, no CSS, no DOM. Safe to import from any bundle.
 */

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

/** Dark charcoal — primary text, primary button, ink-mode FAB. */
export const BRAND_INK = '#201B21';
/** Warm cream — surfaces, light-mode background, brand identity. */
export const BRAND_CREAM = '#FCF9E8';
/** Gold accent — used sparingly: focus rings, primary CTAs, count badges. */
export const BRAND_GOLD = '#FFD700';

/**
 * Pin teardrop path on a 93x93 viewBox. The full mark sits on a
 * cream square; FAB / cursor / dock chrome / marketing all draw just
 * the pin via <PinMark /> in @pinagent/ui/components/pin-mark.
 */
export const PIN_PATH =
  'M38.0761 27C24.2046 27 16.7486 43.8193 26.2852 53.7027L26.4587 53.8761L47.2659 74.6834L68.0732 53.8761L68.2466 53.7027C77.9567 43.8193 70.3273 27 56.4558 27L38.0761 27Z';

/** Viewbox string for the pin teardrop. */
export const BRAND_VIEWBOX = '0 0 93 93';

// ---------------------------------------------------------------------------
// Surface palette — light mode
// ---------------------------------------------------------------------------

export const SURFACE_LIGHT = {
  background: '#FCF9E8',
  foreground: '#201B21',
  card: '#FCF9E8',
  cardForeground: '#201B21',
  popover: '#FCF9E8',
  popoverForeground: '#201B21',
  primary: '#201B21',
  primaryForeground: '#FCF9E8',
  secondary: '#F5EFD0',
  secondaryForeground: '#201B21',
  muted: '#F5EFD0',
  mutedForeground: '#5C5546',
  accent: '#FFD700',
  accentForeground: '#201B21',
  destructive: '#B91C1C',
  destructiveForeground: '#FCF9E8',
  border: '#E8DFB0',
  input: '#E8DFB0',
  ring: '#201B21',
} as const;

// ---------------------------------------------------------------------------
// Surface palette — dark mode
// ---------------------------------------------------------------------------

export const SURFACE_DARK = {
  background: '#201B21',
  foreground: '#FCF9E8',
  card: '#2A2528',
  cardForeground: '#FCF9E8',
  popover: '#2A2528',
  popoverForeground: '#FCF9E8',
  primary: '#FCF9E8',
  primaryForeground: '#201B21',
  secondary: '#2A2528',
  secondaryForeground: '#FCF9E8',
  muted: '#2A2528',
  mutedForeground: '#C9BC85',
  accent: '#FFD700',
  accentForeground: '#201B21',
  destructive: '#B91C1C',
  destructiveForeground: '#FCF9E8',
  border: '#3D3730',
  input: '#3D3730',
  ring: '#FCF9E8',
} as const;

// ---------------------------------------------------------------------------
// Status palette
//
// Tuned to read clearly on cream (#FCF9E8) without the visual screaming of
// conventional green/red/amber. Each status carries fg/bg/border so the same
// triplet works for badges, dots, and outlined chips. AA-contrast verified
// against both BRAND_CREAM and BRAND_INK.
// ---------------------------------------------------------------------------

export type StatusKey =
  | 'pending'
  | 'working'
  | 'awaitingClarification'
  | 'readyToLand'
  | 'landed'
  | 'discarded'
  | 'error'
  | 'anchorLost';

export interface StatusTone {
  fg: string;
  bg: string;
  border: string;
  /** Optional CSS border style override; default is 'solid'. */
  borderStyle?: 'solid' | 'dashed';
}

export const STATUS: Record<StatusKey, StatusTone> = {
  pending: { fg: '#8A7A2E', bg: '#FAF4D6', border: '#E8DFB0' },
  working: { fg: '#C77A1E', bg: '#FAEBD6', border: '#E8C9A0' },
  awaitingClarification: { fg: '#7A5E00', bg: '#FFF4B8', border: '#FFD700' },
  readyToLand: { fg: '#3F7A4A', bg: '#E5F0DF', border: '#B8D4B5' },
  landed: { fg: '#2E5A38', bg: '#D9E8D2', border: '#A4C49E' },
  discarded: { fg: '#5C5546', bg: '#F0EAD0', border: '#D5CCA0' },
  error: { fg: '#A1331C', bg: '#FAE2DA', border: '#E8B5A0' },
  anchorLost: {
    fg: '#7A6B2E',
    bg: '#FAF4D6',
    border: '#C9B863',
    borderStyle: 'dashed',
  },
};

/**
 * Dark-mode status palette — same eight tones tuned to read on the deep ink
 * surfaces (#201B21 / #2A2528) instead of cream: brighter fg, dim desaturated
 * bg, mid-tone border. Mirrors the `.dark` status block in globals.css and is
 * consumed by the dark-mode widget (see packages/widget/src/theme.ts).
 */
export const STATUS_DARK: Record<StatusKey, StatusTone> = {
  pending: { fg: '#C9BC85', bg: '#2F2925', border: '#4A4030' },
  working: { fg: '#E3A268', bg: '#322820', border: '#5A4530' },
  awaitingClarification: { fg: '#FFD700', bg: '#3A3010', border: '#806020' },
  readyToLand: { fg: '#8FBF90', bg: '#1F2A20', border: '#3A5240' },
  landed: { fg: '#6FA275', bg: '#1A2520', border: '#2F4230' },
  discarded: { fg: '#A39A72', bg: '#2A2520', border: '#4A4030' },
  error: { fg: '#E89478', bg: '#3A2520', border: '#6A3A2A' },
  anchorLost: {
    fg: '#C9B863',
    bg: '#2F2925',
    border: '#6A5A2A',
    borderStyle: 'dashed',
  },
};

// ---------------------------------------------------------------------------
// Radii
// ---------------------------------------------------------------------------

/** Base radius (matches Tailwind --radius custom property). */
export const RADIUS_BASE = '0.625rem'; // 10px
export const RADIUS = {
  xs: '0.3125rem', // base * 0.5
  sm: '0.46875rem', // base * 0.75
  md: '0.546875rem', // base * 0.875
  lg: RADIUS_BASE,
  xl: '0.9375rem', // base * 1.5
  full: '9999px',
} as const;

// ---------------------------------------------------------------------------
// Shadows — cream-friendly (warmer / softer than slate-black drop shadows)
// ---------------------------------------------------------------------------

export const SHADOW = {
  /** Subtle, used on cards and chips. */
  xs: '0 1px 2px rgba(32, 27, 33, 0.06)',
  /** Default raised surface. */
  sm: '0 2px 6px rgba(32, 27, 33, 0.08)',
  /** Composer, dropdowns. */
  md: '0 6px 16px rgba(32, 27, 33, 0.12)',
  /** FAB, floating dock window. */
  lg: '0 10px 28px rgba(32, 27, 33, 0.18)',
  /** Full overlay (dialog, sheet). */
  xl: '0 24px 56px rgba(32, 27, 33, 0.28)',
  /** Focus ring (gold, soft). */
  ring: '0 0 0 3px rgba(255, 215, 0, 0.45)',
} as const;

// ---------------------------------------------------------------------------
// Z-index ladder
//
// The widget injects into arbitrary host pages and must reliably sit on top.
// Use the max-signed-32-bit range and step down predictably so widget chrome
// stays above any host-page popover, modal, or zIndex: 9999 artifact.
// ---------------------------------------------------------------------------

export const Z = {
  /** Element-picker outline overlay. */
  pickerOutline: 2147483645,
  /** Composer iframe (open chat). */
  composer: 2147483646,
  /** Per-element minimized bubble. */
  bubble: 2147483646,
  /** FAB — always-on-top so the user can open/close from anywhere. */
  fab: 2147483647,
  /** Hint banner (during picking). */
  hint: 2147483647,
} as const;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/** Sans stack — Geist with system-font fallback. */
export const FONT_SANS =
  '"Geist Variable", "Geist", "Geist Fallback", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif';

/** Monospace stack — Geist Mono with system-mono fallback. */
export const FONT_MONO =
  '"Geist Mono Variable", "Geist Mono", "Geist Mono Fallback", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export const EASING = {
  /** Smooth corner-snap, used for FAB/panel position changes. */
  snap: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  /** Standard ease for hovers and quick tweens. */
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

export const DURATION = {
  fast: '120ms',
  medium: '220ms',
  slow: '360ms',
} as const;
