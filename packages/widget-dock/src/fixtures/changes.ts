// SPDX-License-Identifier: Apache-2.0
import type { Change } from './types';

const HOURS = 60 * 60 * 1000;
const NOW = Date.parse('2026-05-26T22:30:00Z');
const isoDelta = (ms: number) => new Date(NOW - ms).toISOString();

export const FIXTURE_CHANGES: Change[] = [
  {
    id: 'ch_01',
    conversationId: 'cv_03',
    conversationTitle: 'Footer — add social links row',
    status: 'readyToLand',
    filesChanged: 2,
    additions: 34,
    deletions: 4,
    preview:
      '+ <a href="https://github.com/pinagent" aria-label="GitHub">\n+   <GithubIcon className="h-4 w-4" />\n+ </a>',
    updatedAt: isoDelta(45 * 60 * 1000),
  },
  {
    id: 'ch_02',
    conversationId: 'cv_04',
    conversationTitle: 'Sign-up form — surface password rules earlier',
    status: 'readyToLand',
    filesChanged: 1,
    additions: 18,
    deletions: 6,
    preview:
      '- <p className="text-error">Password too short.</p>\n+ <PasswordRules onFocus visible={focused} />',
    updatedAt: isoDelta(2 * HOURS),
  },
  {
    id: 'ch_03',
    conversationId: 'cv_12',
    conversationTitle: 'Pricing FAQ — add refund policy entry',
    status: 'readyToLand',
    filesChanged: 1,
    additions: 12,
    deletions: 0,
    preview:
      '+ {\n+   q: "What\'s your refund policy?",\n+   a: "Full refund within 30 days. See /support/refunds.",\n+ }',
    updatedAt: isoDelta(50 * 60 * 1000),
  },
  {
    id: 'ch_04',
    conversationId: 'cv_05',
    conversationTitle: 'Dashboard greeting — pull user name into header',
    status: 'pending',
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    preview: '(no changes yet — agent hasn\'t started this conversation)',
    updatedAt: isoDelta(3 * HOURS),
  },
  {
    id: 'ch_05',
    conversationId: 'cv_08',
    conversationTitle: 'Mobile nav — collapsed menu cuts off on small phones',
    status: 'error',
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    preview: '(agent failed before producing changes — see conversation for details)',
    updatedAt: isoDelta(40 * 60 * 1000),
  },
];
