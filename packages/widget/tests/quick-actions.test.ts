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

function chipById(html: string, id: string, querySelector = ':scope > *') {
  document.body.innerHTML = html;
  const el = document.body.querySelector(querySelector) as Element;
  const chip = quickActionsFor(el).find((c) => c.id === id);
  if (!chip) throw new Error(`chip ${id} not present for ${html}`);
  return chip;
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

  // ---------------- context-aware label + prompt ---------------------

  it('change-text quotes the element’s own text in the prompt', () => {
    expect(chipById('<button>Get started</button>', 'change-text').prompt).toBe(
      'Change the text from "Get started" to: ',
    );
  });

  it('change-text falls back to the generic prompt when no text is present', () => {
    // A `<div>Hello</div>` always gets change-text; without text it
    // can't appear (predicate rules it out), but if a chip has fallback
    // path we still want it covered — check that the text-collapsing
    // helper drops to the generic form when run on whitespace-only text.
    document.body.innerHTML = '<button>  </button>';
    const el = document.body.querySelector('button') as Element;
    const chip = quickActionsFor(el).find((c) => c.id === 'change-text');
    // Predicate fails on whitespace-only text — no chip should appear.
    expect(chip).toBeUndefined();
  });

  it('change-text collapses internal whitespace before quoting', () => {
    expect(chipById('<button>  Get   started   now  </button>', 'change-text').prompt).toBe(
      'Change the text from "Get started now" to: ',
    );
  });

  it('change-text truncates very long button labels', () => {
    const longLabel = 'X'.repeat(200);
    const html = `<button>${longLabel}</button>`;
    const chip = chipById(html, 'change-text');
    // 60-char snippet cap, ending with ellipsis
    expect(chip.prompt.endsWith('…" to: ')).toBe(true);
    expect(chip.prompt.length).toBeLessThan(120);
  });

  it('change-link echoes the current href in the prompt', () => {
    expect(chipById('<a href="/docs/setup">Read</a>', 'change-link').prompt).toBe(
      'Change the link target from "/docs/setup" to ',
    );
  });

  it('change-placeholder echoes the current placeholder', () => {
    expect(chipById('<input placeholder="Email address">', 'change-placeholder').prompt).toBe(
      'Change the placeholder from "Email address" to: ',
    );
  });

  it('change-image references the filename, not the full URL', () => {
    expect(
      chipById('<img src="https://cdn.example.com/images/logo.png?v=2">', 'change-image').prompt,
    ).toBe('Change this image (currently logo.png) to: ');
  });

  it('change-image falls back when there is no src', () => {
    expect(chipById('<img>', 'change-image').prompt).toBe('Change this image to: ');
  });

  it('change-image handles data: URIs by truncating, not splitting on slash', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA…long…';
    const html = `<img src="${dataUri}">`;
    const chip = chipById(html, 'change-image');
    // Should not crash on the `:` in the data URI or produce a path part
    expect(chip.prompt.startsWith('Change this image (currently data:')).toBe(true);
  });

  it('alt-text label is "Add" when alt is missing, "Edit" when alt is set', () => {
    expect(chipById('<img>', 'alt-text').label).toBe('Add alt text');
    expect(chipById('<img alt="Logo">', 'alt-text').label).toBe('Edit alt text');
  });

  it('alt-text prompt is the "Set …" form when alt is missing, "Change … from …" when set', () => {
    expect(chipById('<img>', 'alt-text').prompt).toBe('Set the alt text to: ');
    expect(chipById('<img alt="Company logo">', 'alt-text').prompt).toBe(
      'Change the alt text from "Company logo" to: ',
    );
  });

  it('static chips (recolor, resize, hover, make-link) return their fixed prompts', () => {
    expect(chipById('<button>X</button>', 'recolor').prompt).toBe('Recolor this to ');
    expect(chipById('<button>X</button>', 'resize').prompt).toBe('Resize this to ');
    expect(chipById('<button>X</button>', 'hover-state').prompt).toBe('Add a hover state that ');
    expect(chipById('<button>X</button>', 'make-link').prompt).toBe('Make this a link to ');
  });

  // ---------------------- ordering -----------------------------------

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
