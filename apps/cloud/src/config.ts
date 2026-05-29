// SPDX-License-Identifier: Elastic-2.0

/**
 * Cloud runtime configuration, read from the environment at the composition
 * root. Kept separate from the request handler so the handler stays a pure,
 * fully-injected function (see `session-service.ts`).
 */
export interface CloudConfig {
  /** HMAC secret shared with the relay for signing session tokens. */
  relayAuthSecret: string;
  /** Public wss URL of the relay, handed to clients in the session response. */
  relayPublicUrl: string;
  /** Optional session-token lifetime override, in seconds. */
  sessionTtlSeconds?: number;
}

/**
 * Build {@link CloudConfig} from an env bag (e.g. `process.env` or a Worker
 * `Env`). Throws on missing required values so a misconfigured deploy fails
 * at boot rather than minting unverifiable tokens.
 */
export function loadCloudConfig(env: Record<string, string | undefined>): CloudConfig {
  const relayAuthSecret = required(env, 'RELAY_AUTH_SECRET');
  const relayPublicUrl = required(env, 'PINAGENT_RELAY_PUBLIC_URL');

  const ttlRaw = env.SESSION_TTL_SECONDS;
  let sessionTtlSeconds: number | undefined;
  if (ttlRaw !== undefined) {
    const parsed = Number(ttlRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`SESSION_TTL_SECONDS must be a positive integer, got "${ttlRaw}"`);
    }
    sessionTtlSeconds = parsed;
  }

  return { relayAuthSecret, relayPublicUrl, sessionTtlSeconds };
}

function required(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}
