// SPDX-License-Identifier: Apache-2.0
import { Card, CardContent } from '@pinagent/ui/components/ui/card';
import { Logo } from './_components/Logo';
import { CounterList } from './CounterList';
import { Footer } from './Footer';

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1 className="text-5xl font-semibold tracking-tight">Pinagent · Next.js demo</h1>
      <p className="mt-4 font-bold">
        Click the <Logo size={16} style={{ verticalAlign: '-3px', borderRadius: 3 }} /> button, pick
        an element, and leave a comment — an agent picks it up and edits the code directly.
      </p>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        Click. Comment. Ship. Try it below.
      </p>
      <Card className="mt-6 max-h-72 overflow-y-auto">
        <CardContent className="p-3">
          <CounterList
            items={[{ label: 'Blueberries', description: 'Tiny antioxidant-rich gems.' }]}
          />
        </CardContent>
      </Card>
      <Footer />
    </main>
  );
}
