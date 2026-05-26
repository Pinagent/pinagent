// SPDX-License-Identifier: Apache-2.0
import { Card } from '@pinagent/ui/components/ui/card';
import { Logo } from '../_components/Logo';

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1 className="text-4xl font-semibold tracking-tight">Docs</h1>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        Pinagent turns any UI element into a comment thread an agent can act on. Click an element in
        the browser, leave a note, and the agent edits the underlying code directly — no copying
        file paths, no describing where the element lives in your tree, no context-switching back to
        your editor.
      </p>
      <p className="mt-3 leading-relaxed text-muted-foreground">
        Under the hood, Pinagent instruments your JSX at build time so every rendered element
        carries its source location. When you click, the widget captures a screenshot, the
        surrounding DOM, and the file:line of the element, then hands the whole bundle to an agent.
      </p>

      <section className="mt-8 flex flex-col gap-6">
        <Card className="p-5">
          <h2 className="m-0 text-xl font-semibold">How it works</h2>
          <ol className="mt-3 list-decimal pl-5 leading-relaxed">
            <li>
              Click the <Logo size={14} style={{ verticalAlign: '-2px', borderRadius: 3 }} /> button
              in the bottom-right of any page.
            </li>
            <li>
              Pick the element you want to change — the overlay highlights what&apos;s under your
              cursor.
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
        </Card>

        <Card className="p-5">
          <h2 className="m-0 text-xl font-semibold">Setup in a Next.js app</h2>
          <ol className="mt-3 list-decimal pl-5 leading-relaxed">
            <li>
              Install the Pinagent package in your app:{' '}
              <code className="font-mono text-sm">npm install @pinagent/next</code>.
            </li>
            <li>
              Add the Pinagent plugin to your{' '}
              <code className="font-mono text-sm">next.config.js</code> so JSX gets instrumented
              during the build.
            </li>
            <li>
              Mount the <code className="font-mono text-sm">&lt;Pinagent /&gt;</code> component once
              in your root <code className="font-mono text-sm">app/layout.tsx</code>, after{' '}
              <code className="font-mono text-sm">{'{children}'}</code>.
            </li>
            <li>
              Run your dev server alongside the Pinagent agent runner so comments have somewhere to
              go.
            </li>
          </ol>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            That&apos;s it — every page in your app is now click-to-comment. Pinagent only activates
            in development, so there&apos;s no runtime cost in production builds.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="m-0 text-xl font-semibold">Agent runtimes</h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            Pinagent can route feedback to two different agent runtimes. Pick whichever matches how
            you already work.
          </p>
          <ul className="mt-3 list-disc pl-5 leading-relaxed">
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
        </Card>

        <Card className="p-5">
          <h2 className="m-0 text-xl font-semibold">What you can comment on</h2>
          <ul className="mt-3 list-disc pl-5 leading-relaxed">
            <li>Copy edits — &quot;change this heading to &apos;Welcome back&apos;&quot;.</li>
            <li>
              Styling tweaks — &quot;add more padding&quot;, &quot;make this card border
              softer&quot;.
            </li>
            <li>Layout changes — &quot;move this button to the right of the input&quot;.</li>
            <li>Component swaps — &quot;replace this with a dropdown&quot;.</li>
            <li>Behavior — &quot;disable this when the form is empty&quot;.</li>
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="m-0 text-xl font-semibold">Tips</h2>
          <ul className="mt-3 list-disc pl-5 leading-relaxed">
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
        </Card>
      </section>
    </main>
  );
}
