import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';

// Inject the Pinagent widget loader into the SSR'd HTML — dev only. SvelteKit
// renders its own document (app.html), so Vite's transformIndexHtml (how
// @pinagent/vite-plugin injects the widget for SPAs) never fires; the
// transformPageChunk hook is the SvelteKit-idiomatic seam for it. The bundle is
// served by the /__pinagent/widget.js middleware the Vite plugin mounts.
const WIDGET = '<script src="/__pinagent/widget.js" type="module"></script>';

export const handle: Handle = ({ event, resolve }) =>
  resolve(event, {
    transformPageChunk: dev ? ({ html }) => html.replace('</body>', `${WIDGET}</body>`) : undefined,
  });
