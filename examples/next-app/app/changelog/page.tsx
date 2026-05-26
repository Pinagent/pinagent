export default function ChangelogPage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '40px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: '2.25rem' }}>Changelog</h1>
      <p style={{ color: '#3D3730', lineHeight: 1.55 }}>
        Release notes and updates from the Pinagent Next.js demo.
      </p>

      <section style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <article
          style={{
            border: '1px solid #E8DFB0',
            borderRadius: 8,
            padding: 20,
            background: '#FCF9E8',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>v0.4.0 — Multi-widget updates</h2>
            <time style={{ color: '#5C5546', fontSize: '0.875rem' }}>2026-05-20</time>
          </header>
          <ul style={{ color: '#2A2528', lineHeight: 1.55, marginTop: 12 }}>
            <li>Multiple pinagent widgets can now be open simultaneously without conflicts.</li>
            <li>
              Improved widget positioning when the targeted element is near the viewport edge.
            </li>
            <li>Smoother streaming output in the comment pane.</li>
          </ul>
        </article>

        <article
          style={{
            border: '1px solid #E8DFB0',
            borderRadius: 8,
            padding: 20,
            background: '#FCF9E8',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>v0.3.0 — New agent loops</h2>
            <time style={{ color: '#5C5546', fontSize: '0.875rem' }}>2026-05-10</time>
          </header>
          <ul style={{ color: '#2A2528', lineHeight: 1.55, marginTop: 12 }}>
            <li>Added parallel per-comment agent loops via the Claude Agent SDK.</li>
            <li>Isolated worktrees keep concurrent edits from stepping on each other.</li>
            <li>Feedback events now stream into a dedicated MCP channel.</li>
          </ul>
        </article>

        <article
          style={{
            border: '1px solid #E8DFB0',
            borderRadius: 8,
            padding: 20,
            background: '#FCF9E8',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>v0.2.0 — Next.js example</h2>
            <time style={{ color: '#5C5546', fontSize: '0.875rem' }}>2026-04-28</time>
          </header>
          <ul style={{ color: '#2A2528', lineHeight: 1.55, marginTop: 12 }}>
            <li>Shipped this Next.js App Router demo app.</li>
            <li>Wired the Pinagent click-to-comment widget into the layout.</li>
            <li>Documented setup steps for new projects.</li>
          </ul>
        </article>

        <article
          style={{
            border: '1px solid #E8DFB0',
            borderRadius: 8,
            padding: 20,
            background: '#FCF9E8',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>v0.1.0 — Initial release</h2>
            <time style={{ color: '#5C5546', fontSize: '0.875rem' }}>2026-04-01</time>
          </header>
          <ul style={{ color: '#2A2528', lineHeight: 1.55, marginTop: 12 }}>
            <li>First public version of Pinagent.</li>
            <li>Click any UI element, leave a comment, and have an agent edit the code.</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
