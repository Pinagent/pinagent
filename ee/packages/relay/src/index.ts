// SPDX-License-Identifier: Elastic-2.0
export const PACKAGE_NAME = '@pinagent/ee-relay';

export {
  isRelayEventType,
  MAX_RELAY_EVENT_BATCH,
  parseRelayEventBatch,
  type RelayEventType,
  type RelayLifecycleEvent,
} from './relay-events';
export type { ClientAttachment, RelayLogger, RelaySocket } from './relay-hub';
// Runtime-agnostic core. The Cloudflare deploy artifacts (`worker.ts`,
// `relay-do.ts`) are bundled by wrangler from `src/worker.ts` and are not
// part of the library build — importers compose the relay via the hub or
// reach the Worker over a service binding.
export { RelayHub } from './relay-hub';
