// SPDX-License-Identifier: Apache-2.0
/**
 * Subscribe to VSCode-extension presence over the dock's shared WS
 * connection. Returns whether the editor bridge is installed/running,
 * its reported version, and a `known` flag that stays false until the
 * first snapshot arrives — so callers can avoid flashing the
 * "not installed" nudge before the server has had a chance to answer.
 */
import { useEffect, useState } from 'react';
import { type ExtensionStatus, useTransport } from '../transport';

export interface ExtensionStatusResult {
  /** True once at least one extension socket is connected. */
  present: boolean;
  /** Reported extension version, when an extension is connected. */
  version: string | null;
  /** False until the first presence snapshot lands. */
  known: boolean;
}

export function useExtensionStatus(): ExtensionStatusResult {
  const transport = useTransport();
  const [status, setStatus] = useState<ExtensionStatus | null>(null);

  useEffect(() => {
    // Reset on transport swap so a stale snapshot from the previous
    // transport doesn't leak across (e.g. mock → local in the dev preview).
    setStatus(null);
    return transport.subscribeExtensionStatus(setStatus);
  }, [transport]);

  return {
    present: status?.present ?? false,
    version: status?.version ?? null,
    known: status !== null,
  };
}
