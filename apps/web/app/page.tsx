// SPDX-License-Identifier: Apache-2.0
import { InstallTabs } from './_components/InstallTabs';

const DIAGRAM = `   browser                      dev server                    agent
┌────────────────┐    ┌──────────────────────────┐    ┌──────────────────┐
│ click element  │    │  /__pinagent middleware  │    │  Claude Code     │
│ leave comment  │──▶ │  writes                  │──▶ │  + @pinagent/mcp │
│ widget snaps   │    │  .pinagent/feedback/<id> │    │  reads, edits,   │
│ a screenshot   │    │  + screenshots/<id>.png  │    │  resolves        │
└────────────────┘    └──────────────────────────┘    └──────────────────┘
        ▲                                                       │
        └────── data-pa-loc="src/Foo.tsx:42:7" ──── resolves ───┘`;

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <Hero />
      <Install />
      <HowItWorks />
      <Modes />
      <Trust />
      <Footer />
    </main>
  );
}

function Hero() {
  return (
    <section className="space-y-6 pb-20">
      <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Pinagent</p>
      <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
        Click any element. Comment. Your coding agent fixes it.
      </h1>
      <p className="max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground">
        A local Vite or Next.js plugin that tags every JSX element with its source location, drops a
        widget in the corner, and hands each comment to Claude Code over MCP — with{' '}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">file:line</code> and a
        screenshot attached.
      </p>
      <div className="flex flex-wrap gap-3 pt-2">
        <a
          href="#install"
          className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Install
        </a>
        <a
          href="https://github.com/Pinagent/pinagent"
          className="inline-flex h-10 items-center rounded-md border border-border bg-background px-5 text-sm font-medium transition-colors hover:bg-muted"
        >
          View on GitHub
        </a>
      </div>
    </section>
  );
}

function Install() {
  return (
    <section id="install" className="space-y-4 border-t border-border pt-16 pb-20">
      <h2 className="text-2xl font-semibold tracking-tight">Install</h2>
      <p className="max-w-2xl text-muted-foreground">
        Two files for Vite, three for Next.js. Five minutes from clone to first comment.
      </p>
      <InstallTabs />
      <p className="text-sm text-muted-foreground">
        Already in a Claude Code session?{' '}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
          claude mcp add pinagent pinagent-mcp
        </code>{' '}
        and ask it to address pending feedback.
      </p>
    </section>
  );
}

function HowItWorks() {
  const steps: Array<{ title: string; body: string }> = [
    {
      title: 'You click.',
      body: 'The widget walks up from the clicked node to the nearest data-pa-loc attribute — set at build time by a babel plugin — and grabs file:line:col.',
    },
    {
      title: 'The dev server writes a record.',
      body: '.pinagent/feedback/<id>.json plus a downscaled screenshot land on disk. The file system is the message bus.',
    },
    {
      title: 'Your agent picks it up.',
      body: 'Either via MCP inside your existing Claude Code session, or Pinagent spawns the Claude Agent SDK per comment and streams events back into the page.',
    },
  ];
  return (
    <section className="space-y-8 border-t border-border pt-16 pb-20">
      <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
      <ol className="grid gap-6 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="space-y-2">
            <div className="font-mono text-xs text-muted-foreground">0{i + 1}</div>
            <div className="font-medium">{step.title}</div>
            <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted p-4 font-mono text-xs leading-relaxed">
        <code>{DIAGRAM}</code>
      </pre>
    </section>
  );
}

function Modes() {
  return (
    <section className="grid gap-6 border-t border-border pt-16 pb-20 sm:grid-cols-2">
      <div className="space-y-2">
        <h3 className="font-semibold">MCP mode — default</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Comments queue in <code className="font-mono">.pinagent/feedback/</code>. Your existing
          Claude Code session calls <code className="font-mono">list_pending_feedback</code> →{' '}
          <code className="font-mono">get_feedback</code> → edits →{' '}
          <code className="font-mono">resolve_feedback</code>. Nothing runs unless you ask.
        </p>
      </div>
      <div className="space-y-2">
        <h3 className="font-semibold">Hands-off mode</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Each comment spawns its own agent — <code className="font-mono">inline</code> against your
          project root, or <code className="font-mono">worktree</code> for an isolated branch at{' '}
          <code className="font-mono">.pinagent/worktrees/&lt;id&gt;</code>. Stream the agent's text
          and tool calls back into the widget. Review each like a PR.
        </p>
      </div>
    </section>
  );
}

function Trust() {
  const facts = [
    {
      title: 'Localhost only.',
      body: 'Middleware and WebSocket bind to 127.0.0.1.',
    },
    {
      title: 'Dev-only.',
      body: 'Widget and middleware gate on NODE_ENV !== "production". Production builds are untouched.',
    },
    {
      title: 'Open source.',
      body: 'Apache-2.0 for everything that runs on your machine.',
    },
  ];
  return (
    <section className="grid gap-4 border-t border-border pt-16 pb-16 sm:grid-cols-3">
      {facts.map((fact) => (
        <div key={fact.title} className="space-y-1">
          <div className="text-sm font-semibold">{fact.title}</div>
          <p className="text-sm text-muted-foreground">{fact.body}</p>
        </div>
      ))}
    </section>
  );
}

function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-8 text-sm text-muted-foreground">
      <div>© Pinagent · Apache-2.0</div>
      <nav className="flex flex-wrap gap-4">
        <a href="https://github.com/Pinagent/pinagent" className="hover:text-foreground">
          GitHub
        </a>
        <a href="https://github.com/Pinagent/pinagent#readme" className="hover:text-foreground">
          Docs
        </a>
        <a href="https://github.com/Pinagent/pinagent/releases" className="hover:text-foreground">
          Releases
        </a>
      </nav>
    </footer>
  );
}
