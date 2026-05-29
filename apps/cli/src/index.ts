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
//   pinagent list          List the feedback queue from a running
//                          dev-server (status/file filters, --json).
//   pinagent resolve       Mark a feedback item fixed/wontfix/deferred
//                          (or re-open) against a running dev-server.
//   pinagent transcript    Fetch + print the persisted agent transcript
//                          for one conversation from a running dev-server.
//
// There is intentionally no `pinagent dev`: pinagent has no standalone
// server. It runs as a plugin inside the host app's own dev server
// (`vite` / `next dev`), so the way to "start pinagent" is to wire the
// plugin in (see `pinagent init`) and run your existing dev command.

import { startMcpServer } from '@pinagent/mcp';
import {
  fetchFeedbackList,
  filterFeedback,
  parseListArgs,
  parseResolveArgs,
  patchFeedbackStatus,
  renderFeedbackList,
  renderResolveResult,
} from './feedback';
import { HttpError } from './http';
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
                     Vite vs Next automatically. Idempotent.

                     Options:
                       --dir <path>   Project root to scaffold. Defaults
                                      to the current directory.
                       --dry-run, -n  Print the plan without writing files.

  mcp                Start the stdio MCP server. Configure your coding
                     agent (Claude Code, etc.) to spawn this command so it
                     can read pending feedback, screenshots, and source
                     context from a running Pinagent dev session.

  list               List the feedback queue from a running pinagent
                     dev-server. Shows id, status, file:line, and the
                     comment. Archived items are hidden unless --all.

                     Options:
                       --status <s>    Filter by pending | fixed |
                                       wontfix | deferred.
                       --file <substr> Filter by file path substring.
                       --all, -a       Include archived items.
                       --server <url>  Base URL of the dev-server.
                       --json          Emit raw JSON instead of a table.

  resolve <id>       Mark a feedback item fixed, wontfix, or deferred
                     against a running dev-server (or re-open it with
                     --status pending). Drives the queue headlessly,
                     without an MCP session.

                     Options:
                       --status <s>    Required: pending | fixed |
                                       wontfix | deferred.
                       --note <text>   Optional resolution note.
                       --commit <sha>  Optional commit sha to record.
                       --server <url>  Base URL of the dev-server.
                       --json          Emit the updated record as JSON.

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
  PINAGENT_SERVER_URL    Default dev-server URL for the HTTP commands
                         (\`list\`, \`resolve\`, \`transcript\`).
`;

/** Map an HttpError status to the CLI's exit-code convention. */
function httpExitCode(status: number): number {
  if (status === 400) return 2; // bad usage
  if (status === 404) return 3; // not found
  return 1; // network / unexpected
}

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

  if (subcommand === 'list') {
    const parsed = parseListArgs(rest);
    if ('error' in parsed) {
      process.stderr.write(`pinagent list: ${parsed.error}\n\n${HELP}`);
      process.exit(2);
    }
    try {
      const rows = filterFeedback(await fetchFeedbackList(parsed.serverUrl), parsed);
      if (parsed.json) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      } else {
        process.stdout.write(renderFeedbackList(rows));
      }
      return;
    } catch (err) {
      if (err instanceof HttpError) {
        process.stderr.write(`pinagent list: ${err.message}\n`);
        process.exit(httpExitCode(err.status));
      }
      throw err;
    }
  }

  if (subcommand === 'resolve') {
    const parsed = parseResolveArgs(rest);
    if ('error' in parsed) {
      process.stderr.write(`pinagent resolve: ${parsed.error}\n\n${HELP}`);
      process.exit(2);
    }
    try {
      const row = await patchFeedbackStatus(parsed);
      if (parsed.json) {
        process.stdout.write(`${JSON.stringify(row, null, 2)}\n`);
      } else {
        process.stdout.write(renderResolveResult(row));
      }
      return;
    } catch (err) {
      if (err instanceof HttpError) {
        process.stderr.write(`pinagent resolve: ${err.message}\n`);
        process.exit(httpExitCode(err.status));
      }
      throw err;
    }
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
