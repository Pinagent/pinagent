# Security Policy

## Supported versions

Pinagent is pre-1.0. Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Email `jacksmalloy@gmail.com` with:

- A description of the issue and its impact.
- Steps to reproduce, ideally a minimal repro.
- The version, commit SHA, or branch you tested against.
- Whether the issue is already public, and if so, where.

You should receive an acknowledgement within 72 hours. We aim to ship a fix or a
documented mitigation within 30 days of a confirmed report. If a fix needs a CVE
we'll request one and credit you in the advisory (or keep you anonymous, your
choice).

## Scope

Pinagent runs locally on a developer's own machine and binds to `127.0.0.1` only.
The trust boundary is the developer's user account. Reports we care about most:

- Anything that lets a remote origin reach the dev-time middleware or MCP server.
- Path traversal / arbitrary file read or write under the project root.
- Command injection in the agent runtime or git-touching code.
- Bypasses of the localhost binding, the SQLite source-of-truth boundary
  (`.pinagent/db.sqlite`), or the iframe sandbox.

Reports about social-engineering an end user into running malicious code on
their own machine are generally out of scope unless they reveal a real bug in
how Pinagent handles input.
