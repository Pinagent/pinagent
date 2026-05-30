// SPDX-License-Identifier: Elastic-2.0
import type { ReactNode } from 'react';

/**
 * Small form-layout helpers shared by the edit forms. The @pinagent/ui package
 * has no Select component, so native `<select>` borrows the Input styling via
 * `selectClassName` to stay visually consistent.
 */

/** Mirrors @pinagent/ui's Input chrome so a native `<select>` matches. */
export const selectClassName =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Labelled field: a caption above its control. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // The control is passed as children and nested inside the label, so it's
    // implicitly associated; biome can't see that statically.
    // biome-ignore lint/a11y/noLabelWithoutControl: control is the nested child
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/** Inline validation/submit error, or nothing. */
export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  );
}
