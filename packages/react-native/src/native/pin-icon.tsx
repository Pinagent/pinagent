// SPDX-License-Identifier: Apache-2.0
/**
 * PinIcon — pinagent's teardrop pin mark, for the React Native FAB.
 *
 * The mark is the canonical PIN_PATH / BRAND_VIEWBOX from `packages/ui/src/tokens.ts`
 * (web-only, hence mirrored here). We draw it with `react-native-svg` when it's
 * available — an OPTIONAL peer, lazily required exactly like
 * `react-native-view-shot` in screenshot.ts, so a release build never pulls the
 * native module in: the require only runs once <Pinagent/> actually renders,
 * which it never does when `!__DEV__`.
 *
 * When the peer isn't installed we fall back to a View-drawn teardrop in the
 * same colour, so the FAB always shows a brand pin — never a generic glyph.
 */
import type { ReactElement } from 'react';
import { View } from 'react-native';

// Canonical pinagent pin — mirror of PIN_PATH / BRAND_VIEWBOX in
// `packages/ui/src/tokens.ts`. Keep in sync if the mark changes there.
const PIN_PATH =
  'M38.0761 27C24.2046 27 16.7486 43.8193 26.2852 53.7027L26.4587 53.8761L47.2659 74.6834L68.0732 53.8761L68.2466 53.7027C77.9567 43.8193 70.3273 27 56.4558 27L38.0761 27Z';
const VIEWBOX = '0 0 93 93';

// The two react-native-svg components we use, or `null` when the peer isn't
// installed. Typed loosely (the peer's types aren't a dep) — native/ isn't
// tsc-typechecked, and these are only ever rendered as JSX elements.
type SvgModule = { Svg: unknown; Path: unknown } | null;

// Resolved once, on first render (dev only — see header). `undefined` = not yet
// resolved, `null` = peer not installed.
let svgModule: SvgModule | undefined;
function resolveSvg(): SvgModule {
  if (svgModule !== undefined) return svgModule;
  try {
    // Lazy require so a release build never pulls the native module in.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const mod = require('react-native-svg');
    svgModule = { Svg: mod.Svg ?? mod.default, Path: mod.Path };
  } catch {
    svgModule = null;
  }
  return svgModule;
}

export interface PinIconProps {
  /** Square edge length, in px. */
  size?: number;
  /** Fill colour of the pin (pass a brand token). */
  color: string;
}

export function PinIcon({ size = 26, color }: PinIconProps): ReactElement {
  const svg = resolveSvg();
  if (svg?.Svg && svg.Path) {
    const { Svg, Path } = svg;
    return (
      <Svg width={size} height={size} viewBox={VIEWBOX}>
        <Path d={PIN_PATH} fill={color} />
      </Svg>
    );
  }
  return <FallbackPin size={size} color={color} />;
}

/**
 * react-native-svg-free fallback: a map-pin teardrop drawn from a single View —
 * a rounded square with one squared corner, rotated so the point faces down.
 * The classic CSS `border-radius: 50% 50% 50% 0` recipe, in the brand colour.
 */
function FallbackPin({ size, color }: { size: number; color: string }): ReactElement {
  const d = Math.round(size * 0.8);
  return (
    <View
      style={{
        width: d,
        height: d,
        backgroundColor: color,
        borderTopLeftRadius: d / 2,
        borderTopRightRadius: d / 2,
        borderBottomRightRadius: d / 2,
        borderBottomLeftRadius: 0,
        transform: [{ rotate: '-45deg' }],
      }}
    />
  );
}
