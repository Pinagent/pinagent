// SPDX-License-Identifier: Apache-2.0
import { Card } from '@pinagent/ui/components/ui/card';

const releases = [
  {
    version: 'v0.4.0 — Multi-widget updates',
    date: '2026-05-20',
    items: [
      'Multiple pinagent widgets can now be open simultaneously without conflicts.',
      'Improved widget positioning when the targeted element is near the viewport edge.',
      'Smoother streaming output in the comment pane.',
    ],
  },
  {
    version: 'v0.3.0 — New agent loops',
    date: '2026-05-10',
    items: [
      'Added parallel per-comment agent loops via the Claude Agent SDK.',
      'Isolated worktrees keep concurrent edits from stepping on each other.',
      'Feedback events now stream into a dedicated MCP channel.',
    ],
  },
  {
    version: 'v0.2.0 — Next.js example',
    date: '2026-04-28',
    items: [
      'Shipped this Next.js App Router demo app.',
      'Wired the Pinagent click-to-comment widget into the layout.',
      'Documented setup steps for new projects.',
    ],
  },
  {
    version: 'v0.1.0 — Initial release',
    date: '2026-04-01',
    items: [
      'First public version of Pinagent.',
      'Click any UI element, leave a comment, and have an agent edit the code.',
    ],
  },
];

export default function ChangelogPage() {
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1 className="text-4xl font-semibold tracking-tight">Changelog</h1>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        Release notes and updates from the Pinagent Next.js demo.
      </p>

      <section className="mt-8 flex flex-col gap-6">
        {releases.map((release) => (
          <Card key={release.version} className="p-5">
            <header className="flex flex-wrap items-baseline gap-3">
              <h2 className="m-0 text-xl font-semibold">{release.version}</h2>
              <time className="text-sm text-muted-foreground">{release.date}</time>
            </header>
            <ul className="mt-3 list-disc pl-5 leading-relaxed">
              {release.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>
        ))}
      </section>
    </main>
  );
}
