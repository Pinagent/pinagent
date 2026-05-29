// SPDX-License-Identifier: Apache-2.0

/**
 * Enclosing-component + loop-instance context (#166), shown next to the
 * AnchorChip in both the list row and the detail header. `in <Component>`
 * and, when the picked element was one of several `.map()` instances,
 * `item N of M`. Renders nothing for uninstrumented / single-pick anchors.
 * Typed structurally so it doesn't couple to the full Conversation type.
 */
export function AnchorContext({
  anchor,
}: {
  anchor: {
    component?: string | null;
    instanceIndex?: number | null;
    instanceTotal?: number | null;
  };
}) {
  const hasInstance =
    anchor.instanceTotal != null && anchor.instanceTotal > 1 && anchor.instanceIndex != null;
  if (!anchor.component && !hasInstance) return null;
  return (
    <>
      {anchor.component && (
        <span className="font-mono text-[10.5px] text-muted-foreground truncate">
          in &lt;{anchor.component}&gt;
        </span>
      )}
      {hasInstance && (
        <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums">
          item {(anchor.instanceIndex as number) + 1} of {anchor.instanceTotal}
        </span>
      )}
    </>
  );
}
