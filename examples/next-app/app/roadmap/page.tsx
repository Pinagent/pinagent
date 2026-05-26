// SPDX-License-Identifier: Apache-2.0
import { Card } from '@pinagent/ui/components/ui/card';

const sections = [
  {
    title: 'Now',
    status: 'In progress',
    items: [
      'Persistent storage for feedback events across sessions.',
      'Improved widget positioning for elements near the viewport edge.',
      'Server-side feedback history with searchable archive.',
      'Screenshot capture with element highlighting for every comment.',
      'Streaming agent output rendered inline in the widget pane.',
      'Source mapping from clicked DOM nodes back to JSX file and line.',
      'Multi-comment batching so related feedback resolves together.',
      'Keyboard shortcuts for triggering, navigating, and resolving comments.',
    ],
  },
  {
    title: 'Next',
    status: 'Up next',
    items: [
      'Team workspaces with shared feedback queues.',
      'Inline diff previews before the agent applies changes.',
      'Custom routing rules so comments reach the right agent or reviewer.',
      'Per-comment branch and PR creation with automatic commit attribution.',
      'Threaded conversations so reviewers can iterate on agent responses.',
      'Role-based permissions for comment authors, reviewers, and admins.',
      'Component-level tagging to group feedback by feature or owner.',
      'SSO, SAML, and SCIM for enterprise authentication.',
      'Audit log of every comment, agent action, and resolution.',
      'Slash commands inside comments for quick agent directives.',
    ],
  },
  {
    title: 'Later',
    status: 'Exploring',
    items: [
      'Native integrations for Linear, GitHub Issues, and Slack.',
      'Mobile and tablet widgets for on-device feedback.',
      'Replay mode that ties feedback to a recorded session.',
      'Figma and design-tool integrations for design-versus-built diffs.',
      'End-user feedback mode so customers can leave comments in production.',
      'Voice and video comments transcribed into agent-ready context.',
      'AI-suggested fixes that preview before any code is written.',
      'Cross-browser and responsive viewport testing from a single comment.',
      'Analytics dashboard for resolution time, hotspots, and agent accuracy.',
      'Self-hosted and on-prem deployments for regulated environments.',
      'Plugin SDK for custom widgets, transports, and agent runtimes.',
      'Localization and right-to-left layout support for the widget UI.',
    ],
  },
];

export default function RoadmapPage() {
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1 className="text-4xl font-semibold tracking-tight">Roadmap</h1>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        Planned work and upcoming features for Pinagent.
      </p>

      <section className="mt-8 flex flex-col gap-6">
        {sections.map((section) => (
          <Card key={section.title} className="p-5">
            <header className="flex flex-wrap items-baseline gap-3">
              <h2 className="m-0 text-xl font-semibold">{section.title}</h2>
              <span className="text-sm text-muted-foreground">{section.status}</span>
            </header>
            <ul className="mt-3 list-disc pl-5 leading-relaxed">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>
        ))}
      </section>
    </main>
  );
}
