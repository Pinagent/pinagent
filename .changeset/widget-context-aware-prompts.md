---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Quick-action chip prompts now quote the element's current state.

Before, every chip dropped a generic prompt and the user had to
restate the existing value:

  click "Change text"  → `Change the text to: ` (then re-type old value + new)
  click "Change link"  → `Change the link target to ` (re-type old href)

Now the chip's prompt references the picked element directly:

  <button>Get started</button>
    click "Change text" → `Change the text from "Get started" to: `

  <a href="/docs">Read more</a>
    click "Change link" → `Change the link target from "/docs" to `

  <img src=".../logo.png?v=2" alt="Company logo">
    click "Change image"   → `Change this image (currently logo.png) to: `
    click "Edit alt text"  → `Change the alt text from "Company logo" to: `

  <input placeholder="Email address">
    click "Change placeholder" → `Change the placeholder from "Email address" to: `

The user types only the *new* value. Long button/heading text is
truncated to a 60-char snippet so a paragraph-sized element doesn't
flood the prompt. Image src is reduced to the filename (query string
and CDN host stripped) for readability; data: URIs fall back to a
plain truncation rather than splitting on the colon.

The alt-text chip label also adapts: "Add alt text" when no alt is
set, "Edit alt text" when one is.

Under the hood, the chip catalog's `label` and `prompt` fields move
from `string` to `(el: Element) => string`; `quickActionsFor` resolves
both before returning the public `QuickAction` (which still exposes
them as resolved strings). Static chips return constants, so the
function-of-element shape doesn't leak complexity to call sites.

12 new tests cover the per-element prompts plus the alt-text label
flip, truncation, whitespace collapse, and the data:-URI edge case.
Full widget suite is 97/97.
