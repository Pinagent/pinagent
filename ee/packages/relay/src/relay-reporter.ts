// SPDX-License-Identifier: Elastic-2.0
import type { RelayLifecycleEvent } from './relay-events';

/**
 * Reports relay lifecycle events to the control-plane ingest endpoint — the
 * sending half of the relay→cloud channel. Best-effort by design: a disabled
 * config (`null`) or any network error is swallowed, because the relay must
 * keep routing even if the control plane is unreachable.
 */

export interface RelayReporterConfig {
  /** Full ingest URL, e.g. `https://cloud.pinagent.dev/internal/relay/events`. */
  ingestUrl: string;
  /** Shared secret presented as a bearer token. */
  secret: string;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface RelayReporter {
  report(event: RelayLifecycleEvent): Promise<void>;
}

export function createRelayReporter(
  config: RelayReporterConfig | null,
  fetchFn: FetchFn = (url, init) => fetch(url, init),
): RelayReporter {
  return {
    async report(event: RelayLifecycleEvent): Promise<void> {
      if (!config) return;
      try {
        await fetchFn(config.ingestUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.secret}`,
          },
          body: JSON.stringify({ events: [event] }),
        });
      } catch {
        // Best-effort; never let reporting break the relay.
      }
    },
  };
}

/**
 * Build reporter config from the Worker env, or `null` when reporting isn't
 * configured (dev/local) — in which case the reporter is a no-op.
 */
export function relayReporterConfigFromEnv(env: {
  PINAGENT_CONTROL_PLANE_URL?: string;
  RELAY_INTERNAL_SECRET?: string;
}): RelayReporterConfig | null {
  if (!env.PINAGENT_CONTROL_PLANE_URL || !env.RELAY_INTERNAL_SECRET) return null;
  const base = env.PINAGENT_CONTROL_PLANE_URL.replace(/\/+$/, '');
  return { ingestUrl: `${base}/internal/relay/events`, secret: env.RELAY_INTERNAL_SECRET };
}
