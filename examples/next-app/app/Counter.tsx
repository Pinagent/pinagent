// SPDX-License-Identifier: Apache-2.0
'use client';
import { Button } from '@pinagent/ui/components/ui/button';
import { useState } from 'react';

export function Counter({ label, description }: { label: string; description?: string }) {
  const [count, setCount] = useState(0);
  return (
    <div className="mb-2 flex items-center justify-between rounded-lg border border-border bg-transparent p-3 transition-colors hover:border-muted-foreground hover:bg-secondary">
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold">{label}</span>
        {description && <span className="text-[13px] text-muted-foreground">{description}</span>}
      </div>
      <Button type="button" variant="accent" size="sm" onClick={() => setCount((c) => c + 1)}>
        {count}
      </Button>
    </div>
  );
}
