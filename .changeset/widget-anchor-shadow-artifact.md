---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
---
Drop the composer card's drop shadow. The card fills its transparent iframe
flush to the edges, so the `box-shadow` was rectangular-clipped by the iframe
bounds and rendered as a hard-edged halo artifact around the anchored widget
rather than a soft shadow. The card's 1px border carries its separation from
the page instead; the needs-input/activity pulses keep their colored state
rings (minus the clipped drop-shadow layer).
