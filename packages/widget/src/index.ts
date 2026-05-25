import { mount } from './widget';

// Only mount once per page load.
declare global {
  interface Window {
    __pinpointMounted?: boolean;
  }
}

if (typeof window !== 'undefined' && !window.__pinpointMounted) {
  window.__pinpointMounted = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
  } else {
    mount();
  }
}
