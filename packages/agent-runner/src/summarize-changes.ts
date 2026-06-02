// SPDX-License-Identifier: Apache-2.0
/**
 * `summarizeChangesForPr` — run a one-shot Claude Agent SDK query that turns
 * the current branch's diff into a PR title + markdown body. Used by the
 * dock dashboard's "Create PR" button, where there's no connected agent to
 * write the description (the MCP `create_pull_request` path instead has the
 * caller supply title/body, so it never needs this).
 *
 * This is the ONLY PR module that imports `@anthropic-ai/claude-agent-sdk`.
 * Keeping it separate from `host-branch-pr.ts` / `github-pr.ts` is what lets
 * the `@pinagent/mcp` binary import the PR-open core without the SDK.
 */
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { runGitCapture } from './git-utils';
import { SecretsStore } from './secrets-store';
import { SettingsStore } from './settings-store';

export interface PrSummary {
  title: string;
  body: string;
}

/** Cap the diff we feed the model so a huge churn doesn't blow the prompt. */
const DIFF_CAP_BYTES = 60 * 1024;

const SYSTEM_PROMPT = [
  'You write pull-request descriptions for Pinagent, a click-to-fix dev tool.',
  'You are given a git diff and commit log for a feature branch.',
  'Respond with ONLY a single JSON object, no prose, no code fences:',
  '{ "title": "<concise PR title, <70 chars, imperative mood>",',
  '  "body": "<GitHub-flavored markdown PR description>" }',
  'The body should open with a one-paragraph summary, then a "## Changes"',
  'section with bullet points of what changed and why. Keep it factual and',
  'grounded in the diff. End the body with the line:',
  '🤖 Generated with Pinagent',
].join('\n');

/**
 * Extract `{ title, body }` from the model's response. Prefers a JSON object
 * anywhere in the text; falls back to first-line-as-title / rest-as-body so
 * a non-JSON answer still produces a usable PR. Exported for unit testing.
 */
export function parsePrSummary(text: string): PrSummary {
  const trimmed = text.trim();
  // Find the first balanced-looking JSON object and try to parse it.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const candidate = trimmed.slice(start, end + 1);
    try {
      const parsed = JSON.parse(candidate) as { title?: unknown; body?: unknown };
      const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
      const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
      if (title) return { title, body: body || title };
    } catch {
      // fall through to the line-based fallback
    }
  }
  const lines = trimmed.split('\n');
  const title = (lines[0] ?? '').replace(/^#+\s*/, '').trim() || 'Update';
  const body = lines.slice(1).join('\n').trim() || title;
  return { title, body };
}

/** Gather the diff + commit context the summarizer reasons over. */
async function gatherContext(projectRoot: string): Promise<string> {
  const { baseBranch } = await new SettingsStore(projectRoot).read();
  const mb = await runGitCapture(projectRoot, ['merge-base', baseBranch, 'HEAD']);
  const compareTo = mb.code === 0 ? mb.stdout.trim() : baseBranch;

  const stat = await runGitCapture(projectRoot, ['diff', '--stat', compareTo]);
  const log = await runGitCapture(projectRoot, ['log', '--oneline', `${compareTo}..HEAD`]);
  const diff = await runGitCapture(projectRoot, ['diff', '--no-color', compareTo]);

  let diffText = diff.code === 0 ? diff.stdout : '';
  let truncatedNote = '';
  if (diffText.length > DIFF_CAP_BYTES) {
    const cut = diffText.lastIndexOf('\n', DIFF_CAP_BYTES);
    diffText = diffText.slice(0, cut >= 0 ? cut : DIFF_CAP_BYTES);
    truncatedNote = '\n\n[diff truncated — summarize from the portion shown plus the stat]';
  }

  return [
    `Base branch: ${baseBranch}`,
    '',
    '## Commits',
    log.code === 0 && log.stdout.trim() ? log.stdout.trim() : '(no commits ahead of base)',
    '',
    '## Diffstat',
    stat.stdout.trim() || '(no changes)',
    '',
    '## Diff',
    diffText || '(empty)',
    truncatedNote,
  ].join('\n');
}

/**
 * Produce a PR title + body for the current branch. Throws if the SDK run
 * yields no text (caller surfaces that as a failed Create-PR).
 */
export async function summarizeChangesForPr(projectRoot: string): Promise<PrSummary> {
  const context = await gatherContext(projectRoot);

  const env: Record<string, string | undefined> = { ...process.env };
  // Dock-stored Anthropic key wins over an existing env var, matching the
  // spawned-agent path (providers/claude-code.ts).
  const storedKey = await new SecretsStore(projectRoot).getAnthropicKey();
  if (storedKey) env.ANTHROPIC_API_KEY = storedKey;

  let text = '';
  for await (const message of query({
    prompt: `Write a PR description for these changes.\n\n${context}`,
    options: {
      cwd: projectRoot,
      env,
      // No project/user settings, no MCP, no tools — a focused single-shot
      // text generation over the context we already gathered.
      settingSources: [],
      allowedTools: [],
      systemPrompt: SYSTEM_PROMPT,
    },
  }) as AsyncIterable<SDKMessage>) {
    if (message.type === 'assistant') {
      const blocks = message.message?.content;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block.type === 'text' && block.text) text += block.text;
        }
      }
    }
  }

  if (!text.trim()) {
    throw new Error('summarizer returned no text — check the Anthropic API key in Connections');
  }
  return parsePrSummary(text);
}
