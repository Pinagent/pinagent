// SPDX-License-Identifier: Apache-2.0
// Client-only entry. The `<Pinagent />` component must run as a client component
// so it can mount the widget script via useEffect (avoiding SSR/hydration races
// with PostHog and other third-party script injectors).
//
// The `'use client'` directive is added by the tsdown banner for this bundle.
//
// For the Next config wrapper, import from `@pinagent/next-plugin/config`.
// For route handlers, import from `@pinagent/next-plugin/route`.
export { Pinagent } from './component';
