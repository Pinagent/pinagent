// SPDX-License-Identifier: Apache-2.0
/**
 * Tiny, dependency-free Markdown parser for the RN widget.
 *
 * The agent streams its replies as Markdown — Claude writes **bold**, `code`,
 * fenced blocks, bullet/numbered lists, headings and links. The StreamSheet
 * used to drop that straight into a <Text>, so the markers showed up as
 * literal characters. This module folds the raw text into a small block/inline
 * tree that `Markdown.tsx` renders with React Native primitives — no
 * markdown-it, no extra runtime dependency, in keeping with the rest of the
 * native source (see transcript.ts for the same "mirror, don't import" stance).
 *
 * It is intentionally a *subset* of CommonMark covering what shows up in chat:
 * ATX headings, fenced code, blockquotes, unordered/ordered lists, thematic
 * breaks, paragraphs, and inline code / bold / italic / links. Anything it
 * doesn't recognise falls through as plain text, so the worst case degrades to
 * the old behaviour rather than dropping content. Pure and deterministic, so
 * it's unit-tested like the transcript reducer.
 */

/** An inline run carrying at most the marks we render. */
export interface InlineSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** Present on link spans; the destination URL. */
  href?: string;
}

export type MdBlock =
  | { type: 'heading'; level: number; spans: InlineSpan[] }
  | { type: 'paragraph'; spans: InlineSpan[] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'list'; ordered: boolean; items: InlineSpan[][] }
  | { type: 'quote'; spans: InlineSpan[] }
  | { type: 'hr' };

/**
 * Inline scanner: walk the string and, at each step, take the earliest of the
 * recognised markers — ties broken by priority (code > link > bold > italic),
 * so `**x**` reads as one bold run rather than two italics, and a backtick span
 * is never re-parsed for emphasis. Text between markers is emitted verbatim;
 * an unbalanced marker (a lone `*`) never matches and stays literal, so we
 * never swallow content.
 */
export function parseInline(input: string): InlineSpan[] {
  const matchers: Array<{ re: RegExp; make: (m: RegExpExecArray) => InlineSpan }> = [
    { re: /`([^`]+)`/, make: (m) => ({ text: m[1] ?? '', code: true }) },
    { re: /\[([^\]]+)\]\(([^)\s]+)\)/, make: (m) => ({ text: m[1] ?? '', href: m[2] ?? '' }) },
    { re: /\*\*([^*]+)\*\*/, make: (m) => ({ text: m[1] ?? '', bold: true }) },
    { re: /__([^_]+)__/, make: (m) => ({ text: m[1] ?? '', bold: true }) },
    { re: /\*([^*]+)\*/, make: (m) => ({ text: m[1] ?? '', italic: true }) },
    { re: /_([^_]+)_/, make: (m) => ({ text: m[1] ?? '', italic: true }) },
  ];

  const spans: InlineSpan[] = [];
  let rest = input;
  while (rest.length > 0) {
    let best: { index: number; length: number; span: InlineSpan } | null = null;
    for (const { re, make } of matchers) {
      const m = re.exec(rest);
      // Strictly-less keeps the higher-priority matcher on an index tie.
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: (m[0] ?? '').length, span: make(m) };
      }
    }
    if (best === null) {
      pushText(spans, rest);
      break;
    }
    pushText(spans, rest.slice(0, best.index));
    spans.push(best.span);
    rest = rest.slice(best.index + best.length);
  }
  return spans;
}

function pushText(spans: InlineSpan[], text: string): void {
  if (text) spans.push({ text });
}

/**
 * Fold raw Markdown into render-ready blocks. Line-oriented and greedy:
 * consecutive list items fold into one list, consecutive `>` lines into one
 * quote, and consecutive plain lines into one paragraph (soft-wrapped lines are
 * joined with a space). Blank lines separate paragraphs. Pure and
 * deterministic.
 */
export function parseMarkdown(source: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  function flushParagraph(): void {
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) blocks.push({ type: 'paragraph', spans: parseInline(text) });
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Fenced code block: ``` or ```lang … until a closing ``` (or EOF).
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      flushParagraph();
      const lang = (fence[1] ?? '').trim();
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i] ?? '';
        if (/^\s*```\s*$/.test(l)) break;
        body.push(l);
        i++;
      }
      i++; // consume the closing fence (no-op at EOF)
      blocks.push({ type: 'code', text: body.join('\n'), ...(lang ? { lang } : {}) });
      continue;
    }

    // Blank line: end the current paragraph.
    if (/^\s*$/.test(line)) {
      flushParagraph();
      i++;
      continue;
    }

    // Thematic break: a line of 3+ identical -, * or _.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flushParagraph();
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // ATX heading (#–######), trailing #'s stripped.
    const heading = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: (heading[1] ?? '').length,
        spans: parseInline(heading[2] ?? ''),
      });
      i++;
      continue;
    }

    // Blockquote: fold consecutive `>` lines together.
    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length) {
        const l = lines[i] ?? '';
        if (!/^\s*>/.test(l)) break;
        quoted.push(l.replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', spans: parseInline(quoted.join(' ').trim()) });
      continue;
    }

    // List: fold consecutive items of the same kind (ordered vs unordered).
    const first = matchListItem(line);
    if (first) {
      flushParagraph();
      const items: InlineSpan[][] = [];
      while (i < lines.length) {
        const it = matchListItem(lines[i] ?? '');
        if (!it || it.ordered !== first.ordered) break;
        items.push(parseInline(it.text));
        i++;
      }
      blocks.push({ type: 'list', ordered: first.ordered, items });
      continue;
    }

    // Otherwise accumulate into the running paragraph.
    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  return blocks;
}

function matchListItem(line: string): { ordered: boolean; text: string } | null {
  const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
  if (ul) return { ordered: false, text: ul[1] ?? '' };
  const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
  if (ol) return { ordered: true, text: ol[1] ?? '' };
  return null;
}
