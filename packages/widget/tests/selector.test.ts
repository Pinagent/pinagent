// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  breadcrumbTags,
  describeElementLabel,
  findLoc,
  findReanchorTarget,
  shortSelector,
} from '../src/selector';

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
    document.body.innerHTML = '<ul><li>a</li><li>b</li><li>c</li></ul>';
    const items = document.querySelectorAll('li');
    expect(shortSelector(items[0]!)).toBe('body > ul > li:nth-of-type(1)');
    expect(shortSelector(items[1]!)).toBe('body > ul > li:nth-of-type(2)');
    expect(shortSelector(items[2]!)).toBe('body > ul > li:nth-of-type(3)');
  });

  it('omits :nth-of-type when there is only one same-tag sibling', () => {
    document.body.innerHTML = '<div><span>a</span><p>b</p><span>c</span></div>';
    const p = document.querySelector('p') as Element;
    expect(shortSelector(p)).toBe('body > div > p');
  });

  it('stops at body and includes it as a sentinel', () => {
    document.body.innerHTML = '<div><span>x</span></div>';
    const span = document.querySelector('span') as Element;
    expect(shortSelector(span).startsWith('body')).toBe(true);
  });

  it('honours maxDepth (truncates the upward walk)', () => {
    document.body.innerHTML = '<a><b><c><d><e>leaf</e></d></c></b></a>';
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
    document.body.innerHTML = '<div data-pa-loc="src/Foo.tsx:42:7"><span>x</span></div>';
    const div = document.querySelector('div') as Element;
    expect(findLoc(div)).toEqual({ file: 'src/Foo.tsx', line: 42, col: 7 });
  });

  it('walks up to find the nearest ancestor with the attribute', () => {
    document.body.innerHTML =
      '<div data-pa-loc="src/A.tsx:1:1"><section><p>deep</p></section></div>';
    const p = document.querySelector('p') as Element;
    expect(findLoc(p)).toEqual({ file: 'src/A.tsx', line: 1, col: 1 });
  });

  it('returns null when no ancestor has the attribute', () => {
    document.body.innerHTML = '<div><span>x</span></div>';
    const span = document.querySelector('span') as Element;
    expect(findLoc(span)).toBeNull();
  });

  it('handles file paths that contain colons (Windows-style or routes)', () => {
    document.body.innerHTML = '<div data-pa-loc="C:/proj/Foo.tsx:10:3"></div>';
    const div = document.querySelector('div') as Element;
    // file is everything before the last two colon-segments.
    expect(findLoc(div)).toEqual({ file: 'C:/proj/Foo.tsx', line: 10, col: 3 });
  });

  it('returns null for malformed attribute (non-numeric line/col)', () => {
    document.body.innerHTML = '<div data-pa-loc="src/Foo.tsx:abc:def"></div>';
    const div = document.querySelector('div') as Element;
    expect(findLoc(div)).toBeNull();
  });

  it('returns null for too-few-parts attribute', () => {
    document.body.innerHTML = '<div data-pa-loc="just-a-string"></div>';
    const div = document.querySelector('div') as Element;
    expect(findLoc(div)).toBeNull();
  });

  it('prefers the nearest ancestor over a more distant one', () => {
    document.body.innerHTML =
      '<div data-pa-loc="far.tsx:1:1"><div data-pa-loc="near.tsx:2:2"><span>x</span></div></div>';
    const span = document.querySelector('span') as Element;
    expect(findLoc(span)).toEqual({ file: 'near.tsx', line: 2, col: 2 });
  });
});

describe('breadcrumbTags', () => {
  it('returns ancestors from outermost to the picked element', () => {
    document.body.innerHTML = '<div><section><button>x</button></section></div>';
    const button = document.querySelector('button') as Element;
    // Default maxDepth=4 from <button> walks: button → section → div → body.
    expect(breadcrumbTags(button)).toEqual(['body', 'div', 'section', 'button']);
  });

  it('lowercases tag names', () => {
    document.body.innerHTML = '<DIV><BUTTON>x</BUTTON></DIV>';
    const button = document.querySelector('button') as Element;
    expect(breadcrumbTags(button)).toEqual(['body', 'div', 'button']);
  });

  it('honours maxDepth (caps the upward walk)', () => {
    document.body.innerHTML = '<a><b><c><d><e>leaf</e></d></c></b></a>';
    const leaf = document.querySelector('e') as Element;
    expect(breadcrumbTags(leaf, 2)).toEqual(['d', 'e']);
  });

  it('stops at body when reached inside maxDepth', () => {
    document.body.innerHTML = '<div><span>x</span></div>';
    const span = document.querySelector('span') as Element;
    const chain = breadcrumbTags(span);
    expect(chain[0]).toBe('body');
    expect(chain[chain.length - 1]).toBe('span');
  });
});

