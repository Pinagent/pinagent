// SPDX-License-Identifier: Apache-2.0
import { mount } from './widget';

// Only mount once per page load.
declare global {
  interface Window {
    __pinagentMounted?: boolean;
  }
}

if (typeof window !== 'undefined' && !window.__pinagentMounted) {
  window.__pinagentMounted = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
  } else {
    mount();
  }
}
