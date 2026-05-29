// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { transformVue } from '../src/transform';

const RELPATH = 'src/Foo.vue';

function transform(code: string): string | null {
  return transformVue(code, { relPath: RELPATH });
}

/** Inserted attribute shape: `<relPath>:<line>:<col>`, 1-indexed line+col. */
const tagPattern = new RegExp(`data-pa-loc="${RELPATH}:\\d+:\\d+"`);

const sfc = (template: string, script = `<script setup lang="ts"></script>\n\n`) =>
  `${script}<template>\n${template}\n</template>\n`;

describe('transformVue', () => {
  it('returns null for an SFC with no template block', () => {
    expect(transform(`<script setup lang="ts">const x = 1;</script>`)).toBeNull();
  });

  it('returns null for a template with no taggable elements', () => {
    // Interpolation only — no element to anchor to.
    expect(transform(sfc(`{{ msg }}`))).toBeNull();
  });

  it('tags a single native element', () => {
    const out = transform(sfc(`  <div>hi</div>`));
    expect(out).not.toBeNull();
    expect(out).toMatch(tagPattern);
    expect(out).toContain('<div data-pa-loc=');
  });

  it('tags an element with existing attributes, preserving them', () => {
    const out = transform(sfc(`  <button class="cta" @click="go">Go</button>`));
    expect(out).toMatch(tagPattern);
    expect(out).toContain('class="cta"');
    expect(out).toContain('@click="go"');
    // Attribute is spliced right after the tag name, before existing props.
    expect(out).toContain('<button data-pa-loc=');
  });

  it('tags nested elements', () => {
    const out = transform(sfc(`  <div>\n    <span>hi</span>\n  </div>`));
    expect(out).not.toBeNull();
    const matches = out!.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('tags components (fallthrough attrs land on the root DOM node)', () => {
    const out = transform(sfc(`  <MyWidget :value="n" />`));
    expect(out).not.toBeNull();
    expect(out).toContain('<MyWidget data-pa-loc=');
  });

  it('does not tag <template> or <slot> compiler constructs', () => {
    const out = transform(sfc(`  <template v-if="ok"><span>a</span></template>`));
    expect(out).not.toBeNull();
    // Only the <span> gets tagged, not the wrapping <template>.
    const matches = out!.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(1);
    expect(out).toContain('<span data-pa-loc=');
  });

  it('tags both branches of a v-if / v-else', () => {
    const out = transform(sfc(`  <p v-if="ok">yes</p>\n  <p v-else>no</p>`));
    expect(out).not.toBeNull();
    const matches = out!.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('tags the element body of a v-for', () => {
    const out = transform(sfc(`  <li v-for="i in items" :key="i">{{ i }}</li>`));
    expect(out).not.toBeNull();
    expect(out).toContain('<li data-pa-loc=');
  });

  it('is idempotent — running twice does not double-tag', () => {
    const once = transform(sfc(`  <div>hi</div>`));
    expect(once).not.toBeNull();
    const twice = transform(once!);
    expect(twice).toBeNull();
  });

  it('embeds file-relative line and column pointing at the `<`', () => {
    // Script block is 1 line + 1 blank line; `<template>` is line 3;
    // the `<div>` sits on line 4 indented by two spaces (col 3).
    const out = transform(sfc(`  <div>hi</div>`));
    expect(out).toContain(`data-pa-loc="${RELPATH}:4:3"`);
  });

  it('tags the enclosing component name (data-pa-comp) from the SFC filename', () => {
    // src/Foo.vue → Foo. Mirrors the babel plugin's data-pa-comp.
    const out = transformVue(sfc(`  <div>hi</div>`), { relPath: 'src/cards/PriceCard.vue' });
    expect(out).toContain('data-pa-comp="PriceCard"');
  });

  it('gives every v-for instance the same component name (loop disambiguation)', () => {
    const out = transform(sfc(`  <li v-for="i in items" :key="i">{{ i }}</li>`));
    expect(out).toContain('data-pa-comp="Foo"');
  });
});
