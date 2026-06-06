// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { composerHTML } from '../src/composer-html';
import type { ComposerMeta } from '../src/types';

const BASE_META: ComposerMeta = {
  tag: 'button',
  label: 'Add to cart',
  loc: { file: 'src/components/PriceCard.tsx', line: 42, col: 7 },
  component: 'PriceCard',
  breadcrumbs: ['main', 'section', 'div', 'button'],
  extraCount: 0,
  extras: [],
};

function breadcrumbItems(meta: ComposerMeta): HTMLElement[] {
  const doc = new DOMParser().parseFromString(composerHTML(meta), 'text/html');
  return Array.from(doc.querySelectorAll<HTMLElement>('.hdr-bc .bc-item'));
}

describe('composerHTML breadcrumb data-bc-up', () => {
  it('stamps each crumb with its parentElement distance from the picked element', () => {
    const items = breadcrumbItems(BASE_META);
    // The wiring maps `data-bc-up` to `parentElement` hops; the last crumb is
    // the picked element (0) and each step left is one hop further up.
    expect(items.map((el) => el.dataset.bcUp)).toEqual(['3', '2', '1', '0']);
  });

  it('marks only the last crumb (up=0) as the selected element', () => {
    const items = breadcrumbItems(BASE_META);
    const selected = items.filter((el) => el.classList.contains('bc-selected'));
    expect(selected).toHaveLength(1);
    expect(selected[0]?.dataset.bcUp).toBe('0');
  });

  it('renders at most the last four hops, keeping up=0 on the deepest crumb', () => {
    const items = breadcrumbItems({
      ...BASE_META,
      breadcrumbs: ['html', 'body', 'main', 'section', 'div', 'button'],
    });
    expect(items.map((el) => el.dataset.bcUp)).toEqual(['3', '2', '1', '0']);
  });
});
