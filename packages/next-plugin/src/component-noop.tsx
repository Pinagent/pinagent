// SPDX-License-Identifier: Apache-2.0
// Production stub for the `<Pinagent />` component.
//
// Resolved by the `"default"` condition in package.json exports when the
// bundler is not running in `"development"`. Keeps the heavier
// `./component` module — and any transitive deps it might pick up later —
// out of prod client bundles.
//
// Marked `'use client'` to match the dev component's boundary so consumer
// layouts behave identically.
'use client';

export interface PinagentProps {
  /**
   * Accepted for prop-signature parity with the dev component; ignored
   * in production builds (the dock, like the widget, is dev-only).
   */
  dock?: boolean;
}

export function Pinagent(_props: PinagentProps = {}): null {
  return null;
}
