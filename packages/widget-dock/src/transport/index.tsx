// SPDX-License-Identifier: Apache-2.0
/**
 * Transport context + provider. The whole React tree reads from one
 * `DockTransport` via `useTransport()`; tests and the mocked dev
 * preview swap the implementation at the root.
 */
import { createContext, type ReactNode, useContext } from 'react';
import { LocalTransport } from './local';
import { MockTransport } from './mock';
import type { DockTransport } from './types';

const TransportContext = createContext<DockTransport | null>(null);

export interface TransportProviderProps {
  /**
   * If omitted, defaults to `LocalTransport` for production-shaped
   * usage. The dev preview passes `MockTransport` when the URL has
   * `?fixtures=on`.
   */
  transport?: DockTransport;
  children: ReactNode;
}

export function TransportProvider({ transport, children }: TransportProviderProps) {
  const value = transport ?? new LocalTransport();
  return <TransportContext.Provider value={value}>{children}</TransportContext.Provider>;
}

export function useTransport(): DockTransport {
  const transport = useContext(TransportContext);
  if (!transport) {
    throw new Error('useTransport must be used within a <TransportProvider>');
  }
  return transport;
}

export type {
  AuditAction,
  AuditActor,
  AuditEvent,
  ChangeDiff,
  ConversationDetail,
  ConversationFilters,
  CreatePullRequestInput,
  CreatePullRequestResult,
  DockProjectSettings,
  DockTransport,
  HistoryMatchedField,
  HistorySearchHit,
  HistorySearchQuery,
  ListAuditEventsQuery,
  PresentableConnections,
  PruneStaleResult,
} from './types';
export type {
  ConnectionStatus,
  ConversationHandlers,
  WorktreeStatePayload,
} from './ws-client';
export { LocalTransport, MockTransport };
