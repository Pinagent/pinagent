// SPDX-License-Identifier: Elastic-2.0
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Nav } from '../app/_components/Nav';

describe('Nav', () => {
  it('preserves the org across tab links and encodes it', () => {
    const html = renderToStaticMarkup(Nav({ org: 'org/1', active: 'overview' }));
    expect(html).toContain('href="/?org=org%2F1"');
    expect(html).toContain('href="/billing?org=org%2F1"');
    expect(html).toContain('href="/policy?org=org%2F1"');
    expect(html).toContain('href="/audit?org=org%2F1"');
  });

  it('marks only the active tab with the active class + aria-current', () => {
    const html = renderToStaticMarkup(Nav({ org: 'o', active: 'billing' }));
    // exactly one active link, and it's the billing tab
    expect(html.match(/nav-link-active/g)).toHaveLength(1);
    expect(html).toMatch(/nav-link-active"[^>]*href="\/billing\?org=o"/);
    expect(html).toContain('aria-current="page"');
  });

  it('omits the query string when no org is selected', () => {
    const html = renderToStaticMarkup(Nav({ active: 'overview' }));
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/billing"');
    expect(html).not.toContain('?org=');
  });
});
