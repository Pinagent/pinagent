// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { quickActionsFor } from '../src/quick-actions';

beforeEach(() => {
  document.body.innerHTML = '';
});

function idsFor(html: string, querySelector = ':scope > *'): string[] {
  document.body.innerHTML = html;
  const el = document.body.querySelector(querySelector) as Element;
  return quickActionsFor(el).map((a) => a.id);
}

describe('quickActionsFor', () => {
  it('always includes recolor + resize so the chip row is never empty', () => {
    const html = '<script>noop</script>';
    document.body.innerHTML = html;
    const el = document.body.querySelector('script') as Element;
    const ids = quickActionsFor(el).map((a) => a.id);
    expect(ids).toContain('recolor');
    expect(ids).toContain('resize');
  });

  it('button with text gets change-text + recolor + hover + resize + make-link', () => {
    expect(idsFor('<button>Get started</button>')).toEqual([
      'change-text',
      'recolor',
      'hover-state',
      'resize',
      'make-link',
    ]);
  });

  it('a[href] gets change-link instead of make-link', () => {
    const ids = idsFor('<a href="/x">Read more</a>');
    expect(ids).toContain('change-link');
    expect(ids).not.toContain('make-link');
  });

  it('a without href is not treated as a link — make-link applies', () => {
    const ids = idsFor('<a>Click</a>');
    expect(ids).toContain('make-link');
    expect(ids).not.toContain('change-link');
  });

  it('img gets change-image + alt-text + recolor + resize, NOT change-text', () => {
    expect(idsFor('<img src="x.png">')).toEqual(['change-image', 'alt-text', 'recolor', 'resize']);
  });

  it('img is not eligible for make-link (media is excluded)', () => {
    expect(idsFor('<img src="x.png">')).not.toContain('make-link');
  });

  it('input[placeholder] gets change-placeholder + recolor + hover + resize', () => {
    const ids = idsFor('<input placeholder="Email">');
    expect(ids).toContain('change-placeholder');
    expect(ids).toContain('hover-state');
    expect(ids).not.toContain('make-link');
    expect(ids).not.toContain('change-text');
  });

  it('input without placeholder does NOT get change-placeholder', () => {
    expect(idsFor('<input type="text">')).not.toContain('change-placeholder');
  });

  it('heading with text gets change-text but NOT hover-state (non-interactive)', () => {
    const ids = idsFor('<h1>Welcome</h1>');
    expect(ids).toContain('change-text');
    expect(ids).not.toContain('hover-state');
  });

  it('plain div with no own text content omits change-text', () => {
    // The inner button has text; the outer div does not have *own* text
    // children — its child elements do. "Change text" should target
    // whichever element the user actually picked.
    const ids = idsFor('<div><button>Go</button></div>', 'body > div');
    expect(ids).not.toContain('change-text');
  });

  it('div with direct text gets change-text', () => {
    expect(idsFor('<div>Hello</div>', 'body > div')).toContain('change-text');
  });

  it('elements with role="button" are treated as interactive', () => {
    const ids = idsFor('<div role="button">Tap</div>', 'body > div');
    expect(ids).toContain('hover-state');
  });

  it('chip order matches catalog order (predictable position)', () => {
    // Same set of chips for two buttons, same order both times.
    document.body.innerHTML = '<button>A</button><button>B</button>';
    const a = document.body.children[0] as Element;
    const b = document.body.children[1] as Element;
    const aIds = quickActionsFor(a).map((c) => c.id);
    const bIds = quickActionsFor(b).map((c) => c.id);
    expect(aIds).toEqual(bIds);
    // recolor should sit between change-text and hover-state (catalog order)
    const recolorIdx = aIds.indexOf('recolor');
    const changeTextIdx = aIds.indexOf('change-text');
    const hoverIdx = aIds.indexOf('hover-state');
    expect(changeTextIdx).toBeLessThan(recolorIdx);
    expect(recolorIdx).toBeLessThan(hoverIdx);
  });
});
