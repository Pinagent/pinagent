---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Quick-action chips are now element-aware.

Previously every picked element got the same 5 chips (Change text,
Recolor, Add hover state, Resize, Make it a link) regardless of what
made sense for it — "Change text" on an `<img>`, "Make it a link" on
an `<a>` that already was one.

The chip catalog moves to a new `quick-actions.ts` module. Each chip
carries a `matches(el)` predicate; `quickActionsFor(el)` walks the
catalog in order and returns just the chips whose predicate agrees.
Recolor + Resize accept anything so the chip row is never empty; the
rest specialize:

  <button>       Change text · Recolor · Add hover state · Resize · Make it a link
  <a href="…">   Change text · Recolor · Add hover state · Resize · Change link
  <img>          Change image · Add alt text · Recolor · Resize
  <input [ph]>   Recolor · Add hover state · Resize · Change placeholder
  <h1>Hi</h1>    Change text · Recolor · Resize · Make it a link
  <div><btn>…    Recolor · Resize · Make it a link    (no Change text — outer div has no *own* visible text)

Catalog order is preserved by the filter so chips appear in a
predictable position regardless of which element you pick.

Brand colors and layout unchanged; pure behavior expansion. 13 new
unit tests on `quick-actions.test.ts` cover the predicates per
representative element type.
