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

const priorityColor: Record<Issue['priority'], string> = {
  High: '#b91c1c',
  Medium: '#b45309',
  Low: '#3D3730',
};

const statusColor: Record<Issue['status'], { fg: string; bg: string }> = {
  Open: { fg: '#1d4ed8', bg: '#dbeafe' },
  Triaged: { fg: '#3D3730', bg: '#F5EFD0' },
  'In review': { fg: '#7c3aed', bg: '#ede9fe' },
  'In progress': { fg: '#b45309', bg: '#fef3c7' },
  Fixed: { fg: '#047857', bg: '#d1fae5' },
};

const counts = issues.reduce(
  (acc, issue) => {
    acc[issue.status] = (acc[issue.status] ?? 0) + 1;
    return acc;
  },
  {} as Record<Issue['status'], number>,
);

const statusOrder: Issue['status'][] = ['Open', 'Triaged', 'In progress', 'In review', 'Fixed'];

export default function IssuesPage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '40px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: '2.25rem' }}>Issues</h1>
      <p style={{ color: '#3D3730', lineHeight: 1.55 }}>
        A running log of bugs and rough edges surfaced while building Pinagent — the
        click-to-comment widget itself, the source-map transform, the persistent storage layer, the
        agent runtimes, and the example apps that exercise all of them. Each item lists the affected
        component, the date it was opened, and where it stands today, from freshly reported to
        already shipped. To file a new one, click any element on the page, leave a short note
        describing what looks wrong, and it will land here once the agent or a reviewer has picked
        it up.
      </p>

      <section
        style={{
          marginTop: 24,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        {statusOrder.map((status) => (
          <span
            key={status}
            style={{
              fontSize: '0.8125rem',
              padding: '4px 10px',
              borderRadius: 999,
              background: statusColor[status].bg,
              color: statusColor[status].fg,
              fontWeight: 500,
            }}
          >
            {status}: {counts[status] ?? 0}
          </span>
        ))}
      </section>

      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          marginTop: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {issues.map((issue) => (
          <li
            key={issue.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: '14px 16px',
              border: '1px solid #E8DFB0',
              borderRadius: 8,
              background: '#FCF9E8',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  fontSize: '0.8125rem',
                  color: '#5C5546',
                  minWidth: 64,
                }}
              >
                {issue.id}
              </span>
              <span style={{ flex: 1, color: '#201B21', fontWeight: 500 }}>{issue.title}</span>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: priorityColor[issue.priority],
                }}
              >
                {issue.priority}
              </span>
              <span
                style={{
                  fontSize: '0.75rem',
                  color: statusColor[issue.status].fg,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: statusColor[issue.status].bg,
                  fontWeight: 500,
                }}
              >
                {issue.status}
              </span>
            </div>
            <p style={{ color: '#3D3730', lineHeight: 1.5, margin: 0, fontSize: '0.9375rem' }}>
              {issue.description}
            </p>
            <div style={{ display: 'flex', gap: 12, fontSize: '0.75rem', color: '#5C5546' }}>
              <span>
                <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>
                  {issue.component}
                </code>
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