describe('describeElementLabel', () => {
  it('prefers aria-label over inner text', () => {
    document.body.innerHTML = '<button aria-label="Dismiss">×</button>';
    const button = document.querySelector('button') as Element;
    expect(describeElementLabel(button)).toBe('Dismiss');
  });

  it('falls back to inner text when no aria-label', () => {
    document.body.innerHTML = '<button>Get started</button>';
    const button = document.querySelector('button') as Element;
    expect(describeElementLabel(button)).toBe('Get started');
  });

  it('collapses internal whitespace in inner text', () => {
    document.body.innerHTML = '<button>  Get   started  \n  now  </button>';
    const button = document.querySelector('button') as Element;
    expect(describeElementLabel(button)).toBe('Get started now');
  });

  it('returns alt for <img> when there is no other label', () => {
    document.body.innerHTML = '<img alt="Logo" src="x.png">';
    const img = document.querySelector('img') as Element;
    expect(describeElementLabel(img)).toBe('Logo');
  });

  it('returns title when nothing else applies', () => {
    document.body.innerHTML = '<div title="The hero"></div>';
    const div = document.querySelector('div') as Element;
    expect(describeElementLabel(div)).toBe('The hero');
  });

  it('returns null when no label source applies', () => {
    document.body.innerHTML = '<div></div>';
    const div = document.querySelector('div') as Element;
    expect(describeElementLabel(div)).toBeNull();
  });

  it('truncates long labels with an ellipsis', () => {
    document.body.innerHTML = `<button>${'a'.repeat(60)}</button>`;
    const button = document.querySelector('button') as Element;
    const label = describeElementLabel(button, 20);
    expect(label?.length).toBe(20);
    expect(label?.endsWith('…')).toBe(true);
  });
});

describe('findReanchorTarget', () => {
  it('returns the element matching data-pa-loc', () => {
    document.body.innerHTML = '<section><button data-pa-loc="App.tsx:10:5">Go</button></section>';
    const found = findReanchorTarget('App.tsx:10:5', 'body > section > button');
    expect(found?.tagName).toBe('BUTTON');
  });

  it('falls back to the selector when data-pa-loc is null', () => {
    document.body.innerHTML = '<section><button>Go</button></section>';
    const found = findReanchorTarget(null, 'body > section > button');
    expect(found?.tagName).toBe('BUTTON');
  });

  it('falls back to the selector when data-pa-loc no longer matches', () => {
    document.body.innerHTML = '<section><button>Go</button></section>';
    const found = findReanchorTarget('App.tsx:10:5', 'body > section > button');
    expect(found?.tagName).toBe('BUTTON');
  });

  it('returns null when neither lookup matches', () => {
    document.body.innerHTML = '<div>x</div>';
    expect(findReanchorTarget('App.tsx:10:5', 'body > button')).toBeNull();
  });

  it('handles selectors that throw without crashing', () => {
    document.body.innerHTML = '<button>x</button>';
    expect(findReanchorTarget(null, 'body >')).toBeNull();
  });

  it('handles quote chars in data-pa-loc without crashing the lookup', () => {
    // Synthetic — Babel never emits paths with quote chars in practice.
    // The iteration-based implementation sidesteps CSS-attribute-selector
    // escaping pitfalls (a real concern because happy-dom and Chromium
    // disagree on `\"` handling in attribute selectors).
    document.body.innerHTML = "<button data-pa-loc='weird\".tsx:1:1'>x</button>";
    const found = findReanchorTarget('weird".tsx:1:1', 'body > button');
    expect(found?.tagName).toBe('BUTTON');
  });

  it('returns the data-pa-loc match even if the selector would also work', () => {
    document.body.innerHTML =
      '<button data-pa-loc="A.tsx:1:1" id="first">A</button>' +
      '<button data-pa-loc="B.tsx:2:2" id="second">B</button>';
    const found = findReanchorTarget('B.tsx:2:2', 'body > button');
    expect((found as HTMLElement | null)?.id).toBe('second');
  });
});
