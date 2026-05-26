// SPDX-License-Identifier: Apache-2.0
import { Card } from '@pinagent/ui/components/ui/card';

const posts = [
  {
    slug: 'parallel-agents',
    title: 'Parallel agents, isolated worktrees',
    date: '2026-05-18',
    excerpt:
      'How we let multiple Pinagent comments run as parallel Claude Agent SDK loops, each in its own git worktree, so concurrent edits never collide.',
  },
  {
    slug: 'click-to-fix',
    title: 'From click to fix in under a minute',
    date: '2026-05-02',
    excerpt:
      'A walkthrough of the Pinagent loop: click a UI element, leave a comment, watch the agent edit the exact JSX node you pointed at.',
  },
  {
    slug: 'why-pinagent',
    title: 'Why we built Pinagent',
    date: '2026-04-15',
    excerpt:
      'The gap between "I see the bug" and "the agent has the right context" was the slowest part of our day. So we closed it.',
  },
];

export default function BlogPage() {
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1 className="text-4xl font-semibold tracking-tight">Blog</h1>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        Notes from the Pinagent team on building click-to-fix dev tools.
      </p>

      <section className="mt-8 flex flex-col gap-6">
        {posts.map((post) => (
          <Card key={post.slug} className="p-5">
            <header className="flex flex-wrap items-baseline gap-3">
              <h2 className="m-0 text-xl font-semibold">
                <a
                  href={`/blog/${post.slug}`}
                  className="text-foreground no-underline hover:underline"
                >
                  {post.title}
                </a>
              </h2>
              <time className="text-sm text-muted-foreground">{post.date}</time>
            </header>
            <p className="mt-3 mb-0 leading-relaxed">{post.excerpt}</p>
          </Card>
        ))}
      </section>
    </main>
  );
}
