import { Logo } from '../_components/Logo';

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
        Pinagent turns any UI element into a comment thread an agent can act on. Click an element in
        the browser, leave a note, and the agent edits the underlying code directly — no copying
        file paths, no describing where the element lives in your tree, no context-switching back to
        your editor.
      </p>
      <p style={{ color: '#4b5563', lineHeight: 1.55 }}>
        Under the hood, Pinagent instruments your JSX at build time so every rendered element
        carries its source location. When you click, the widget captures a screenshot, the
        surrounding DOM, and the file:line of the element, then hands the whole bundle to an agent.
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
            <li>
              Click the <Logo size={14} style={{ verticalAlign: '-2px', borderRadius: 3 }} /> button
              in the bottom-right of any page.
            </li>
            <li>
              Pick the element you want to change — the overlay highlights what's under your cursor.
            </li>
            <li>
              Type a short comment describing what you want (e.g. &quot;make this button red&quot;
              or &quot;add a subtitle&quot;).
            </li>
            <li>
              An agent receives the comment plus a screenshot, locates the matching source file and
              line, and applies the edit.
            </li>
            <li>
              The widget streams the agent&apos;s output back into the page next to your element so
              you can watch progress in real time.
            </li>
            <li>
              Hot reload picks up the change automatically — usually within a second or two of the
              agent finishing.
            </li>
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
            <li>
              Install the Pinagent package in your app: <code>npm install @pinagent/next</code>.
            </li>
            <li>
              Add the Pinagent plugin to your <code>next.config.js</code> so JSX gets instrumented
              during the build.
            </li>
            <li>
              Mount the <code>&lt;Pinagent /&gt;</code> component once in your root{' '}
              <code>app/layout.tsx</code>, after <code>{'{children}'}</code>.
            </li>
            <li>
              Run your dev server alongside the Pinagent agent runner so comments have somewhere to
              go.
            </li>
          </ol>
          <p style={{ color: '#4b5563', lineHeight: 1.55, marginTop: 12 }}>
            That&apos;s it — every page in your app is now click-to-comment. Pinagent only activates
            in development, so there&apos;s no runtime cost in production builds.
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
          <p style={{ color: '#4b5563', lineHeight: 1.55, marginTop: 12 }}>
            Pinagent can route feedback to two different agent runtimes. Pick whichever matches how
            you already work.
          </p>
          <ul style={{ color: '#374151', lineHeight: 1.6, marginTop: 12, paddingLeft: 20 }}>
            <li>
              <strong>MCP into Claude Code</strong> — feedback streams into your running Claude Code
              session as channel events you can act on inline. Best when you want to stay in one
              conversation, review each change, and keep full context across multiple comments.
            </li>
            <li>
              <strong>Claude Agent SDK</strong> — each comment spawns a parallel agent in an
              isolated git worktree, so concurrent edits never collide. Best for batches of small UI
              tweaks where you want several changes to land at once without waiting in line.
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
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>What you can comment on</h2>
          <ul style={{ color: '#374151', lineHeight: 1.6, marginTop: 12, paddingLeft: 20 }}>
            <li>Copy edits — &quot;change this heading to &apos;Welcome back&apos;&quot;.</li>
            <li>
              Styling tweaks — &quot;add more padding&quot;, &quot;make this card border
              softer&quot;.
            </li>
            <li>Layout changes — &quot;move this button to the right of the input&quot;.</li>
            <li>Component swaps — &quot;replace this with a dropdown&quot;.</li>
            <li>Behavior — &quot;disable this when the form is empty&quot;.</li>
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
              Click the element closest to what you want changed; Pinagent uses its file and line to
              anchor the edit.
            </li>
            <li>Multiple widgets can be open at once — leave several comments in a single pass.</li>
            <li>
              If a comment is ambiguous, the agent will ask a clarifying question through the widget
              rather than guess.
            </li>
            <li>
              Comments persist across reloads until they&apos;re resolved, so you can come back to
              an in-flight thread.
            </li>
          </ul>
        </article>
      </section>
    </main>
  );
}
