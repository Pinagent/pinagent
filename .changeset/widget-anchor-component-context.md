---
'@pinagent/next-plugin': minor
'@pinagent/vite-plugin': minor
---

Richer anchor context: enclosing component + loop-instance disambiguation.

The Babel plugin now stamps a companion `data-pa-comp` attribute next to
`data-pa-loc`, carrying the nearest **enclosing component** name (the
closest PascalCase function/class that renders the element). The widget
reads it on pick, shows `in <PriceCard>` in the composer header, and
sends three new pieces of context to the agent:

- **component** — the enclosing component name, e.g. `PriceCard`.
- **componentPath** — the outer→inner chain of distinct components
  (`App › PriceList › PriceCard`), giving structural context.
- **loop instance** — when the same JSX literal is rendered more than
  once (a `.map()`), the picked element's `data-pa-loc` is shared across
  many DOM nodes. The widget now records *which* instance was clicked
  (index + total) plus a content fingerprint (text snippet + identity
  attributes), so the agent can act on the right list item instead of
  the first match. The agent's initial prompt calls this out explicitly.

All fields are optional on the wire and null in the DB for the common
single-pick / uninstrumented case, so existing payloads are unchanged.
Backed by five new nullable `widget_anchors` columns (additive
migration; the dev server and browser cache both apply it on connect).
