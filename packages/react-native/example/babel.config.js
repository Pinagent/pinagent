// SPDX-License-Identifier: Apache-2.0
// `babel-preset-expo` enables the dev-only `@babel/plugin-transform-react-jsx-source`
// transform that populates each fiber's `_debugSource` — which is exactly
// what Pinagent's picker reads to resolve a tap to file:line:col.
module.exports = (api) => {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
