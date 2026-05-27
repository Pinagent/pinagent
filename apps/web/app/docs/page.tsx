// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ComponentProps, ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// next build's cwd is the package root (apps/web); two up = repo root.
const README = readFileSync(join(process.cwd(), '..', '..', 'README.md'), 'utf8');

export const metadata = {
  title: 'Docs · Pinagent',
  description: 'How to install Pinagent and connect it to your coding agent.',
};

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <nav className="mb-12 text-sm">
        <a href="/" className="text-muted-foreground transition-colors hover:text-foreground">
          ← Pinagent
        </a>
      </nav>
      <article className="space-y-5 text-[15px] leading-relaxed">
        <Markdown remarkPlugins={[remarkGfm]} components={components}>
          {README}
        </Markdown>
      </article>
      <p className="mt-16 border-t border-border pt-8 text-xs text-muted-foreground">
        These docs mirror{' '}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href="https://github.com/Pinagent/pinagent/blob/main/README.md"
        >
          README.md
        </a>{' '}
        on main.
      </p>
    </main>
  );
}

type ElementProps<T extends keyof React.JSX.IntrinsicElements> = ComponentProps<T> & {
  children?: ReactNode;
};

const components: ComponentProps<typeof Markdown>['components'] = {
  h1: ({ children }: ElementProps<'h1'>) => (
    <h1 className="mt-2 text-3xl font-semibold tracking-tight">{children}</h1>
  ),
  h2: ({ children }: ElementProps<'h2'>) => (
    <h2 className="mt-12 border-t border-border pt-8 text-2xl font-semibold tracking-tight">
      {children}
    </h2>
  ),
  h3: ({ children }: ElementProps<'h3'>) => (
    <h3 className="mt-8 text-lg font-semibold tracking-tight">{children}</h3>
  ),
  h4: ({ children }: ElementProps<'h4'>) => <h4 className="mt-6 font-semibold">{children}</h4>,
  p: ({ children }: ElementProps<'p'>) => <p className="text-foreground/90">{children}</p>,
  a: ({ children, href }: ElementProps<'a'>) => (
    <a href={href} className="underline underline-offset-2 transition-colors hover:text-foreground">
      {children}
    </a>
  ),
  ul: ({ children }: ElementProps<'ul'>) => (
    <ul className="list-disc space-y-1 pl-6 text-foreground/90">{children}</ul>
  ),
  ol: ({ children }: ElementProps<'ol'>) => (
    <ol className="list-decimal space-y-1 pl-6 text-foreground/90">{children}</ol>
  ),
  li: ({ children }: ElementProps<'li'>) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }: ElementProps<'strong'>) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }: ElementProps<'em'>) => <em className="italic">{children}</em>,
  blockquote: ({ children }: ElementProps<'blockquote'>) => (
    <blockquote className="border-l-2 border-border pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border" />,
  pre: ({ children }: ElementProps<'pre'>) => (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted p-4 font-mono text-sm leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ children, className }: ElementProps<'code'>) => {
    const isBlock = typeof className === 'string' && className.startsWith('language-');
    if (isBlock) return <code className={className}>{children}</code>;
    return (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>
    );
  },
  table: ({ children }: ElementProps<'table'>) => (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }: ElementProps<'thead'>) => <thead className="bg-muted">{children}</thead>,
  th: ({ children }: ElementProps<'th'>) => (
    <th className="border-b border-border px-4 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }: ElementProps<'td'>) => (
    <td className="border-b border-border px-4 py-2 align-top last:border-b-0">{children}</td>
  ),
};
