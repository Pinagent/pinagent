// SPDX-License-Identifier: Apache-2.0
export const PACKAGE_NAME = '@pinagent/shared';

export {
  type AuditActor,
  AuditActorSchema,
  type AuditEvent,
  AuditEventSchema,
  type HistoryMatchedField,
  HistoryMatchedFieldSchema,
  type HistorySearchHit,
  HistorySearchHitSchema,
} from './dock-api';
export {
  type DockToHost,
  DockToHostSchema,
  type HostToDock,
  HostToDockSchema,
} from './dock-postmessage';
export { type AgentEvent, AgentEventSchema, type BusSubscriber } from './event-bus';
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
