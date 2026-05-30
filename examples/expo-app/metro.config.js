// SPDX-License-Identifier: Apache-2.0
// Expo's Metro config + the Pinagent dev-server middleware. The middleware
// mounts POST /__pinagent/feedback so the in-app widget can file comments;
// they land in `.pinagent/db.sqlite` under `projectRoot`.
//
// This demo consumes @pinagent/react-native from in-tree (no publish): the
// middleware is required from the package's built `dist/`, and App.tsx imports
// the native source directly. Because that source lives outside this app's
// project root, Metro needs `watchFolders` to see + transpile it.
//
// In a real app outside this monorepo the dep is a normal install:
//   const { pinagentMiddleware, pinagentWebsocketEndpoints } =
//     require('@pinagent/react-native/server');
// and none of the watchFolders/resolver lines are needed — just `server`.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const {
  pinagentMiddleware,
  pinagentWebsocketEndpoints,
} = require('../../packages/react-native/dist/server.js');

const projectRoot = __dirname;
const pkgRoot = path.resolve(projectRoot, '../../packages/react-native');

const config = getDefaultConfig(projectRoot);

// Let Metro see the in-tree package source (it ships `src/native` as-is).
config.watchFolders = [pkgRoot];
// Resolve react / react-native / view-shot from THIS app's node_modules even
// when transpiling files that live under the package.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware, _server) =>
    // projectRoot points at wherever you want `.pinagent/` to live; keeping it
    // here makes the demo self-contained. spawnMode 'inline' runs the agent
    // in-process; use false to drive the loop from your own Claude Code MCP session.
    pinagentMiddleware({ projectRoot, spawnMode: 'inline' }).chain(metroMiddleware),
  // Live agent streaming: mounts /__pinagent/ws on Metro's own port so the
  // in-app widget streams the run back over WebSocket as the agent works.
  websocketEndpoints: {
    ...config.server?.websocketEndpoints,
    ...pinagentWebsocketEndpoints({ projectRoot }),
  },
};

module.exports = config;
