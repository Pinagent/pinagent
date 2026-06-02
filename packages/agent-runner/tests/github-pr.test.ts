// SPDX-License-Identifier: Apache-2.0
/**
 * Pins the `gh pr create` output parsing used by the PR-open fallback:
 * extracting the PR URL (from gh stdout on success, or stderr on the
 * "already exists" path) and its numeric id (for recording the PR).
 */
import { describe, expect, it } from 'vitest';
import { extractPrUrl, parsePrNumberFromUrl } from '../src/github-pr';

describe('extractPrUrl', () => {
  it('pulls the PR URL from gh success stdout', () => {
    expect(extractPrUrl('https://github.com/Pinagent/pinagent/pull/342\n')).toBe(
      'https://github.com/Pinagent/pinagent/pull/342',
    );
  });

  it('pulls the URL out of the "already exists" error text', () => {
    const stderr =
      'a pull request for branch "feat/x" into branch "main" already exists:\n' +
      'https://github.com/Pinagent/pinagent/pull/12';
    expect(extractPrUrl(stderr)).toBe('https://github.com/Pinagent/pinagent/pull/12');
  });

  it('returns undefined when there is no PR URL', () => {
    expect(extractPrUrl('error: failed to create pull request')).toBeUndefined();
  });
});

describe('parsePrNumberFromUrl', () => {
  it('parses the numeric id', () => {
    expect(parsePrNumberFromUrl('https://github.com/o/r/pull/342')).toBe(342);
  });

  it('returns null for a non-PR URL', () => {
    expect(parsePrNumberFromUrl('https://github.com/o/r/compare/main...feat')).toBeNull();
  });
});
