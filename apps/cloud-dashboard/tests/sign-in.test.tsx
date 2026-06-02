// SPDX-License-Identifier: Elastic-2.0
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SignIn, ssoStartHref } from '../src/SignIn';

describe('ssoStartHref', () => {
  it('threads returnTo so login comes back to the current page', () => {
    expect(ssoStartHref('/billing?org=acme')).toBe('/sso/start?returnTo=%2Fbilling%3Forg%3Dacme');
  });

  it('adds the email (trimmed) for connection discovery when given', () => {
    expect(ssoStartHref('/', '  alice@acme.com ')).toBe(
      '/sso/start?returnTo=%2F&email=alice%40acme.com',
    );
  });

  it('omits an empty / whitespace-only email', () => {
    expect(ssoStartHref('/', '   ')).toBe('/sso/start?returnTo=%2F');
  });

  it('is a bare path when neither is provided', () => {
    expect(ssoStartHref('')).toBe('/sso/start');
  });
});

describe('SignIn', () => {
  it('renders the SSO button and the optional email field', () => {
    const html = renderToStaticMarkup(<SignIn />);
    expect(html).toContain('Sign in with SSO');
    expect(html).toContain('Work email');
  });
});
