---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
---

Fix the JSX source-location tagger producing unparseable output for generic components (`<Foo<T> .../>`). The `data-pa-loc` attribute was spliced at the element name, but TypeScript type arguments sit between the name and the attributes, so the tag landed inside the `<...>` and broke the dev build. It's now inserted after the type arguments. (The fix is in the bundled `@pinagent/babel-plugin`, so both plugins republish.)
