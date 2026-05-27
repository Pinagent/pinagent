// SPDX-License-Identifier: Apache-2.0
import type { PullRequest } from './types';

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;
const NOW = Date.parse('2026-05-26T22:30:00Z');
const isoDelta = (ms: number) => new Date(NOW - ms).toISOString();

export const FIXTURE_PRS: PullRequest[] = [
  {
    id: 'pr_01',
    number: 412,
    title: 'Marketing site polish — hero copy + pricing CTA',
    state: 'open',
    branch: 'pinagent/batch-marketing-3a8e',
    baseBranch: 'main',
    url: 'https://github.com/example/site/pull/412',
    updatedAt: isoDelta(4 * HOURS),
    conversationIds: ['cv_01', 'cv_02'],
  },
  {
    id: 'pr_02',
    number: 411,
    title: 'Footer: social links row',
    state: 'draft',
    branch: 'pinagent/footer-social-e09c',
    baseBranch: 'main',
    url: 'https://github.com/example/site/pull/411',
    updatedAt: isoDelta(45 * 60 * 1000),
    conversationIds: ['cv_03'],
  },
  {
    id: 'pr_03',
    number: 410,
    title: 'Settings: regroup billing fields',
    state: 'merged',
    branch: 'pinagent/settings-billing-15aa',
    baseBranch: 'main',
    url: 'https://github.com/example/site/pull/410',
    updatedAt: isoDelta(28 * HOURS),
    conversationIds: ['cv_06'],
  },
  {
    id: 'pr_04',
    number: 408,
    title: 'Auth: typeahead in email field',
    state: 'merged',
    branch: 'pinagent/auth-typeahead-71b2',
    baseBranch: 'main',
    url: 'https://github.com/example/site/pull/408',
    updatedAt: isoDelta(2 * DAYS),
    conversationIds: [],
  },
  {
    id: 'pr_05',
    number: 405,
    title: 'Onboarding role step — context copy',
    state: 'closed',
    branch: 'pinagent/onboarding-role-a571',
    baseBranch: 'main',
    url: 'https://github.com/example/site/pull/405',
    updatedAt: isoDelta(5 * DAYS),
    conversationIds: ['cv_09'],
  },
];
