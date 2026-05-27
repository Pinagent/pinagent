// SPDX-License-Identifier: Apache-2.0
import type { AnthropicConnection, GitHubConnection, ProjectSettings } from './types';

export const FIXTURE_GITHUB: GitHubConnection = {
  connected: true,
  account: 'jacksonmalloy',
  repos: [
    { name: 'example/site', private: true },
    { name: 'example/marketing', private: true },
    { name: 'example/sdk', private: false },
  ],
};

export const FIXTURE_ANTHROPIC: AnthropicConnection = {
  mode: 'byo',
  keySet: true,
  monthUsageUsd: 18.42,
  monthBudgetUsd: 100,
};

export const FIXTURE_SETTINGS: ProjectSettings = {
  baseBranch: 'main',
  worktreeRetentionDays: 7,
  perConversationCapUsd: 5,
  monthlyBudgetUsd: 100,
  permissionMode: 'auto',
};
