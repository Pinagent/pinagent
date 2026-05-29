// SPDX-License-Identifier: Apache-2.0
/**
 * The wire shape the RN widget produces. It mirrors `FeedbackInputSchema`
 * in `packages/agent-runner/src/storage.ts` so the existing server
 * accepts a phone-filed comment with zero backend changes. Keep this in
 * lockstep with that zod schema — the middleware re-validates against it.
 */
export interface FeedbackInput {
  /** Comment text the developer typed. 1..8000 chars (server-enforced). */
  comment: string;
  /**
   * Source location of the tapped component, from the fiber's
   * `_debugSource` (the RN analog of web's `data-pa-loc`). Null when the
   * tapped view has no resolvable source (a deep native view with no
   * composite owner in dev).
   */
  loc: { file: string; line: number; col: number } | null;
  /**
   * Web sends a CSS selector here for HMR re-anchoring. RN has no
   * selectors, so v1 sends the component display-name chain (e.g.
   * "App > HomeScreen > PrimaryButton") purely to satisfy the schema and
   * give the agent a human-readable hint. See the design doc's
   * "Deliberate cuts for v1".
   */
  selector: string;
  /** The current route/screen name (web sends the page URL). */
  url: string;
  /** Window dimensions at pick time. */
  viewport: { w: number; h: number };
  /** `${Platform.OS} ${Platform.Version}` — the RN analog of a UA string. */
  userAgent: string;
  /** base64 PNG (no data: prefix). Capped at 5MB by the middleware. */
  screenshot: string;
  /** ISO timestamp. */
  createdAt: string;
}

/** Result of resolving a tap point to a source location. */
export interface PickResult {
  loc: FeedbackInput['loc'];
  /** Component display-name breadcrumb, newest (tapped) last. */
  nameChain: string[];
  /** Highlight rectangle in window coordinates, for the overlay outline. */
  frame: { x: number; y: number; width: number; height: number } | null;
}
