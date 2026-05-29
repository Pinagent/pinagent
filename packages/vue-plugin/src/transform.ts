// SPDX-License-Identifier: Apache-2.0
import type { AttributeNode, ElementNode, TemplateChildNode } from '@vue/compiler-core';
import { parse } from '@vue/compiler-sfc';

// @vue/compiler-sfc ships NodeTypes / ElementTypes as `const enum`s, which the
// build inlines and erases — they aren't on the runtime namespace, so we pin
// the numeric values here. These are a stable part of Vue's public AST shape.
const NODE_ELEMENT = 1; // NodeTypes.ELEMENT
const NODE_ATTRIBUTE = 6; // NodeTypes.ATTRIBUTE
const NODE_IF = 9; // NodeTypes.IF
const NODE_FOR = 11; // NodeTypes.FOR
const EL_SLOT = 2; // ElementTypes.SLOT
const EL_TEMPLATE = 3; // ElementTypes.TEMPLATE

// This is the Vue analogue of @pinagent/babel-plugin's transformJsx.
//
// Vue Single-File Components don't use JSX: the markup lives in a
// `<template>` block written in Vue's HTML-flavoured template syntax,
// which Babel can't see. So instead of walking a JSX AST we walk the
// template AST that @vue/compiler-sfc hands us, and splice the same
// `data-pa-loc="<relPath>:<line>:<col>"` attribute onto each element.
//
// The widget, middleware, screenshotting, agent-runner, SQLite, and MCP
// layers are all framework-agnostic and need zero changes — this file is
// the only genuinely Vue-specific piece of source mapping.

const ATTR = 'data-pa-loc';

export interface TransformOptions {
  /** Relative path (POSIX) to embed into the attribute. */
  relPath: string;
}

interface SplicePoint {
  pos: number;
  insertion: string;
}

/**
 * Tag every element in a Vue SFC `<template>` block with `data-pa-loc`.
 *
 * Returns the rewritten SFC source, or `null` when there's nothing to do
 * (no template, no taggable elements, or an unparseable file) — matching
 * the babel plugin's "null means skip" contract so the bundler glue can
 * treat both transforms identically.
 */
export function transformVue(code: string, opts: TransformOptions): string | null {
  // Quick filter: an SFC with no template block has no DOM to anchor to.
  if (!/<template[\s>]/.test(code)) return null;

  let template: ReturnType<typeof parse>['descriptor']['template'];
  try {
    ({
      descriptor: { template },
    } = parse(code, { filename: opts.relPath }));
  } catch {
    return null;
  }

  // No inline template (e.g. `<template src="./foo.html" />`) means the AST
  // lives in another file we don't control here — skip.
  if (!template?.ast) return null;

  // The SFC parser reports element locations relative to the *whole file*
  // (verified: a `<div>` on file line 6 reports line: 6), so we can splice
  // straight into the original source without any offset bookkeeping. That's
  // also what keeps source maps honest — we never regenerate, only insert.
  const points: SplicePoint[] = [];

  const visit = (node: TemplateChildNode): void => {
    if (node.type === NODE_ELEMENT) {
      collect(node, opts.relPath, points);
      for (const child of node.children) visit(child);
    } else if (node.type === NODE_IF) {
      // v-if / v-else-if / v-else branches each carry their own subtree.
      for (const branch of node.branches) {
        for (const child of branch.children) visit(child);
      }
    } else if (node.type === NODE_FOR) {
      // v-for wraps a single child subtree.
      for (const child of node.children) visit(child);
    }
  };

  for (const child of template.ast.children) visit(child);

  if (points.length === 0) return null;

  // Splice from the back so earlier insertions don't shift later offsets.
  points.sort((a, b) => b.pos - a.pos);
  let out = code;
  for (const p of points) {
    out = out.slice(0, p.pos) + p.insertion + out.slice(p.pos);
  }
  return out;
}

function collect(node: ElementNode, relPath: string, points: SplicePoint[]): void {
  // `<template>` and `<slot>` are compiler constructs, not real DOM — they
  // never render an element we could anchor a click to. Tag native elements
  // and components; a component's fallthrough attrs land on its root DOM node.
  if (node.tagType === EL_TEMPLATE || node.tagType === EL_SLOT) {
    return;
  }

  // Idempotent: don't double-tag a node that already carries the attribute.
  const already = node.props.some(
    (p): p is AttributeNode => p.type === NODE_ATTRIBUTE && p.name === ATTR,
  );
  if (already) return;

  const start = node.loc.start;
  if (typeof start.offset !== 'number') return;

  // `start.offset` points at the `<`; the tag name follows it. Insert the
  // attribute immediately after the name so we never disturb existing props.
  const pos = start.offset + 1 + node.tag.length;
  // Vue columns are already 1-indexed and point at the `<`, which is exactly
  // the convention the babel plugin normalises JSX columns to (col + 1).
  const value = `${relPath}:${start.line}:${start.column}`;
  points.push({ pos, insertion: ` ${ATTR}="${escapeAttr(value)}"` });
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
