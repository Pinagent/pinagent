// SPDX-License-Identifier: Apache-2.0
export const PACKAGE_NAME = '@pinagent/shared';

export {
  type AuditActor,
  AuditActorSchema,
  type AuditEvent,
  AuditEventSchema,
  type Branch,
  BranchSchema,
  type Change,
  type ChangeDiff,
  ChangeDiffSchema,
  ChangeSchema,
  type Conversation,
  type ConversationDetail,
  ConversationDetailSchema,
  ConversationSchema,
  type DockProjectSettings,
  DockProjectSettingsSchema,
  type HistoryMatchedField,
  HistoryMatchedFieldSchema,
  type HistorySearchHit,
  HistorySearchHitSchema,
  type PermissionMode,
  PermissionModeSchema,
  PROJECT_PERMISSION_MODES,
  type PresentableConnections,
  PresentableConnectionsSchema,
  type ProjectPermissionModeMeta,
  type PruneStaleResult,
  PruneStaleResultSchema,
  type PullRequest,
  PullRequestSchema,
  type StatusKey,
  StatusKeySchema,
} from './dock-api';
export {
  type DockToHost,
  DockToHostSchema,
  type HostToDock,
  HostToDockSchema,
} from './dock-postmessage';
export {
  deriveDockStatus,
  isUnresolvedStatus,
  type ServerStatus,
  type ServerWorktreeState,
} from './dock-status';
export {
  type AgentEvent,
  AgentEventSchema,
  type BusSubscriber,
  isNotionalCost,
} from './event-bus';
export { renderTranscript } from './render-transcript';
export {
  type ClientMessage,
  ClientMessageSchema,
  type ProjectEvent,
  ProjectEventSchema,
  type ServerMessage,
  ServerMessageSchema,
  type WorktreeWireState,
  WorktreeWireStateSchema,
} from './ws-protocol';
