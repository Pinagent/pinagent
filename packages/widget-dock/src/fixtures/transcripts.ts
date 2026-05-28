// SPDX-License-Identifier: Apache-2.0
/**
 * Per-fixture-conversation transcript stand-ins for `MockTransport`.
 *
 * Mock mode has no live agent + no SQLite-backed bus, so until this
 * map landed, opening a fixture conversation in `?fixtures=on` showed
 * an empty transcript — fine before the dock prefetched messages
 * over HTTP, awkward now that `useConversationStream` calls
 * `getConversationMessages` on mount.
 *
 * Coverage is intentionally partial. The transcripts here are chosen
 * to walk a reviewer through the main shapes (init → text → tool_use
 * → tool_result, plus `ask_user`, `error`, `result`, lifecycle
 * `status_changed`); conversations not listed return `[]` and look
 * the same as a fresh run, which is also a legitimate demo state.
 */
import type { AgentEvent } from '@pinagent/shared';

const INIT: AgentEvent = {
  type: 'init',
  sessionId: 'sess-fixture',
  model: 'claude-opus-4-7',
  permissionMode: 'acceptEdits',
  apiKeySource: 'oauth',
};

/**
 * Keyed on `Conversation.id` (`cv_01` etc.). Missing ids → empty
 * transcript; same shape as a brand-new conversation pre-spawn.
 */
export const FIXTURE_TRANSCRIPTS: Record<string, AgentEvent[]> = {
  // Working — agent is mid-task, no terminal `result` yet.
  cv_01: [
    INIT,
    {
      type: 'text',
      text: 'Looking at the hero headline. Pulling the current copy + brand voice notes.',
    },
    { type: 'tool_use', name: 'Read', summary: 'src/marketing/Hero.tsx' },
    { type: 'tool_result', ok: true },
    { type: 'text', text: 'Trying three variations now — will reply with options shortly.' },
  ],

  // Awaiting clarification — agent paused on ask_user.
  cv_02: [
    INIT,
    {
      type: 'text',
      text: 'I can re-style the pricing grid to highlight one tier as the recommended one.',
    },
    {
      type: 'ask_user',
      askId: 'ask-fixture-cv_02',
      question: 'Which tier should the highlighted column be?',
      options: ['Pro', 'Business'],
    },
  ],

  // Ready to land — agent finished, transcript ends in `result`.
  cv_03: [
    INIT,
    { type: 'text', text: 'Adding GitHub, LinkedIn, and X to the footer links row.' },
    { type: 'tool_use', name: 'Edit', summary: 'src/layout/Footer.tsx — add social links nav' },
    { type: 'tool_result', ok: true },
    { type: 'text', text: 'Matched the existing footer rhythm. Ready to land.' },
    {
      type: 'result',
      subtype: 'success',
      numTurns: 4,
      totalCostUsd: 0.012,
      durationMs: 8_400,
    },
  ],

  // Landed — terminal result + a status_changed flip.
  cv_06: [
    INIT,
    { type: 'text', text: 'Regrouping the settings page so billing fields live together.' },
    { type: 'tool_use', name: 'Edit', summary: 'src/app/settings/SettingsPage.tsx' },
    { type: 'tool_result', ok: true },
    { type: 'text', text: 'Pulled the four billing fields into one section.' },
    {
      type: 'result',
      subtype: 'success',
      numTurns: 5,
      totalCostUsd: 0.018,
      durationMs: 12_100,
    },
    {
      type: 'status_changed',
      status: 'fixed',
      note: 'Landed to main in commit a91f3c.',
      commitSha: 'a91f3c5e0',
      resolvedAt: new Date(Date.parse('2026-05-25T18:00:00Z')).toISOString(),
    },
  ],

  // Error path — agent run hit a transient API failure.
  cv_08: [
    INIT,
    { type: 'text', text: 'Investigating the collapsed mobile menu cutoff.' },
    {
      type: 'error',
      message: 'Anthropic 429 (rate limit) — retry queued.',
    },
  ],
};
