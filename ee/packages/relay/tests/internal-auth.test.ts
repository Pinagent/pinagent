// SPDX-License-Identifier: Elastic-2.0

import { bearer, isAuthorizedInternal, timingSafeEqual } from '@pinagent/ee-relay';
import { describe, expect, it } from 'vitest';

describe('bearer', () => {
  it('extracts the token from a Bearer header (case-insensitive, trimmed)', () => {
    expect(bearer('Bearer abc123')).toBe('abc123');
    expect(bearer('bearer   spaced  ')).toBe('spaced');
  });

  it('returns null for missing or non-Bearer headers', () => {
    expect(bearer(null)).toBeNull();
    expect(bearer('Basic abc')).toBeNull();
    expect(bearer('Bearer ')).toBeNull();
  });
});

describe('timingSafeEqual', () => {
  it('is true only for identical strings', () => {
    expect(timingSafeEqual('secret', 'secret')).toBe(true);
    expect(timingSafeEqual('secret', 'secres')).toBe(false);
  });

  it('is false for differing lengths', () => {
    expect(timingSafeEqual('short', 'longer-secret')).toBe(false);
  });
});

describe('isAuthorizedInternal', () => {
  it('authorizes a correct Bearer secret', () => {
    expect(isAuthorizedInternal('Bearer s3cr3t', 's3cr3t')).toBe(true);
  });

  it('rejects a wrong or absent token', () => {
    expect(isAuthorizedInternal('Bearer nope', 's3cr3t')).toBe(false);
    expect(isAuthorizedInternal(null, 's3cr3t')).toBe(false);
    expect(isAuthorizedInternal('s3cr3t', 's3cr3t')).toBe(false); // not a Bearer header
  });

  it('fails closed when no secret is configured', () => {
    expect(isAuthorizedInternal('Bearer anything', undefined)).toBe(false);
    expect(isAuthorizedInternal('Bearer anything', '')).toBe(false);
  });
});
