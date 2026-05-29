// SPDX-License-Identifier: Apache-2.0
import { parse } from 'svelte/compiler';

// This is the Svelte analogue of @pinagent/babel-plugin's transformJsx and
// @pinagent/vue-plugin's transformVue.
//
// A Svelte component's markup isn't JSX and isn't wrapped in a Vue-style
// `<template>` — it's the top-level content of the `.svelte` file, parsed by
// Svelte's own compiler into an AST. So we parse with `svelte/compiler`, walk
// the markup fragment (descending into `{#if}` / `{#each}` / `{#await}`
// blocks), and splice the same `data-pa-loc="<relPath>:<line>:<col>"` (plus
// `data-pa-comp`) attributes onto each element.
//
// The widget, middleware, screenshotting, agent-runner, SQLite, and MCP layers
// are all framework-agnostic and need zero changes — this file is the only
// genuinely Svelte-specific piece of source mapping.

const ATTR = 'data-pa-loc';
/**
 * Companion attribute carrying the *enclosing component* name — the mirror of
 * the babel/vue plugins' `data-pa-comp`. The widget surfaces it as "you clicked
 * inside `<App>`", and because every element in the component carries the same
 * value, all `{#each}` instances share one component name — which is what makes
 * loop-instance disambiguation downstream resolve to the right item.
 *
 * In Svelte a `.svelte` file *is* a single component, so the enclosing-component
 * identity is just the file: `src/cards/PriceCard.svelte` → `PriceCard`.
 */
const COMP_ATTR = 'data-pa-comp';

export interface TransformOptions {
  /** Relative path (POSIX) to embed into the attribute. */
  relPath: string;
}

interface SplicePoint {
  pos: number;
  insertion: string;
}

// Minimal structural view of the Svelte AST nodes we walk. Svelte's exported
// `AST` types are a deep discriminated union that's awkward to thread through a
// generic recursive walk; we only need the tag name, the `<` offset, the
// attribute list, and the various child-bearing fields, so we pin those.
interface SvelteNode {
  type: string;
  name?: string;
  start?: number;
  attributes?: Array<{ type: string; name?: string }>;
  // Child containers across element + block node kinds.
  fragment?: { nodes?: SvelteNode[] };
  nodes?: SvelteNode[];
  body?: { nodes?: SvelteNode[] };
  fallback?: { nodes?: SvelteNode[] };
  consequent?: { nodes?: SvelteNode[] };
  alternate?: { nodes?: SvelteNode[] } | null;
  pending?: { nodes?: SvelteNode[] } | null;
  then?: { nodes?: SvelteNode[] } | null;
  catch?: { nodes?: SvelteNode[] } | null;
}

/**
 * Tag every element in a Svelte component's markup with `data-pa-loc`.
 *
 * Returns the rewritten source, or `null` when there's nothing to do (no
 * elements, or an unparseable file) — matching the babel/vue plugins' "null
 * means skip" contract so the bundler glue can treat all three identically.
 */
export function transformSvelte(code: string, opts: TransformOptions): string | null {
  // Quick filter: no tag, nothing to anchor to.
  if (!code.includes('<')) return null;

  let root: SvelteNode;
  try {
    // `modern: true` yields the Svelte 5 AST (Fragment with `.nodes`). The
    // compiler throws on invalid markup — bail rather than crash the build.
    root = parse(code, { modern: true }) as unknown as SvelteNode;
  } catch {
    return null;
  }

  const fragment = root.fragment;
  if (!fragment?.nodes) return null;

  const points: SplicePoint[] = [];
  const component = componentName(opts.relPath);

  for (const node of fragment.nodes) visit(node, code, opts.relPath, component, points);

  if (points.length === 0) return null;

  // Splice from the back so earlier insertions don't shift later offsets.
  points.sort((a, b) => b.pos - a.pos);
  let out = code;
  for (const p of points) {
    out = out.slice(0, p.pos) + p.insertion + out.slice(p.pos);
  }
  return out;
}

function visit(
  node: SvelteNode | null | undefined,
  code: string,
  relPath: string,
  component: string | null,
  points: SplicePoint[],
): void {
  if (!node) return;

  if (node.type === 'RegularElement' || node.type === 'Component') {
    collect(node, code, relPath, component, points);
  }

  // Descend into children. Elements nest under `.fragment`; control-flow
  // blocks carry their subtrees under block-specific fields. `<slot>` and
  // `<svelte:*>` specials still get walked (their *children* are taggable),
  // they just aren't tagged themselves (handled in `collect`).
  for (const child of node.fragment?.nodes ?? []) visit(child, code, relPath, component, points);
  for (const child of node.body?.nodes ?? []) visit(child, code, relPath, component, points);
  for (const child of node.fallback?.nodes ?? []) visit(child, code, relPath, component, points);
  for (const child of node.consequent?.nodes ?? []) visit(child, code, relPath, component, points);
  for (const child of node.alternate?.nodes ?? []) visit(child, code, relPath, component, points);
  for (const child of node.pending?.nodes ?? []) visit(child, code, relPath, component, points);
  for (const child of node.then?.nodes ?? []) visit(child, code, relPath, component, points);
  for (const child of node.catch?.nodes ?? []) visit(child, code, relPath, component, points);
}

function collect(
  node: SvelteNode,
  code: string,
  relPath: string,
  component: string | null,
  points: SplicePoint[],
): void {
  const { name } = node;
  if (typeof name !== 'string' || typeof node.start !== 'number') return;

  // Idempotent: don't double-tag a node that already carries the attribute.
  const already = (node.attributes ?? []).some((a) => a.type === 'Attribute' && a.name === ATTR);
  if (already) return;

  // `node.start` points at the `<`; the tag name follows it. Insert the
  // attribute immediately after the name so we never disturb existing props.
  const pos = node.start + 1 + name.length;
  const { line, col } = lineColAt(code, node.start);
  const value = `${relPath}:${line}:${col}`;
  let insertion = ` ${ATTR}="${escapeAttr(value)}"`;
  if (component) insertion += ` ${COMP_ATTR}="${escapeAttr(component)}"`;
  points.push({ pos, insertion });
}

/**
 * Resolve a character offset to a 1-indexed line and 1-indexed column. The
 * column points at the offset character (the `<`), matching the convention the
 * babel plugin normalises JSX columns to and the one Vue's SFC parser reports.
 */
function lineColAt(code: string, offset: number): { line: number; col: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset; i++) {
    if (code[i] === '\n') {
      line++;
      lastNewline = i;
    }
  }
  return { line, col: offset - lastNewline };
}

/**
 * Derive the enclosing component name from the file path: the basename with its
 * `.svelte` extension stripped (`src/cards/PriceCard.svelte` → `PriceCard`).
 * Returns null when no usable name can be recovered, so the attribute is simply
 * omitted (the widget reads it defensively) rather than emitting an empty value.
 */
function componentName(relPath: string): string | null {
  const base = relPath.split(/[\\/]/).pop() ?? '';
  const name = base.replace(/\.svelte$/i, '');
  return name.length > 0 ? name : null;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}
