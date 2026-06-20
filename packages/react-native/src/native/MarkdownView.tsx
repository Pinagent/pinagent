// SPDX-License-Identifier: Apache-2.0
/**
 * Render agent Markdown with React Native primitives.
 *
 * `parseMarkdown` (markdown.ts) does the parsing; this maps its block/inline
 * tree onto <View>/<Text>. Inline marks ride as nested <Text> inside the
 * paragraph's <Text>, which inherits the caller's `baseStyle` (the sheet's text
 * row), so plain prose keeps its existing look and only the marked-up runs pick
 * up bold/italic/code/link styling. Like the rest of `src/native`, it leans on
 * RN core only — no markdown renderer dependency — so it ships as source and
 * Metro bundles it onto the device unchanged.
 *
 * The file is `MarkdownView` (not `Markdown`) so it doesn't collide with
 * `markdown.ts` on case-insensitive filesystems — tsc treats the two as the
 * same module otherwise.
 */
import type { ReactElement } from 'react';
import type { StyleProp } from 'react-native';
import { Linking, Platform, StyleSheet, Text, type TextStyle, View } from 'react-native';
import { type InlineSpan, type MdBlock, parseMarkdown } from './markdown';

export interface MarkdownViewProps {
  text: string;
  /** Base text style for paragraphs/inline runs (the sheet's text row). */
  baseStyle?: StyleProp<TextStyle>;
}

export function MarkdownView({ text, baseStyle }: MarkdownViewProps): ReactElement {
  const blocks = parseMarkdown(text);
  return (
    <View style={styles.root}>
      {blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: blocks are re-derived from `text` every render, append-only and never reordered
        <Block key={i} block={block} baseStyle={baseStyle} />
      ))}
    </View>
  );
}

function Block({
  block,
  baseStyle,
}: {
  block: MdBlock;
  baseStyle?: StyleProp<TextStyle>;
}): ReactElement {
  switch (block.type) {
    case 'heading':
      return (
        <Text style={[baseStyle, styles.heading, HEADING_SIZE[block.level - 1]]}>
          <Spans spans={block.spans} />
        </Text>
      );
    case 'code':
      return (
        <View style={styles.codeBlock}>
          <Text style={styles.codeText}>{block.text}</Text>
        </View>
      );
    case 'list':
      return (
        <View style={styles.list}>
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items are re-derived from `text` every render, append-only and never reordered
            <View key={i} style={styles.listItem}>
              <Text style={baseStyle}>{block.ordered ? `${i + 1}.` : '•'}</Text>
              <Text style={[baseStyle, styles.listText]}>
                <Spans spans={item} />
              </Text>
            </View>
          ))}
        </View>
      );
    case 'quote':
      return (
        <View style={styles.quote}>
          <Text style={[baseStyle, styles.quoteText]}>
            <Spans spans={block.spans} />
          </Text>
        </View>
      );
    case 'hr':
      return <View style={styles.hr} />;
    default:
      return (
        <Text style={baseStyle}>
          <Spans spans={block.spans} />
        </Text>
      );
  }
}

function Spans({ spans }: { spans: InlineSpan[] }): ReactElement {
  return (
    <>
      {spans.map((span, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: spans are re-derived from `text` every render, append-only and never reordered
        <Span key={i} span={span} />
      ))}
    </>
  );
}

function Span({ span }: { span: InlineSpan }): ReactElement {
  if (span.href) {
    const href = span.href;
    return (
      <Text style={styles.link} onPress={() => openUrl(href)}>
        {span.text}
      </Text>
    );
  }
  const style: TextStyle[] = [];
  if (span.bold) style.push(styles.bold);
  if (span.italic) style.push(styles.italic);
  if (span.code) style.push(styles.code);
  // No marks: a bare <Text> inherits the enclosing paragraph's style.
  return style.length ? <Text style={style}>{span.text}</Text> : <Text>{span.text}</Text>;
}

function openUrl(href: string): void {
  // Dev widget: opening a tapped link is best-effort. Linking.openURL rejects
  // on unsupported schemes / no handler — swallow it rather than throw.
  void Linking.openURL(href).catch(() => {});
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

/** Heading font sizes by level (index = level - 1). */
const HEADING_SIZE: TextStyle[] = [
  { fontSize: 20 },
  { fontSize: 18 },
  { fontSize: 16 },
  { fontSize: 15 },
  { fontSize: 14 },
  { fontSize: 13 },
];

const styles = StyleSheet.create({
  root: { gap: 6 },
  heading: { fontWeight: '700', color: '#111827' },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  code: { fontFamily: MONO, fontSize: 13, backgroundColor: '#f3f4f6', color: '#b91c1c' },
  codeBlock: { backgroundColor: '#f6f8fa', borderRadius: 8, padding: 10 },
  codeText: { fontFamily: MONO, fontSize: 13, color: '#1f2937', lineHeight: 18 },
  link: { color: '#2563eb', textDecorationLine: 'underline' },
  list: { gap: 4 },
  listItem: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  listText: { flex: 1 },
  quote: { borderLeftWidth: 3, borderLeftColor: '#d1d5db', paddingLeft: 10 },
  quoteText: { color: '#4b5563', fontStyle: 'italic' },
  hr: { height: 1, backgroundColor: '#e5e7eb', marginVertical: 4 },
});
