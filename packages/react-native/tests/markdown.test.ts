// SPDX-License-Identifier: Apache-2.0
/**
 * Markdown parser for the RN widget (src/native/markdown.ts). The agent streams
 * its replies as Markdown; this pure parser folds the raw text into the
 * block/inline tree `Markdown.tsx` renders with RN primitives. The folding
 * rules are the contract: which markers become spans, how blocks are grouped,
 * and that unrecognised input degrades to plain text rather than vanishing.
 */
import { describe, expect, it } from 'vitest';
import { type MdBlock, parseInline, parseMarkdown } from '../src/native/markdown';

describe('parseInline', () => {
  it('returns a single plain span for unmarked text', () => {
    expect(parseInline('just text')).toEqual([{ text: 'just text' }]);
  });

  it('parses bold with ** and __', () => {
    expect(parseInline('**bold**')).toEqual([{ text: 'bold', bold: true }]);
    expect(parseInline('__bold__')).toEqual([{ text: 'bold', bold: true }]);
  });

  it('parses italic with * and _', () => {
    expect(parseInline('*it*')).toEqual([{ text: 'it', italic: true }]);
    expect(parseInline('_it_')).toEqual([{ text: 'it', italic: true }]);
  });

  it('reads ** as one bold run, not two italics', () => {
    expect(parseInline('**x**')).toEqual([{ text: 'x', bold: true }]);
  });

  it('parses inline code and does not re-parse markers inside it', () => {
    expect(parseInline('`a*b*c`')).toEqual([{ text: 'a*b*c', code: true }]);
  });

  it('parses a link into text + href', () => {
    expect(parseInline('[docs](https://x.dev)')).toEqual([{ text: 'docs', href: 'https://x.dev' }]);
  });

  it('keeps the surrounding text around a marked run', () => {
    expect(parseInline('see `run` now')).toEqual([
      { text: 'see ' },
      { text: 'run', code: true },
      { text: ' now' },
    ]);
  });

  it('handles several marks in one line', () => {
    expect(parseInline('**a** and *b* and `c`')).toEqual([
      { text: 'a', bold: true },
      { text: ' and ' },
      { text: 'b', italic: true },
      { text: ' and ' },
      { text: 'c', code: true },
    ]);
  });

  it('leaves an unbalanced marker as literal text', () => {
    expect(parseInline('5 * 3 = 15')).toEqual([{ text: '5 * 3 = 15' }]);
    expect(parseInline('a `unclosed code')).toEqual([{ text: 'a `unclosed code' }]);
  });
});

describe('parseMarkdown', () => {
  it('parses ATX headings and strips trailing hashes', () => {
    expect(parseMarkdown('# Title')).toEqual<MdBlock[]>([
      { type: 'heading', level: 1, spans: [{ text: 'Title' }] },
    ]);
    expect(parseMarkdown('### Sub ###')).toEqual<MdBlock[]>([
      { type: 'heading', level: 3, spans: [{ text: 'Sub' }] },
    ]);
  });

  it('parses a fenced code block with a language and keeps markers literal', () => {
    expect(parseMarkdown('```ts\nconst x = `**a**`;\n```')).toEqual<MdBlock[]>([
      { type: 'code', text: 'const x = `**a**`;', lang: 'ts' },
    ]);
  });

  it('parses an unclosed fence to end of input', () => {
    expect(parseMarkdown('```\nline1\nline2')).toEqual<MdBlock[]>([
      { type: 'code', text: 'line1\nline2' },
    ]);
  });

  it('folds consecutive bullet lines into one unordered list', () => {
    expect(parseMarkdown('- one\n- two')).toEqual<MdBlock[]>([
      {
        type: 'list',
        ordered: false,
        items: [[{ text: 'one' }], [{ text: 'two' }]],
      },
    ]);
  });

  it('parses an ordered list and parses inline marks inside items', () => {
    expect(parseMarkdown('1. **a**\n2. b')).toEqual<MdBlock[]>([
      {
        type: 'list',
        ordered: true,
        items: [[{ text: 'a', bold: true }], [{ text: 'b' }]],
      },
    ]);
  });

  it('splits ordered and unordered runs into separate lists', () => {
    const blocks = parseMarkdown('- a\n1. b');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: true });
  });

  it('folds consecutive > lines into one quote', () => {
    expect(parseMarkdown('> a\n> b')).toEqual<MdBlock[]>([
      { type: 'quote', spans: [{ text: 'a b' }] },
    ]);
  });

  it('parses a thematic break', () => {
    expect(parseMarkdown('---')).toEqual<MdBlock[]>([{ type: 'hr' }]);
    expect(parseMarkdown('***')).toEqual<MdBlock[]>([{ type: 'hr' }]);
  });

  it('joins soft-wrapped lines into one paragraph and splits on a blank line', () => {
    expect(parseMarkdown('line one\nline two\n\nnext')).toEqual<MdBlock[]>([
      { type: 'paragraph', spans: [{ text: 'line one line two' }] },
      { type: 'paragraph', spans: [{ text: 'next' }] },
    ]);
  });

  it('starts a list right after a paragraph with no blank line', () => {
    const blocks = parseMarkdown('Steps:\n- one\n- two');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'paragraph', spans: [{ text: 'Steps:' }] });
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: false });
  });

  it('normalises CRLF newlines', () => {
    expect(parseMarkdown('# Title\r\n\r\nbody')).toEqual<MdBlock[]>([
      { type: 'heading', level: 1, spans: [{ text: 'Title' }] },
      { type: 'paragraph', spans: [{ text: 'body' }] },
    ]);
  });

  it('returns no blocks for empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n  ')).toEqual([]);
  });
});
