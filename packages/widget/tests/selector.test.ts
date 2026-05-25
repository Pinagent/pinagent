// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { findLoc, shortSelector } from '../src/selector';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('shortSelector', () => {
  it('returns tag for a direct body child with no siblings', () => {
    document.body.innerHTML = '<div>x</div>';
    const el = document.body.firstElementChild as Element;
    expect(shortSelector(el)).toBe('body > div');
  });

  it('uses #id when the element has one and stops walking up', () => {
    document.body.innerHTML = '<section><div id="hero"><p>x</p></div></section>';
    const p = document.querySelector('p') as Element;
    expect(shortSelector(p)).toBe('div#hero > p');
  });

  it('adds :nth-of-type when there are multiple same-tag siblings', () => {
    document.body.innerHTML =
      '<ul><li>a</li><li>b</li><li>c</li></ul>';
    const items = document.querySelectorAll('li');
    expect(shortSelector(items[0]!)).toBe('body > ul > li:nth-of-type(1)');
    expect(shortSelector(items[1]!)).toBe('body > ul > li:nth-of-type(2)');
    expect(shortSelector(items[2]!)).toBe('body > ul > li:nth-of-type(3)');
  });

  it('omits :nth-of-type when there is only one same-tag sibling', () => {
    document.body.innerHTML =
      '<div><span>a</span><p>b</p><span>c</span></div>';
    const p = document.querySelector('p') as Element;
    expect(shortSelector(p)).toBe('body > div > p');
  });

  it('stops at body and includes it as a sentinel', () => {
    document.body.innerHTML = '<div><span>x</span></div>';
    const span = document.querySelector('span') as Element;
    expect(shortSelector(span).startsWith('body')).toBe(true);
  });

  it('honours maxDepth (truncates the upward walk)', () => {
    document.body.innerHTML =
      '<a><b><c><d><e>leaf</e></d></c></b></a>';
    const leaf = document.querySelector('e') as Element;
    const sel = shortSelector(leaf, 2);
    // 2 levels walked → at most 2 tag segments before we run out.
    const segments = sel.split(' > ');
    expect(segments.length).toBeLessThanOrEqual(2);
  });

  it('CSS.escapes weird ids', () => {
    document.body.innerHTML = '<div id="has space"><p>x</p></div>';
    const p = document.querySelector('p') as Element;
    // CSS.escape turns ' ' into '\ '
    expect(shortSelector(p)).toContain('#has\\ space');
  });
});

describe('findLoc', () => {
  it('returns parsed loc from the element itself', () => {
    document.body.innerHTML = '<div data-pp-loc="src/Foo.tsx:42:7"><span>x</span></div>';
    const div = document.querySelector('div') as Element;
    expect(findLoc(div)).toEqual({ file: 'src/Foo.tsx', line: 42, col: 7 });
  });

  it('walks up to find the nearest ancestor with the attribute', () => {
    document.body.innerHTML =
      '<div data-pp-loc="src/A.tsx:1:1"><section><p>deep</p></section></div>';
    const p = document.querySelector('p') as Element;
    expect(findLoc(p)).toEqual({ file: 'src/A.tsx', line: 1, col: 1 });
  });

  it('returns null when no ancestor has the attribute', () => {
    document.body.innerHTML = '<div><span>x</span></div>';
    const span = document.querySelector('span') as Element;
    expect(findLoc(span)).toBeNull();
  });

  it('handles file paths that contain colons (Windows-style or routes)', () => {
    document.body.innerHTML = '<div data-pp-loc="C:/proj/Foo.tsx:10:3"></div>';
    const div = document.querySelector('div') as Element;
    // file is everything before the last two colon-segments.
    expect(findLoc(div)).toEqual({ file: 'C:/proj/Foo.tsx', line: 10, col: 3 });
  });

  it('returns null for malformed attribute (non-numeric line/col)', () => {
    document.body.innerHTML = '<div data-pp-loc="src/Foo.tsx:abc:def"></div>';
    const div = document.querySelector('div') as Element;
    expect(findLoc(div)).toBeNull();
  });

  it('returns null for too-few-parts attribute', () => {
    document.body.innerHTML = '<div data-pp-loc="just-a-string"></div>';
    const div = document.querySelector('div') as Element;
    expect(findLoc(div)).toBeNull();
  });

  it('prefers the nearest ancestor over a more distant one', () => {
    document.body.innerHTML =
      '<div data-pp-loc="far.tsx:1:1"><div data-pp-loc="near.tsx:2:2"><span>x</span></div></div>';
    const span = document.querySelector('span') as Element;
    expect(findLoc(span)).toEqual({ file: 'near.tsx', line: 2, col: 2 });
  });
});
