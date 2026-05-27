// SPDX-License-Identifier: Apache-2.0
export const PACKAGE_NAME = '@pinagent/agent-runner';

export {
  computeWorktreeDiff,
  computeWorktreeStats,
  countWorktreeChanges,
  discardWorktree,
  hasActiveRun,
  interruptRun,
  type LandResult,
  mergeWorktree,
  resolveAgentMode,
  resolvePermissionMode,
  runFollowUpTurn,
  type SpawnAgentMode,
  spawnAgent,
  type WorktreeDiff,
  type WorktreeStats,
} from './agent';
export {
  ASK_USER_TOOL_NAME,
  createAskUserMcpServer,
  rejectAsk,
  resolveAsk,
} from './ask-user';
export { type BranchRecord, listBranches } from './branches';
export { type ChangeRecord, getChangeDiff, listChanges } from './changes';
export { type OpenInEditorResult, openInEditor } from './editor';
export {
  type ComposeOpts,
  ComposeOptsSchema,
  type ComposeResult,
  composePullRequest,
} from './pr-composer';
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
