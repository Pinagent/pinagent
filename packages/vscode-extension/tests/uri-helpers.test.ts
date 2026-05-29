// SPDX-License-Identifier: Apache-2.0
/**
 * `decodePrompt` (base64url → utf8, empty on failure) and `clampPositive`
 * (1-based line/col clamping). These back the `pinagent://open-claude`
 * and `open-file` URI handlers.
 */
import { describe, expect, it } from 'vitest';
import { clampPositive, decodePrompt } from '../src/uri-helpers';

describe('decodePrompt', () => {
  it('decodes base64url(utf8(text)) round-trips', () => {
    const text = 'fix the header\nand the footer — déjà vu';
    const encoded = Buffer.from(text, 'utf8').toString('base64url');
    expect(decodePrompt(encoded)).toBe(text);
  });

  it('returns empty string for null / empty input', () => {
    expect(decodePrompt(null)).toBe('');
    expect(decodePrompt('')).toBe('');
  });

  it('round-trips content with shell metacharacters and newlines intact', () => {
    const text = 'run `rm -rf /tmp/x` && echo "$HOME"';
    expect(decodePrompt(Buffer.from(text, 'utf8').toString('base64url'))).toBe(text);
  });
});

describe('clampPositive', () => {
  it('passes through finite positive integers', () => {
    expect(clampPositive(42, 1)).toBe(42);
    expect(clampPositive(1, 1)).toBe(1);
  });

  it('falls back for zero, negatives, and non-finite values', () => {
    expect(clampPositive(0, 1)).toBe(1);
    expect(clampPositive(-5, 1)).toBe(1);
    expect(clampPositive(Number.NaN, 1)).toBe(1);
    expect(clampPositive(Number.POSITIVE_INFINITY, 1)).toBe(1);
  });

  it('honors a custom fallback', () => {
    expect(clampPositive(Number.NaN, 7)).toBe(7);
  });
});
