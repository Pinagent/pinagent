---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
---

Re-anchor a feedback bubble to the picked `.map()` instance instead of always rebinding to the first row. When the same JSX literal renders several times, all live nodes share one `data-pa-loc`; the widget now uses the instance fingerprint captured at pick time (with the positional index as a fallback) to find the right node again on reload/re-anchor. (Ships via the bundled `@pinagent/widget`, so both plugins re-embed it.)
