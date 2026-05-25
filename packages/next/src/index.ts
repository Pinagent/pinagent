// Client-only entry. The `<Pinpoint />` component must run as a client component
// so it can mount the widget script via useEffect (avoiding SSR/hydration races
// with PostHog and other third-party script injectors).
//
// The `'use client'` directive is added by tsup banner for this bundle.
//
// For the Next config wrapper, import from `@pinpoint/next/config`.
// For route handlers, import from `@pinpoint/next/route`.
export { Pinpoint } from './component';
