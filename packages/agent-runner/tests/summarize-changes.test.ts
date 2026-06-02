// SPDX-License-Identifier: Apache-2.0
/**
 * Pins `parsePrSummary` — the title/body extraction that turns the
 * summarizer agent's text into a PR. Pure; no SDK call.
 */
import { describe, expect, it } from 'vitest';
import { parsePrSummary } from '../src/summarize-changes';

describe('parsePrSummary', () => {
  it('parses a clean JSON object', () => {
    const out = parsePrSummary('{"title":"Add pricing tiers","body":"## Changes\\n- adds tiers"}');
    expect(out.title).toBe('Add pricing tiers');
    expect(out.body).toContain('## Changes');
  });

  it('extracts JSON embedded in surrounding prose / code fences', () => {
    const text =
      'Here you go:\n```json\n{ "title": "Fix nav", "body": "Fixes the mobile nav." }\n```';
    const out = parsePrSummary(text);
    expect(out.title).toBe('Fix nav');
    expect(out.body).toBe('Fixes the mobile nav.');
  });

  it('falls back to first-line title / rest body for non-JSON output', () => {
    const out = parsePrSummary('Refactor pricing\n\nMoved the pricing logic into a helper.');
    expect(out.title).toBe('Refactor pricing');
    expect(out.body).toContain('Moved the pricing logic');
  });

  it('strips a leading markdown heading from the fallback title', () => {
    const out = parsePrSummary('# My Title\nbody text');
    expect(out.title).toBe('My Title');
  });

  it('defaults the title when text is empty-ish', () => {
    const out = parsePrSummary('   ');
    expect(out.title).toBe('Update');
  });

  it('uses the title as the body when JSON omits the body', () => {
    const out = parsePrSummary('{"title":"Only a title"}');
    expect(out.title).toBe('Only a title');
    expect(out.body).toBe('Only a title');
  });
});
