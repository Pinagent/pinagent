export default function DocsPage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '40px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: '2.25rem' }}>Docs</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.55 }}>
        Pinpoint turns any UI element into a comment thread an agent can act on.
        Click an element in the browser, leave a note, and the agent edits the
        underlying code directly.
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
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>How it works</h2>
          <ol style={{ color: '#374151', lineHeight: 1.6, marginTop: 12, paddingLeft: 20 }}>
            <li>Click the 💬 button in the bottom-right of any page.</li>
            <li>Pick the element you want to change.</li>
            <li>Type a short comment describing what you want.</li>
            <li>
              An agent receives the comment plus a screenshot, locates the
              matching source file and line, and applies the edit.
            </li>
            <li>The widget streams the agent&apos;s output back into the page next to your element.</li>
          </ol>
        </article>

        <article
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            background: '#f9fafb',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Setup in a Next.js app</h2>
          <ol style={{ color: '#374151', lineHeight: 1.6, marginTop: 12, paddingLeft: 20 }}>
            <li>Install the Pinpoint package in your app.</li>
            <li>
              Mount the <code>&lt;Pinpoint /&gt;</code> component once in your
              root <code>app/layout.tsx</code>, after <code>{'{children}'}</code>.
            </li>
            <li>
              Run your dev server alongside the Pinpoint agent runner so
              comments have somewhere to go.
            </li>
          </ol>
          <p style={{ color: '#4b5563', lineHeight: 1.55, marginTop: 12 }}>
            That&apos;s it — every page in your app is now click-to-comment.
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
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Agent runtimes</h2>
          <ul style={{ color: '#374151', lineHeight: 1.6, marginTop: 12, paddingLeft: 20 }}>
            <li>
              <strong>MCP into Claude Code</strong> — feedback streams into your
              running session as channel events you can act on inline.
            </li>
            <li>
              <strong>Claude Agent SDK</strong> — each comment spawns a parallel
              agent in an isolated git worktree, so concurrent edits never
              collide.
            </li>
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
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Tips</h2>
          <ul style={{ color: '#374151', lineHeight: 1.6, marginTop: 12, paddingLeft: 20 }}>
            <li>Keep comments scoped to one change — agents act conservatively.</li>
            <li>
              Click the element closest to what you want changed; Pinpoint uses
              its file and line to anchor the edit.
            </li>
            <li>Multiple widgets can be open at once — leave several comments in a single pass.</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
