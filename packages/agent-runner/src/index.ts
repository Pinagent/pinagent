// SPDX-License-Identifier: Apache-2.0
export const PACKAGE_NAME = '@pinagent/agent-runner';

export {
  type BulkReopenResult,
  computeWorktreeDiff,
  computeWorktreeStats,
  countWorktreeChanges,
  discardWorktree,
  hasActiveRun,
  interruptRun,
  type LandResult,
  mergeWorktree,
  reopenConversation,
  reopenConversations,
  resolveAgentMode,
  resolvePermissionMode,
  resolvePermissionModeOverride,
  runFollowUpTurn,
  type SpawnAgentMode,
  spawnAgent,
  toSdkPermissionMode,
  type WorktreeDiff,
  type WorktreeStats,
} from './agent';
export {
  ASK_USER_TOOL_NAME,
  createAskUserMcpServer,
  rejectAsk,
  resolveAsk,
} from './ask-user';
export {
  type AuditAction,
  type AuditActor,
  type AuditEventRecord,
  type ListAuditEventsOpts,
  listAuditEvents,
  type RecordAuditEventInput,
  recordAuditEvent,
} from './audit-log';
export {
  type BranchRecord,
  type BulkPruneBody,
  BulkPruneBodySchema,
  type BulkPruneResult,
  listBranches,
  type PruneResult,
  type PruneStaleResult,
  pruneBranch,
  pruneBranches,
  pruneStaleBranches,
} from './branches';
export { getOrCreateBus, type SqliteEventBus } from './bus';
export { type ChangeRecord, getChangeDiff, listChanges } from './changes';
export {
  type AnthropicValidation,
  type GithubValidation,
  validateAnthropicKey,
  validateGithubToken,
} from './connection-validators';
export {
  type ApplyPatchResult,
  applyBulkArchive,
  applyConversationPatch,
  type BulkArchiveResult,
  type BulkReopenBody,
  BulkReopenBodySchema,
  type BulkUpdateBody,
  BulkUpdateBodySchema,
} from './conversation-patch';
export { type OpenInEditorResult, openInEditor } from './editor';
export {
  type HistorySearchHit,
  type HistorySearchOpts,
  type HistoryStatusFilter,
  type MatchedField,
  searchHistory,
} from './history';
export {
  type ComposeOpts,
  ComposeOptsSchema,
  type ComposeResult,
  composePullRequest,
} from './pr-composer';
export {
  type AgentPermissionMode,
  type AgentProvider,
  type AgentRunRequest,
  ClaudeCodeProvider,
  CliAgentProvider,
  createProvider,
  type ProviderId,
  type ProviderRunItem,
  resolveProvider,
  resolveProviderId,
} from './providers';
export { listPullRequests, type PullRequestRecord } from './pull-requests';
export {
  type PresentableConnections,
  type SecretsFile,
  SecretsFileSchema,
  SecretsStore,
} from './secrets-store';
export {
  DEFAULT_SETTINGS,
  type PermissionMode,
  PermissionModeSchema,
  type ProjectSettings,
  type ProjectSettingsPatch,
  ProjectSettingsPatchSchema,
  ProjectSettingsSchema,
  SettingsStore,
} from './settings-store';
export {
  type FeedbackInput,
  FeedbackInputSchema,
  type FeedbackRecord,
  ID_RE,
  isInGitignore,
  isInsideRoot,
  type Patch,
  PatchSchema,
  type Status,
  StatusSchema,
  Storage,
  type WorktreeState,
  WorktreeStateSchema,
} from './storage';
export { startWsServer } from './ws-server';
