// SPDX-License-Identifier: Apache-2.0
import { BRAND_VIEWBOX, PIN_PATH } from './brand';

export function buildPinIcon(size: number, fill: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', BRAND_VIEWBOX);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PIN_PATH);
  path.setAttribute('fill', fill);
  svg.appendChild(path);
  return svg;
}
