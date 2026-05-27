// SPDX-License-Identifier: Apache-2.0
export const PACKAGE_NAME = '@pinagent/shared';

export type { AgentEvent, BusSubscriber } from './event-bus';

export {
  type ClientMessage,
  ClientMessageSchema,
  type ProjectEvent,
  type ServerMessage,
  type WorktreeWireState,
} from './ws-protocol';
