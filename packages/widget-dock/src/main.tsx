// SPDX-License-Identifier: Apache-2.0

import widgetIifeUrl from '@pinagent/widget/iife?url';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

// In embedded mode the dock is loaded inside an iframe injected by the
// vite-plugin / next-plugin onto a host page. The host page has already
// mounted the widget IIFE separately — so we skip the script load here
// to avoid a double-mount. (`window.__pinagentMounted` would short-
// circuit it anyway, but not loading the bytes is cleaner.)
//
// Outside embedded mode (the dev preview), pull the widget IIFE in so
// both FABs and the "c" hotkey are exercisable side-by-side.
const isEmbedded = isEmbeddedMode();
if (!isEmbedded) {
  const widgetScript = document.createElement('script');
  widgetScript.src = widgetIifeUrl;
  widgetScript.async = true;
  document.head.appendChild(widgetScript);
}

// Flip a data attribute on <html> so globals.css can branch on embedded
// mode (transparent body, click-through chrome). Set before React mounts
// so the body styles apply on first paint without a flicker.
if (isEmbedded) {
  document.documentElement.dataset.pinagentEmbedded = 'true';
}

function isEmbeddedMode(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('embedded') === 'on';
}

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
