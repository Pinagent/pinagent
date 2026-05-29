// SPDX-License-Identifier: Apache-2.0
/**
 * Status derivation now lives in @pinagent/shared so the browser widget
 * (running-agents tray) and the dock agree on one mapping. Re-exported
 * here to keep the dock's existing `transport/status-derive` import sites
 * stable.
 */
export { deriveDockStatus } from '@pinagent/shared';
