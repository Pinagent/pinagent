// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

// Pull the widget IIFE into the dev demo so the per-element picker FAB,
// the "c" hotkey, and the picker outline all work alongside the dock
// FAB. The IIFE self-mounts on load (see packages/widget/src/index.ts);
// Vite's `?url` resolves to the built dist path, and a classic script
// tag executes it. No WS server runs in this dev preview, so the
// agent-backend bits will fail gracefully — the UX surfaces still
// render so you can evaluate both FABs together.
import widgetIifeUrl from '@pinagent/widget/iife?url';

const widgetScript = document.createElement('script');
widgetScript.src = widgetIifeUrl;
widgetScript.async = true;
document.head.appendChild(widgetScript);

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
