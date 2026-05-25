export default function RoadmapPage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '40px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: '2.25rem' }}>Roadmap</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.55 }}>
        Planned work and upcoming features for Pinagent.
      </p>

      <section style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <article
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            background: '#f9fafb',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Now</h2>
            <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>In progress</span>
          </header>
          <ul style={{ color: '#374151', lineHeight: 1.55, marginTop: 12 }}>
            <li>Persistent storage for feedback events across sessions.</li>
            <li>Improved widget positioning for elements near the viewport edge.</li>
            <li>Server-side feedback history with searchable archive.</li>
            <li>Screenshot capture with element highlighting for every comment.</li>
            <li>Streaming agent output rendered inline in the widget pane.</li>
            <li>Source mapping from clicked DOM nodes back to JSX file and line.</li>
            <li>Multi-comment batching so related feedback resolves together.</li>
            <li>Keyboard shortcuts for triggering, navigating, and resolving comments.</li>
          </ul>
        </article>

        <article
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            background: '#f9fafb',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Next</h2>
            <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>Up next</span>
          </header>
          <ul style={{ color: '#374151', lineHeight: 1.55, marginTop: 12 }}>
            <li>Team workspaces with shared feedback queues.</li>
            <li>Inline diff previews before the agent applies changes.</li>
            <li>Custom routing rules so comments reach the right agent or reviewer.</li>
            <li>Per-comment branch and PR creation with automatic commit attribution.</li>
            <li>Threaded conversations so reviewers can iterate on agent responses.</li>
            <li>Role-based permissions for comment authors, reviewers, and admins.</li>
            <li>Component-level tagging to group feedback by feature or owner.</li>
            <li>SSO, SAML, and SCIM for enterprise authentication.</li>
            <li>Audit log of every comment, agent action, and resolution.</li>
            <li>Slash commands inside comments for quick agent directives.</li>
          </ul>
        </article>

        <article
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            background: '#f9fafb',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Later</h2>
            <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>Exploring</span>
          </header>
          <ul style={{ color: '#374151', lineHeight: 1.55, marginTop: 12 }}>
            <li>Native integrations for Linear, GitHub Issues, and Slack.</li>
            <li>Mobile and tablet widgets for on-device feedback.</li>
            <li>Replay mode that ties feedback to a recorded session.</li>
            <li>Figma and design-tool integrations for design-versus-built diffs.</li>
            <li>End-user feedback mode so customers can leave comments in production.</li>
            <li>Voice and video comments transcribed into agent-ready context.</li>
            <li>AI-suggested fixes that preview before any code is written.</li>
            <li>Cross-browser and responsive viewport testing from a single comment.</li>
            <li>Analytics dashboard for resolution time, hotspots, and agent accuracy.</li>
            <li>Self-hosted and on-prem deployments for regulated environments.</li>
            <li>Plugin SDK for custom widgets, transports, and agent runtimes.</li>
            <li>Localization and right-to-left layout support for the widget UI.</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
