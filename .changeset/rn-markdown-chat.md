---
'@pinagent/react-native': patch
---

Render the agent's streamed replies as Markdown in the React Native widget. The
StreamSheet previously dumped the raw text into a plain `<Text>`, so `**bold**`,
`` `code` ``, fenced blocks, lists, headings and links showed up as literal
markers. A tiny dependency-free parser now folds the text into a block/inline
tree rendered with RN primitives; anything it doesn't recognise degrades to
plain text.
