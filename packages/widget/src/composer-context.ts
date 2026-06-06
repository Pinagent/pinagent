// SPDX-License-Identifier: Apache-2.0

import type { PickExtra } from './context';
import {
  breadcrumbTags,
  componentOf,
  componentPath,
  describeElementLabel,
  elementFingerprint,
  findLoc,
  findLocEl,
  locInstanceInfo,
  type PaLoc,
  shortSelector,
} from './selector';
import type { ComposerMeta, ExtraAnchor, InstanceInfo } from './types';

/**
 * The resolved element identity for a composer: source location, selector,
 * enclosing component, breadcrumb trail, and the wire anchors + display rows
 * for any multi-picked extras. Derived once at creation from the picked DOM.
 */
export interface ComposerContext {
  loc: PaLoc | null;
  selector: string;
  component: string | null;
  compPath: string[];
  instance: InstanceInfo | null;
  extraAnchors: ExtraAnchor[];
  meta: ComposerMeta;
  dataPaLoc: string | null;
}

/**
 * Resolve the source/component context for a freshly-picked element (plus any
 * multi-selected extras) into the shape the composer stores and the iframe
 * renders. Kept byte-identical to single-pick payloads: `instance` stays null
 * unless the loc is shared by several live nodes (a `.map()`).
 */
export function resolveComposerContext(target: Element, extras: PickExtra[]): ComposerContext {
  const locHit = findLocEl(target);
  const loc = locHit?.loc ?? null;
  const selector = shortSelector(target);
  // Enclosing-component context (from `data-pa-comp`). `component` and
  // the path read off the same walk-up as the loc; `instance` is only
  // meaningful when the resolved loc is shared by several live nodes
  // (a `.map()`), so we leave it null otherwise to keep single-pick
  // payloads byte-identical to before.
  const component = componentOf(target);
  const compPath = componentPath(target);
  let instance: InstanceInfo | null = null;
  if (locHit) {
    const info = locInstanceInfo(locHit.el, locHit.raw);
    if (info.total > 1) {
      instance = {
        index: Math.max(0, info.index),
        total: info.total,
        fingerprint: elementFingerprint(locHit.el),
      };
    }
  }
  // Resolve each extra once, deriving both the wire anchor (sent to
  // the server on submit) and the display row (the badge popover).
  const extraData = extras.map(({ target: t, click: c }: PickExtra) => {
    const eloc = findLoc(t);
    return {
      anchor: {
        file: eloc?.file ?? null,
        line: eloc?.line ?? null,
        col: eloc?.col ?? null,
        selector: shortSelector(t),
        clickX: c.x,
        clickY: c.y,
        component: componentOf(t),
      } as ExtraAnchor,
      display: { tag: t.tagName.toLowerCase(), label: describeElementLabel(t), loc: eloc },
    };
  });
  const extraAnchors: ExtraAnchor[] = extraData.map((d) => d.anchor);
  const meta: ComposerMeta = {
    tag: target.tagName.toLowerCase(),
    label: describeElementLabel(target),
    loc,
    component,
    breadcrumbs: breadcrumbTags(target),
    extraCount: extraAnchors.length,
    extras: extraData.map((d) => d.display),
  };
  const dataPaLoc = loc ? `${loc.file}:${loc.line}:${loc.col}` : null;
  return { loc, selector, component, compPath, instance, extraAnchors, meta, dataPaLoc };
}
