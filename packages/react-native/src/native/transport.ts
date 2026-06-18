// SPDX-License-Identifier: Apache-2.0
/**
 * POST the assembled feedback to the Metro dev server.
 *
 * The web widget POSTs to a same-origin `/__pinagent/feedback`. RN has no
 * origin, so we derive the dev-server base from the bundle URL
 * (`NativeModules.SourceCode.scriptURL`) — that's the host Metro is
 * already serving from, which also resolves the awkward cases for free:
 * a physical device gets the LAN host, the iOS simulator gets localhost,
 * the Android emulator gets `10.0.2.2`. No hard-coded host needed.
 */
import { NativeModules, Platform } from 'react-native';
import type { RestoreCandidate } from './restore';
import type { FeedbackInput } from './types';

interface DevServerInfo {
  url?: string;
  bundleLoadedFromServer?: boolean;
}

let cachedGetDevServer: (() => DevServerInfo) | null | undefined;

/**
 * RN's own dev-server resolver. It reads the `NativeSourceCode` **TurboModule**,
 * which — unlike the legacy `NativeModules.SourceCode` bridge proxy — is
 * populated under the New Architecture (bridgeless, RN 0.82+, the only mode RN
 * ships now). Lazy + cached: a release build (widget `__DEV__`-gated away)
 * never reaches into RN internals. `require` takes a static string literal —
 * Metro forbids `require(variable)`.
 */
function loadGetDevServer(): (() => DevServerInfo) | null {
  if (cachedGetDevServer !== undefined) return cachedGetDevServer;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const mod = require('react-native/Libraries/Core/Devtools/getDevServer');
    const fn = (mod as { default?: unknown })?.default ?? mod;
    cachedGetDevServer = typeof fn === 'function' ? (fn as () => DevServerInfo) : null;
  } catch {
    cachedGetDevServer = null;
  }
  return cachedGetDevServer;
}

/**
 * Parse `http://192.168.1.5:8081/index.bundle?...` (or the RN packager's
 * variants) down to `http://192.168.1.5:8081`. Returns null in release builds,
 * where no Metro server is reachable.
 *
 * Prefers RN's `getDevServer()` (TurboModule-backed, works under the New
 * Architecture) and falls back to the legacy `NativeModules.SourceCode.scriptURL`
 * for pre-bridgeless RN. The legacy proxy is empty under bridgeless, which is
 * what made every submit fail with "No dev server" on RN 0.82+.
 */
export function devServerBaseUrl(): string | null {
  const getDevServer = loadGetDevServer();
  if (getDevServer) {
    try {
      const info = getDevServer();
      // `bundleLoadedFromServer` is false in release builds (url defaults to
      // localhost:8081 there, so the url alone can't be trusted).
      if (info?.url && info.bundleLoadedFromServer !== false) {
        const m = /^(https?:\/\/[^/]+)/.exec(info.url);
        if (m) return m[1]!;
      }
    } catch {
      // Fall through to the legacy bridge read.
    }
  }
  const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
  if (!scriptURL) return null;
  const match = /^(https?:\/\/[^/]+)/.exec(scriptURL);
  return match ? match[1]! : null;
}

export interface SubmitResult {
  ok: boolean;
  id?: string;
  agentSpawned?: boolean;
  error?: string;
}

/**
 * Send one comment. Mirrors the web widget's POST to
 * `/__pinagent/feedback`; the response (`{ id, agentSpawned }`) is the
 * same one the Vite/Next middleware returns.
 */
export async function submitFeedback(input: FeedbackInput): Promise<SubmitResult> {
  const base = devServerBaseUrl();
  if (!base) {
    return { ok: false, error: 'No dev server (release build?)' };
  }
  try {
    const res = await fetch(`${base}/__pinagent/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `${res.status} ${text}`.trim() };
    }
    const json = (await res.json()) as { id?: string; agentSpawned?: boolean };
    return { ok: true, id: json.id, agentSpawned: json.agentSpawned };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Fetch the conversation list from the dev server (`GET /__pinagent/feedback`).
 * Used on `<Pinagent/>` mount to restore minimized pills after an app reload —
 * the server's `.pinagent/db.sqlite` is the source of truth, so RN keeps no
 * device-local mirror. Returns `[]` (degrade silently) when the dev server is
 * unreachable or the request fails — exactly as today when there's no server.
 *
 * The items are the `storage.list()` projection (`FeedbackRecord[]`); the
 * caller filters them with `restorePills`. Typed loosely here so the wire JSON
 * doesn't drag the agent-runner type into RN source.
 */
export async function fetchFeedbackList(): Promise<RestoreCandidate[]> {
  const base = devServerBaseUrl();
  if (!base) return [];
  try {
    const res = await fetch(`${base}/__pinagent/feedback`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

/**
 * Ask the dev server to open a source location in the editor on the machine
 * running Metro — the RN analog of the web composer's "navigate to file".
 * Fire-and-forget: the device gets no useful signal beyond "request sent".
 */
export async function openInEditor(loc: {
  file: string;
  line: number;
  col: number;
}): Promise<boolean> {
  const base = devServerBaseUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/__pinagent/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(loc),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** `${Platform.OS} ${Platform.Version}` — RN's stand-in for a UA string. */
export function platformTag(): string {
  return `${Platform.OS} ${String(Platform.Version)}`;
}
