// SPDX-License-Identifier: Elastic-2.0
import type { ReactNode } from 'react';

export interface Row {
  label: string;
  value: ReactNode;
}

/** A simple label/value description list shared by the read panels. */
export function KeyValue({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-right font-medium">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
