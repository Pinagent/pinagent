// SPDX-License-Identifier: Apache-2.0
// `babel-preset-expo` handles the standard Expo/RN + JSX transforms.
//
// `@pinagent/react-native/babel` is Pinagent's source-tagging plugin: it
// splices a `data-pa-loc="file:line:col"` prop onto every authored JSX
// element so the in-app picker can resolve a tap to its source. (React 19
// removed `_debugSource` and RN 0.81+ dropped the inspector's `source`
// field, so the old "reuse RN's dev source" path no longer carries a
// location — we inject our own at build time, exactly like the web plugin.)
//
// We consume it from the in-tree built `dist/` (this demo needs no publish);
// in a real app it's the package name: require('@pinagent/react-native/babel').
// It must run BEFORE babel-preset-expo's JSX transform — listing it in
// `plugins` (which Babel applies before presets) does exactly that. Dev-only:
// production builds drop the widget (and so don't need the tags).
const pinagentBabel = require('../../packages/react-native/dist/babel.cjs');
const pinagentSource = pinagentBabel.default ?? pinagentBabel;

module.exports = (api) => {
  api.cache(true);
  const dev = process.env.NODE_ENV !== 'production';
  return {
    presets: ['babel-preset-expo'],
    plugins: dev ? [pinagentSource] : [],
  };
};
