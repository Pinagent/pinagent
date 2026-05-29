// SPDX-License-Identifier: Apache-2.0
//
// `pinagent` CLI entry point.
//
// Subcommands:
//   pinagent init          Scaffold pinagent into the current project
//                          (gitignore, .mcp.json, Next route handler) and
//                          print the remaining manual wiring steps.
//   pinagent mcp           Start the stdio MCP server. Resolves the project
//                          root from PINAGENT_PROJECT_ROOT or the current
//                          working directory.
//   pinagent transcript    Fetch + print the persisted agent transcript
//                          for one conversation from a running dev-server.
//
// There is intentionally no `pinagent dev`: pinagent has no standalone
// server. It runs as a plugin inside the host app's own dev server
// (`vite` / `next dev`), so the way to "start pinagent" is to wire the
// plugin in (see `pinagent init`) and run your existing dev command.

import { startMcpServer } from '@pinagent/mcp';
import { parseInitArgs, runInit } from './init';
import {
  fetchTranscript,
  parseTranscriptArgs,
  renderTranscript,
  TranscriptHttpError,
} from './transcript';
import { readVersion } from './version';

const HELP = `pinagent — agent-driven UI feedback loop

Usage:
  pinagent <subcommand> [options]

Subcommands:
  init               Scaffold pinagent into the current project: ignore
                     the .pinagent store, register the MCP server in
                     .mcp.json, create the Next route handler (Next only),
                     and print the remaining manual wiring steps. Detects
                     Vite, Next, or Nuxt automatically. Idempotent.

                     Options:
                       --dir <path>   Project root to scaffold. Defaults
                                      to the current directory.
                       --dry-run, -n  Print the plan without writing files.

  mcp                Start the stdio MCP server. Configure your coding
                     agent (Claude Code, etc.) to spawn this command so it
                     can read pending feedback, screenshots, and source
                     context from a running Pinagent dev session.

  transcript <id>    Print the persisted agent transcript for one
                     conversation, fetched over HTTP from a running
                     pinagent dev-server. Useful for export, log review,
                     or piping into a model.

                     Options:
                       --server <url>  Base URL of the dev-server.
                                       Defaults to PINAGENT_SERVER_URL or
                                       http://localhost:3000.
                       --json          Emit raw JSON instead of plain text.

Options:
  -h, --help         Show this help.
  -v, --version      Print the CLI version.

Environment:
  PINAGENT_PROJECT_ROOT  Override the project root the MCP server reads
                         from. Defaults to the current working directory.
  PINAGENT_SERVER_URL    Default dev-server URL for \`pinagent transcript\`.
`;

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv;

  if (subcommand === '-v' || subcommand === '--version' || subcommand === 'version') {
    process.stdout.write(`${readVersion()}\n`);
    process.exit(0);
  }

  if (!subcommand || subcommand === '-h' || subcommand === '--help' || subcommand === 'help') {
    process.stdout.write(HELP);
    process.exit(subcommand ? 0 : 1);
  }

  if (subcommand === 'init') {
    const parsed = parseInitArgs(rest);
    if ('error' in parsed) {
      process.stderr.write(`pinagent init: ${parsed.error}\n\n${HELP}`);
      process.exit(2);
    }
    const result = runInit(parsed);
    process.stdout.write(`${result.lines.join('\n')}\n`);
    process.exit(result.code);
  }

  if (subcommand === 'mcp') {
    if (rest.length > 0) {
      process.stderr.write(`pinagent mcp: unexpected arguments: ${rest.join(' ')}\n`);
      process.exit(2);
    }
    await startMcpServer();
    return;
  }

  if (subcommand === 'transcript') {
    const parsed = parseTranscriptArgs(rest);
    if ('error' in parsed) {
      process.stderr.write(`pinagent transcript: ${parsed.error}\n\n${HELP}`);
      process.exit(2);
    }
    try {
      const events = await fetchTranscript({ serverUrl: parsed.serverUrl, id: parsed.id });
      if (parsed.json) {
        process.stdout.write(`${JSON.stringify(events, null, 2)}\n`);
      } else {
        process.stdout.write(renderTranscript(events));
      }
      return;
    } catch (err) {
      if (err instanceof TranscriptHttpError) {
        process.stderr.write(`pinagent transcript: ${err.message}\n`);
        // 400 → 2 (bad usage), 404 → 3 (not found), other → 1.
        if (err.status === 400) process.exit(2);
        if (err.status === 404) process.exit(3);
        process.exit(1);
      }
      throw err;
    }
  }

  process.stderr.write(`pinagent: unknown subcommand "${subcommand}"\n\n${HELP}`);
  process.exit(2);
}

main().catch((err) => {
  console.error('pinagent: fatal:', err);
  process.exit(1);
});
