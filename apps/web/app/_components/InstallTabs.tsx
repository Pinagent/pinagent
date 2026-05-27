// SPDX-License-Identifier: Apache-2.0
'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@pinagent/ui/components/ui/tabs';

const VITE = `// vite.config.ts
import pinagent from '@pinagent/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [pinagent(), react()],
});`;

const NEXT_CONFIG = `// next.config.ts
import pinagent from '@pinagent/next-plugin/config';

export default pinagent({ /* your config */ });`;

const NEXT_LAYOUT = `// app/layout.tsx — inside <body>
import { Pinagent } from '@pinagent/next-plugin';
<Pinagent />`;

export function InstallTabs() {
  return (
    <Tabs defaultValue="vite" className="w-full">
      <TabsList>
        <TabsTrigger value="vite">Vite</TabsTrigger>
        <TabsTrigger value="next">Next.js</TabsTrigger>
      </TabsList>
      <TabsContent value="vite" className="space-y-3">
        <CodeBlock>pnpm add -D @pinagent/vite-plugin</CodeBlock>
        <CodeBlock>{VITE}</CodeBlock>
      </TabsContent>
      <TabsContent value="next" className="space-y-3">
        <CodeBlock>pnpm add -D @pinagent/next-plugin</CodeBlock>
        <CodeBlock>{NEXT_CONFIG}</CodeBlock>
        <CodeBlock>{NEXT_LAYOUT}</CodeBlock>
      </TabsContent>
    </Tabs>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-muted p-4 font-mono text-sm leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}
