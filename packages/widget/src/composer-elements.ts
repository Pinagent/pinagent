// SPDX-License-Identifier: Apache-2.0

import { composerHTML, ICON_STOP, ICON_X } from './composer-html';
import { COMPOSER_H, IFRAME_W } from './constants';
import { THEME } from './theme';
import type { ComposerMeta } from './types';

/**
 * The set of DOM nodes a composer owns, all parented to `document.body`
 * (not the shadow root) so they position in page coordinates and scroll
 * naturally with the page.
 */
export interface ComposerElements {
  iframe: HTMLIFrameElement;
  bubble: HTMLDivElement;
  bubbleActions: HTMLDivElement;
  baStop: HTMLButtonElement;
  baCancel: HTMLButtonElement;
  dragHandle: HTMLDivElement;
  pointer: SVGSVGElement;
  pointerPath: SVGPathElement;
}

/**
 * Build (and attach) every DOM node a composer needs: the feedback iframe,
 * the floating status bubble, its hover action row (stop / cancel), the drag
 * grip, and the pointer tail. Positioning is left to the caller's rAF loop;
 * this only constructs the nodes and appends them to `document.body`.
 */
export function createComposerElements(meta: ComposerMeta): ComposerElements {
  // Iframe lives in document.body (not the shadow root) so it scrolls
  // naturally with the page via absolute positioning in page coords.
  const iframe = document.createElement('iframe');
  iframe.className = 'pa-iframe';
  iframe.title = 'Pinagent feedback';
  iframe.style.pointerEvents = 'auto';
  iframe.srcdoc = composerHTML(meta);
  iframe.style.width = `${IFRAME_W}px`;
  iframe.style.height = `${COMPOSER_H}px`;
  document.body.appendChild(iframe);

  const bubble = document.createElement('div');
  bubble.className = 'pa-bubble pending';
  bubble.title = 'Pinagent — click to expand';
  bubble.hidden = true;
  bubble.innerHTML = '<div class="pa-bubble-spinner"></div>';
  document.body.appendChild(bubble);

  // Floating-bubble action row (viewState: 'bubble'). Same affordances
  // as the minimal bar — stop while running, cancel (stop + dismiss)
  // always — revealed on hover of the dot or the row. Lives in
  // document.body next to the bubble so reposition() can track it.
  const bubbleActions = document.createElement('div');
  bubbleActions.className = 'pa-bubble-actions';
  bubbleActions.hidden = true;
  const baStop = document.createElement('button');
  baStop.className = 'pa-ba-btn';
  baStop.type = 'button';
  baStop.title = 'Stop the agent';
  baStop.setAttribute('aria-label', 'Stop the agent');
  baStop.innerHTML = ICON_STOP;
  const baCancel = document.createElement('button');
  baCancel.className = 'pa-ba-btn danger';
  baCancel.type = 'button';
  baCancel.title = 'Cancel — stop and dismiss';
  baCancel.setAttribute('aria-label', 'Cancel — stop and dismiss');
  baCancel.innerHTML = ICON_X;
  bubbleActions.appendChild(baStop);
  bubbleActions.appendChild(baCancel);
  document.body.appendChild(bubbleActions);

  // Drag grip — small visible handle inside the top-right corner of
  // the iframe header. Lives in document.body (not inside the iframe)
  // so we can track mousemove/mouseup on the parent document during a
  // drag, which we couldn't do from inside the iframe. The 2x4 dots
  // grid mirrors the redesign mock; styled in DOC_STYLES.
  const dragHandle = document.createElement('div');
  dragHandle.className = 'pa-drag-handle';
  dragHandle.title = 'Drag to reposition';
  dragHandle.innerHTML =
    '<svg width="8" height="16" viewBox="0 0 8 16" aria-hidden="true" fill="currentColor">' +
    '<circle cx="2" cy="2" r="1"/><circle cx="6" cy="2" r="1"/>' +
    '<circle cx="2" cy="6" r="1"/><circle cx="6" cy="6" r="1"/>' +
    '<circle cx="2" cy="10" r="1"/><circle cx="6" cy="10" r="1"/>' +
    '<circle cx="2" cy="14" r="1"/><circle cx="6" cy="14" r="1"/>' +
    '</svg>';
  document.body.appendChild(dragHandle);

  // Pointer tail — a small SVG triangle that sits on whichever edge
  // of the widget faces the target, so the widget visually anchors
  // back to the picked element. The path is two strokes only (the
  // two slanted edges) so the flat edge sits flush with the widget
  // border without doubling it.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const pointer = document.createElementNS(SVG_NS, 'svg');
  pointer.setAttribute('class', 'pa-pointer');
  pointer.setAttribute('viewBox', '0 0 18 10');
  const pointerPath = document.createElementNS(SVG_NS, 'path');
  pointerPath.setAttribute('fill', THEME.surface);
  pointerPath.setAttribute('stroke', THEME.border);
  pointerPath.setAttribute('stroke-width', '1');
  pointerPath.setAttribute('stroke-linejoin', 'round');
  pointer.appendChild(pointerPath);
  document.body.appendChild(pointer);

  return { iframe, bubble, bubbleActions, baStop, baCancel, dragHandle, pointer, pointerPath };
}
