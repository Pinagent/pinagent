// SPDX-License-Identifier: Apache-2.0
//
// Entry point for `pinagent` CLI. Stub: real subcommands (`dev`, `mcp`,
// `init`) will be wired in once apps/cli takes on its own surface.

export const PACKAGE_NAME = '@pinagent/cli';

const [, , subcommand] = process.argv;
if (subcommand) {
  console.error(`pinagent: subcommand "${subcommand}" is not implemented yet`);
  process.exit(1);
}
console.log('pinagent CLI (scaffold). Subcommands coming soon.');
