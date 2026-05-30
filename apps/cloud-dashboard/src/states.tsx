// SPDX-License-Identifier: Elastic-2.0

/** Shared loading + error placeholders for the data-loading containers. */

export function Loading() {
  return <p className="text-sm text-muted-foreground">Loading…</p>;
}

export function LoadError({ label, error }: { label: string; error: unknown }) {
  return (
    <p className="text-sm text-destructive" role="alert">
      Failed to load {label}: {String(error)}
    </p>
  );
}
