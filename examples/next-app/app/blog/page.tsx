export default function BlogPage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '40px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: '2.25rem' }}>Blog</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.55 }}>
        Notes from the Pinagent team on building click-to-fix dev tools.
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
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
              <a href="/blog/parallel-agents" style={{ color: '#111827', textDecoration: 'none' }}>
                Parallel agents, isolated worktrees
              </a>
            </h2>
            <time style={{ color: '#6b7280', fontSize: '0.875rem' }}>2026-05-18</time>
          </header>
          <p style={{ color: '#374151', lineHeight: 1.55, marginTop: 12, marginBottom: 0 }}>
            How we let multiple Pinagent comments run as parallel Claude Agent SDK loops, each in
            its own git worktree, so concurrent edits never collide.
          </p>
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
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
              <a href="/blog/click-to-fix" style={{ color: '#111827', textDecoration: 'none' }}>
                From click to fix in under a minute
              </a>
            </h2>
            <time style={{ color: '#6b7280', fontSize: '0.875rem' }}>2026-05-02</time>
          </header>
          <p style={{ color: '#374151', lineHeight: 1.55, marginTop: 12, marginBottom: 0 }}>
            A walkthrough of the Pinagent loop: click a UI element, leave a comment, watch the agent
            edit the exact JSX node you pointed at.
          </p>
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
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
              <a href="/blog/why-pinagent" style={{ color: '#111827', textDecoration: 'none' }}>
                Why we built Pinagent
              </a>
            </h2>
            <time style={{ color: '#6b7280', fontSize: '0.875rem' }}>2026-04-15</time>
          </header>
          <p style={{ color: '#374151', lineHeight: 1.55, marginTop: 12, marginBottom: 0 }}>
            The gap between "I see the bug" and "the agent has the right context" was the slowest
            part of our day. So we closed it.
          </p>
        </article>
      </section>
    </main>
  );
}
