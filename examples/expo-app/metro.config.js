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
//   const { pinagentMiddleware } = require('@pinagent/react-native/server');
// and none of the watchFolders/resolver lines are needed — just `enhanceMiddleware`.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { pinagentMiddleware } = require('../../packages/react-native/dist/server.js');

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
  // projectRoot points at wherever you want `.pinagent/` to live; keeping it
  // here makes the demo self-contained. spawnMode 'inline' runs the agent
  // in-process; use false to drive the loop from your own Claude Code MCP session.
  //
  // The middleware mounts POST /__pinagent/feedback AND self-installs the
  // /__pinagent/ws live-streaming socket on Metro's own port. The WS install
  // goes through the middleware (not `config.server.websocketEndpoints`)
  // because Expo's dev server ignores that field — it would silently drop the
  // socket and the in-app stream sheet would hang on "Connecting…".
  enhanceMiddleware: (metroMiddleware, _server) =>
    pinagentMiddleware({ projectRoot, spawnMode: 'inline' }).chain(metroMiddleware),
};

module.exports = config;
