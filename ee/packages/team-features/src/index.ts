// SPDX-License-Identifier: Elastic-2.0
export const PACKAGE_NAME = '@pinagent/ee-team-features';

export {
  AUDIT_ACTIONS,
  type AuditEvent,
  type AuditQuery,
  type AuditSink,
  createInMemoryAuditSink,
  DEFAULT_AUDIT_LIMIT,
} from './audit';
