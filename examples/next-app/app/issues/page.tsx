// SPDX-License-Identifier: Apache-2.0
import { cn } from '@pinagent/ui/lib/utils';

type Issue = {
  id: string;
  title: string;
  description: string;
  status: 'Open' | 'Triaged' | 'In review' | 'In progress' | 'Fixed';
  priority: 'High' | 'Medium' | 'Low';
  component: string;
  opened: string;
};

const issues: Issue[] = [
  {
    id: 'PIN-112',
    title: 'Widget overlay misaligned on viewport resize',
    description:
      'The comment widget keeps its initial coordinates when the browser is resized, leaving it floating away from the element it was anchored to.',
    status: 'Open',
    priority: 'High',
    component: 'widget',
    opened: '2026-05-22',
  },
  {
    id: 'PIN-111',
    title: 'Persistent storage migration fails on older SQLite',
    description:
      'The new persistent storage migration aborts on SQLite versions below 3.35, blocking dev-server startup for some contributors.',
    status: 'In progress',
    priority: 'High',
    component: 'storage',
    opened: '2026-05-20',
  },
  {
    id: 'PIN-110',
    title: 'Agent stream stalls after long tool output',
    description:
      'When a tool call returns more than a few thousand lines, the streamed output pauses in the widget pane until the next event arrives.',
    status: 'Triaged',
    priority: 'Medium',
    component: 'agent',
    opened: '2026-05-19',
  },
  {
    id: 'PIN-109',
    title: 'Comment thread loses focus after submit',
    description:
      'After resolving a comment, the next click on the page is consumed by the now-closed widget instead of reaching the underlying element.',
    status: 'In review',
    priority: 'Medium',
    component: 'widget',
    opened: '2026-05-17',
  },
  {
    id: 'PIN-108',
    title: 'Screenshot capture fails on cross-origin iframes',
    description:
      'Elements rendered inside cross-origin iframes are skipped by the screenshot capture, so the agent sees a blank region in the attached image.',
    status: 'Open',
    priority: 'Medium',
    component: 'capture',
    opened: '2026-05-15',
  },
  {
    id: 'PIN-107',
    title: 'Source location off by one column for HOC-wrapped elements',
    description:
      'JSX elements wrapped in higher-order components resolve to the wrapper file rather than the original component, so agents edit the wrong line.',
    status: 'Triaged',
    priority: 'Medium',
    component: 'transform',
    opened: '2026-05-12',
  },
  {
    id: 'PIN-106',
    title: 'Tab order skips the resolve button on Firefox',
    description:
      'Keyboard navigation jumps from the comment input straight to the close button, making the widget hard to use without a mouse on Firefox.',
    status: 'Open',
    priority: 'Low',
    component: 'widget',
    opened: '2026-05-10',
  },
  {
    id: 'PIN-105',
    title: 'Sidebar nav collapses below 320px',
    description:
      'The example app sidebar overflows its container on very narrow viewports, hiding the nav links behind the main content.',
    status: 'Open',
    priority: 'Low',
    component: 'examples',
    opened: '2026-05-08',
  },
  {
    id: 'PIN-104',
    title: 'Hop targeting picks stray text nodes',
    description:
      'The element picker occasionally selects a child text node instead of the nearest interactive ancestor, causing the agent to edit a parent element by mistake.',
    status: 'Fixed',
    priority: 'Medium',
    component: 'widget',
    opened: '2026-05-05',
  },
  {
    id: 'PIN-103',
    title: 'Feedback events lost on full page reload',
    description:
      'Comments submitted while the dev server was restarting were dropped instead of being queued; persistent browser storage now buffers them across reloads.',
    status: 'Fixed',
    priority: 'High',
    component: 'storage',
    opened: '2026-05-02',
  },
  {
    id: 'PIN-102',
    title: 'JSX transform breaks on generic component signatures',
    description:
      'TypeScript components declared with generic parameters tripped the source-location transform and produced invalid output.',
    status: 'Fixed',
    priority: 'Medium',
    component: 'transform',
    opened: '2026-04-29',
  },
  {
    id: 'PIN-101',
    title: 'Database worker fails on cold start with stale lock',
    description:
      'A leftover SQLite lock file from a previous run caused the worker to refuse to start until the file was manually deleted.',
    status: 'Fixed',
    priority: 'High',
    component: 'storage',
    opened: '2026-04-25',
  },
];

const priorityClass: Record<Issue['priority'], string> = {
  High: 'text-red-700',
  Medium: 'text-amber-700',
  Low: 'text-foreground/70',
};

const statusClass: Record<Issue['status'], string> = {
  Open: 'bg-blue-100 text-blue-800',
  Triaged: 'bg-secondary text-foreground/80',
  'In review': 'bg-violet-100 text-violet-800',
  'In progress': 'bg-amber-100 text-amber-800',
  Fixed: 'bg-emerald-100 text-emerald-800',
};

const statusOrder: Issue['status'][] = ['Open', 'Triaged', 'In progress', 'In review', 'Fixed'];

const counts = issues.reduce(
  (acc, issue) => {
    acc[issue.status] = (acc[issue.status] ?? 0) + 1;
    return acc;
  },
  {} as Record<Issue['status'], number>,
);

export default function IssuesPage() {
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1 className="text-4xl font-semibold tracking-tight">Issues</h1>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        A running log of bugs and rough edges surfaced while building Pinagent — the
        click-to-comment widget itself, the source-map transform, the persistent storage layer, the
        agent runtimes, and the example apps that exercise all of them. Each item lists the affected
        component, the date it was opened, and where it stands today, from freshly reported to
        already shipped. To file a new one, click any element on the page, leave a short note
        describing what looks wrong, and it will land here once the agent or a reviewer has picked
        it up.
      </p>

      <section className="mt-6 flex flex-wrap gap-2">
        {statusOrder.map((status) => (
          <span
            key={status}
            className={cn('rounded-full px-2.5 py-1 text-[13px] font-medium', statusClass[status])}
          >
            {status}: {counts[status] ?? 0}
          </span>
        ))}
      </section>

      <ul className="mt-6 m-0 flex list-none flex-col gap-3 p-0">
        {issues.map((issue) => (
          <li
            key={issue.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-[64px] font-mono text-[13px] text-muted-foreground">
                {issue.id}
              </span>
              <span className="flex-1 font-medium text-foreground">{issue.title}</span>
              <span className={cn('text-xs font-semibold', priorityClass[issue.priority])}>
                {issue.priority}
              </span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  statusClass[issue.status],
                )}
              >
                {issue.status}
              </span>
            </div>
            <p className="m-0 text-[15px] leading-snug text-foreground/85">{issue.description}</p>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>
                <code className="font-mono">{issue.component}</code>
              </span>
              <span>·</span>
              <span>opened {issue.opened}</span>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
