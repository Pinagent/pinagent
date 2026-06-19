---
"@pinagent/react-native": patch
---

fix(react-native): resolve taps to the call site, not the wrapper, for generic components

The Babel source-tagging plugin appended its `data-pa-loc` / `data-pa-comp`
attributes *after* an element's existing attributes. For a generic wrapper
component that forwards props onto a host view — `const View = (props) =>
<ViewRn {...props} />`, the dominant pattern in real RN/Expo apps — the
forwarded call-site `data-pa-loc` (which arrives through `{...props}`) was
overridden by the wrapper's own spliced attribute, because JSX props are
last-wins and the spliced one came last. Every element rendered through the
wrapper therefore collapsed to the wrapper's own `file:line` (e.g.
`src/components/view/view.tsx:14`), so tapping a child in the in-app picker
only ever resolved to the wrapper — the specific element the developer tapped
was unreachable.

Prepend the attributes instead, so a forwarded `data-pa-loc` overrides the
wrapper's own and the host view resolves to the actual call site. This matches
the web `@pinagent/babel-plugin`, which already inserts at the element name
(before any `{...spread}`). Adds the RN plugin's first unit tests.
