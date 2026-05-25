'use client';

import { useEffect } from 'react';

/**
 * Mount this in your root layout (typically `app/layout.tsx`) inside `<body>`.
 * It mounts the Pinagent widget script imperatively *after* hydration, so it
 * never participates in SSR and can't cause hydration mismatches with other
 * client-side script injectors (PostHog, GTM, Hotjar, etc.).
 *
 * Renders nothing in production builds.
 */
export function Pinagent(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    if (typeof document === 'undefined') return;
    if (document.getElementById('__pinagent-script')) return;

    const s = document.createElement('script');
    s.id = '__pinagent-script';
    s.src = '/__pinagent/widget.js';
    s.defer = true;
    document.head.appendChild(s);
  }, []);

  return null;
}
