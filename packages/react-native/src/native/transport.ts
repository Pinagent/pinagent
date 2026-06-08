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
import type { FeedbackInput } from './types';

/**
 * Parse `http://192.168.1.5:8081/index.bundle?...` (or the RN packager's
 * variants) down to `http://192.168.1.5:8081`. Returns null in release
 * builds where `scriptURL` points at a baked-in `file://` bundle.
 */
export function devServerBaseUrl(): string | null {
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
