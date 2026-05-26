// SPDX-License-Identifier: Apache-2.0
import { Card } from '@pinagent/ui/components/ui/card';

export default function ContactPage() {
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1 className="text-4xl font-semibold tracking-tight">Contact</h1>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        Get in touch with the Pinagent team.
      </p>

      <section className="mt-8 flex flex-col gap-4">
        <Card className="p-5">
          <h2 className="m-0 text-xl font-semibold">Email</h2>
          <p className="mt-2 mb-0 leading-relaxed">
            <a
              href="mailto:hello@pinagent.dev"
              className="font-medium text-foreground underline underline-offset-4 decoration-muted-foreground hover:decoration-foreground"
            >
              hello@pinagent.dev
            </a>
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="m-0 text-xl font-semibold">GitHub</h2>
          <p className="mt-2 mb-0 leading-relaxed">
            File issues or open pull requests on the Pinagent repository.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="m-0 text-xl font-semibold">Community</h2>
          <p className="mt-2 mb-0 leading-relaxed">
            Join the conversation in our community channels for support, ideas, and discussion.
          </p>
        </Card>
      </section>
    </main>
  );
}
