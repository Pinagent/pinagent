// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { transformSvelte } from '../src/transform';

const RELPATH = 'src/Foo.svelte';

function transform(code: string): string | null {
  return transformSvelte(code, { relPath: RELPATH });
}

/** Inserted attribute shape: `<relPath>:<line>:<col>`, 1-indexed line+col. */
const tagPattern = new RegExp(`data-pa-loc="${RELPATH}:\\d+:\\d+"`);

describe('transformSvelte', () => {
  it('returns null for a component with no elements', () => {
    expect(transform('<script>const x = 1;</script>')).toBeNull();
  });

  it('returns null for unparseable markup (does not throw)', () => {
    // Unterminated block — the compiler throws; we bail with null rather than
    // crashing the build. (The parser is lenient about unclosed *tags*, but an
    // unclosed `{#if}` block is a hard parse error.)
    expect(transform('{#if x}\n  <p>hi</p>')).toBeNull();
  });

  it('tags a single native element', () => {
    const out = transform('<div>hi</div>');
    expect(out).not.toBeNull();
    expect(out).toMatch(tagPattern);
    expect(out).toContain('<div data-pa-loc=');
  });

  it('tags an element with existing attributes, preserving them', () => {
    const out = transform('<button class="cta" on:click={go}>Go</button>');
    expect(out).toMatch(tagPattern);
    expect(out).toContain('class="cta"');
    expect(out).toContain('on:click={go}');
    // Attribute is spliced right after the tag name, before existing props.
    expect(out).toContain('<button data-pa-loc=');
  });

  it('tags nested elements', () => {
    const out = transform('<div>\n  <span>hi</span>\n</div>');
    expect(out).not.toBeNull();
    const matches = out?.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('tags components (PascalCase)', () => {
    const out = transform('<MyWidget value={n} />');
    expect(out).not.toBeNull();
    expect(out).toContain('<MyWidget data-pa-loc=');
  });

  it('does not tag <slot>', () => {
    const out = transform('<div><slot /></div>');
    expect(out).not.toBeNull();
    // Only the <div> is tagged, not the <slot>.
    const matches = out?.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(1);
    expect(out).toContain('<div data-pa-loc=');
    expect(out).not.toContain('<slot data-pa-loc=');
  });

  it('tags both branches of an {#if}/{:else}', () => {
    const out = transform('{#if ok}\n  <p>yes</p>\n{:else}\n  <p>no</p>\n{/if}');
    expect(out).not.toBeNull();
    const matches = out?.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('tags the element body of an {#each}', () => {
    const out = transform('{#each items as i}\n  <li>{i}</li>\n{/each}');
    expect(out).not.toBeNull();
    expect(out).toContain('<li data-pa-loc=');
  });

  it('tags elements inside {#await} branches', () => {
    const out = transform(
      '{#await p}\n  <span>loading</span>\n{:then v}\n  <b>{v}</b>\n{:catch e}\n  <i>{e}</i>\n{/await}',
    );
    expect(out).not.toBeNull();
    const matches = out?.match(/data-pa-loc=/g) ?? [];
    expect(matches.length).toBe(3);
  });

  it('is idempotent — running twice does not double-tag', () => {
    const once = transform('<div>hi</div>');
    expect(once).not.toBeNull();
    const twice = transformSvelte(once as string, { relPath: RELPATH });
    expect(twice).toBeNull();
  });

  it('embeds file-relative line and column pointing at the `<`', () => {
    // `<script>` + blank line, then `<div>` on line 3 indented two spaces (col 3).
    const out = transform('<script>let x = 1;</script>\n\n  <div>hi</div>');
    expect(out).toContain(`data-pa-loc="${RELPATH}:3:3"`);
  });

  it('tags the enclosing component name (data-pa-comp) from the filename', () => {
    const out = transformSvelte('<div>hi</div>', { relPath: 'src/cards/PriceCard.svelte' });
    expect(out).toContain('data-pa-comp="PriceCard"');
  });

  it('gives every {#each} instance the same component name (loop disambiguation)', () => {
    const out = transform('{#each items as i}\n  <li>{i}</li>\n{/each}');
    expect(out).toContain('data-pa-comp="Foo"');
  });
});
