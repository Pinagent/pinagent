// SPDX-License-Identifier: Apache-2.0
//
// `pinagent` CLI entry point.
//
// Subcommands:
//   pinagent mcp          Start the stdio MCP server. Resolves the project
//                         root from PINAGENT_PROJECT_ROOT or the current
//                         working directory.
//
// Future subcommands (`dev`, `init`) intentionally not implemented yet.

import { startMcpServer } from '@pinagent/mcp';

const HELP = `pinagent — agent-driven UI feedback loop

Usage:
  pinagent <subcommand>

Subcommands:
  mcp                Start the stdio MCP server. Configure your coding
                     agent (Claude Code, etc.) to spawn this command so it
                     can read pending feedback, screenshots, and source
                     context from a running Pinagent dev session.

Options:
  -h, --help         Show this help.

Environment:
  PINAGENT_PROJECT_ROOT  Override the project root the MCP server reads
                         from. Defaults to the current working directory.
`;

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv;

  if (!subcommand || subcommand === '-h' || subcommand === '--help' || subcommand === 'help') {
    process.stdout.write(HELP);
    process.exit(subcommand ? 0 : 1);
  }

  if (subcommand === 'mcp') {
    if (rest.length > 0) {
      process.stderr.write(`pinagent mcp: unexpected arguments: ${rest.join(' ')}\n`);
      process.exit(2);
    }
    await startMcpServer();
    return;
  }

  process.stderr.write(`pinagent: unknown subcommand "${subcommand}"\n\n${HELP}`);
  process.exit(2);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('pinagent: fatal:', err);
  process.exit(1);
});
