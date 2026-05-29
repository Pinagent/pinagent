// SPDX-License-Identifier: Apache-2.0
// Expo's Metro config + the Pinagent dev-server middleware. The middleware
// mounts POST /__pinagent/feedback so the in-app widget can file comments.
//
// In a real app outside this monorepo:
//   const { pinagentMiddleware } = require('@pinagent/react-native/server');
// Here we require the built server entry from the package under test.
const { getDefaultConfig } = require('expo/metro-config');
const { pinagentMiddleware } = require('../dist/server.js');

const config = getDefaultConfig(__dirname);

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware, _server) =>
    // projectRoot points at wherever you want `.pinagent/` to live. Using
    // the example dir here keeps the demo self-contained.
    pinagentMiddleware({ projectRoot: __dirname, spawnMode: 'inline' }).chain(metroMiddleware),
};

module.exports = config;
