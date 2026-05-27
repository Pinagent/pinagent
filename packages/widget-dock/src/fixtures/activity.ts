// SPDX-License-Identifier: Apache-2.0
import type { ActivityEvent } from './types';

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;
const NOW = Date.parse('2026-05-26T22:30:00Z');
const isoDelta = (ms: number) => new Date(NOW - ms).toISOString();

export const FIXTURE_ACTIVITY: ActivityEvent[] = [
  {
    id: 'ev_01',
    type: 'conversation_created',
    conversationId: 'cv_01',
    conversationTitle: 'Hero CTA — tighten the headline copy',
    at: isoDelta(2 * 60 * 1000),
  },
  {
    id: 'ev_02',
    type: 'conversation_updated',
    conversationId: 'cv_02',
    conversationTitle: 'Pricing table — make Pro tier easier to compare',
    at: isoDelta(17 * 60 * 1000),
  },
  {
    id: 'ev_03',
    type: 'conversation_updated',
    conversationId: 'cv_03',
    conversationTitle: 'Footer — add social links row',
    at: isoDelta(45 * 60 * 1000),
  },
  {
    id: 'ev_04',
    type: 'pr_created',
    prNumber: 412,
    branch: 'pinagent/batch-marketing-3a8e',
    at: isoDelta(4 * HOURS),
  },
  {
    id: 'ev_05',
    type: 'conversation_landed',
    conversationId: 'cv_06',
    conversationTitle: 'Settings — group billing fields together',
    at: isoDelta(28 * HOURS),
  },
  {
    id: 'ev_06',
    type: 'pr_merged',
    prNumber: 408,
    branch: 'pinagent/auth-typeahead-71b2',
    at: isoDelta(2 * DAYS),
  },
  {
    id: 'ev_07',
    type: 'worktree_pruned',
    branch: 'pinagent/stale-experiment-04ee',
    at: isoDelta(3 * DAYS),
  },
];
