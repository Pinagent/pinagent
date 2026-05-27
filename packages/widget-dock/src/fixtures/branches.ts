// SPDX-License-Identifier: Apache-2.0
import type { Branch } from './types';

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;
const NOW = Date.parse('2026-05-26T22:30:00Z');
const isoDelta = (ms: number) => new Date(NOW - ms).toISOString();

export const FIXTURE_BRANCHES: Branch[] = [
  {
    id: 'br_01',
    name: 'pinagent/hero-copy-8a2f',
    conversationId: 'cv_01',
    conversationTitle: 'Hero CTA — tighten the headline copy',
    createdAt: isoDelta(45 * 60 * 1000),
    lastActivity: isoDelta(2 * 60 * 1000),
    state: 'uncommitted',
    diskMb: 42,
  },
  {
    id: 'br_02',
    name: 'pinagent/footer-social-e09c',
    conversationId: 'cv_03',
    conversationTitle: 'Footer — add social links row',
    createdAt: isoDelta(2 * HOURS),
    lastActivity: isoDelta(45 * 60 * 1000),
    state: 'clean',
    diskMb: 38,
  },
  {
    id: 'br_03',
    name: 'pinagent/signup-pw-22b1',
    conversationId: 'cv_04',
    conversationTitle: 'Sign-up form — surface password rules earlier',
    createdAt: isoDelta(3 * HOURS),
    lastActivity: isoDelta(2 * HOURS),
    state: 'clean',
    diskMb: 41,
  },
  {
    id: 'br_04',
    name: 'pinagent/search-recent-6bb3',
    conversationId: 'cv_11',
    conversationTitle: 'Search input — show last 5 queries',
    createdAt: isoDelta(20 * 60 * 1000),
    lastActivity: isoDelta(8 * 60 * 1000),
    state: 'uncommitted',
    diskMb: 44,
  },
  {
    id: 'br_05',
    name: 'pinagent/faq-refunds-d840',
    conversationId: 'cv_12',
    conversationTitle: 'Pricing FAQ — add refund policy entry',
    createdAt: isoDelta(90 * 60 * 1000),
    lastActivity: isoDelta(50 * 60 * 1000),
    state: 'behind-base',
    diskMb: 39,
  },
  {
    id: 'br_06',
    name: 'pinagent/stale-experiment-04ee',
    conversationId: null,
    conversationTitle: null,
    createdAt: isoDelta(9 * DAYS),
    lastActivity: isoDelta(8 * DAYS),
    state: 'behind-base',
    diskMb: 36,
  },
];
