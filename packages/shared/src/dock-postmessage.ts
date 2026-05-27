// SPDX-License-Identifier: Apache-2.0
/**
 * postMessage protocol between the embedded dock iframe and its host
 * page. Defines the wire contract; no runtime yet — the EmbeddedTransport
 * class that implements this protocol lands in a follow-up phase once
 * the dock has a real cross-origin context to talk to (the hosted
 * dashboard relay).
 *
 * Why the contract lives in @pinagent/shared today rather than in the
 * dock or host-script package:
 *
 *   - Both sides of the boundary (the dock and the host's relay) need
 *     the same schemas to validate inbound frames; pulling them from
 *     a third package keeps either side independently swappable.
 *
 *   - The hosted relay (apps/cloud) and the local dev relay
 *     (packages/vite-plugin / packages/next-plugin) will both
 *     implement the same host-side surface; one source of truth for
 *     their input grammar makes the parity story explicit.
 *
 * Origin checking is strict in both directions and lives in the future
 * EmbeddedTransport class; the schemas here only validate shapes, not
 * provenance.
 *
 * Spec reference: pinpoint-dock-surface.md §5 (postMessage protocol).
 */
import { z } from 'zod';

// ---------- Dock → host ----------

/**
 * RPC-style request. `id` is a UUID-ish correlation token the host
 * echoes back on the response so the dock can resolve the right
 * Promise. `path` mirrors the same-origin URL the LocalTransport hits
 * today (`/__pinagent/...`) so the host relay can forward without
 * its own routing table.
 */
export const DockToHostQuerySchema = z
  .object({
    type: z.literal('query'),
    id: z.string().min(1),
    path: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const DockToHostMutateSchema = z
  .object({
    type: z.literal('mutate'),
    id: z.string().min(1),
    path: z.string().min(1),
    body: z.unknown(),
  })
  .strict();

/**
 * Open a long-lived subscription to a server channel (project events,
 * per-conversation event stream, etc). The host relay keeps a map of
 * `subscriptionId → backend listener` and pushes back `event` frames.
 */
export const DockToHostSubscribeSchema = z
  .object({
    type: z.literal('subscribe'),
    channel: z.string().min(1),
    subscriptionId: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const DockToHostUnsubscribeSchema = z
  .object({
    type: z.literal('unsubscribe'),
    subscriptionId: z.string().min(1),
  })
  .strict();

/**
 * Ask the host to open a popup window (OAuth flow, external link). The
 * host owns the window because the iframe sandbox bars
 * `allow-top-navigation`. Response comes back as `popup-closed` with
 * an optional result the popup posted to its opener pre-close.
 */
export const DockToHostOpenPopupSchema = z
  .object({
    type: z.literal('open-popup'),
    url: z.string().url(),
    subscriptionId: z.string().min(1),
  })
  .strict();

/**
 * Pure UI signals — open/close/resize — that the host might react to
 * (e.g. shifting the underlying page when the dock opens in panel
 * mode). The host doesn't have to handle these; the dock fires them
 * for observability.
 */
export const DockToHostUiEventSchema = z
  .object({
    type: z.literal('ui-event'),
    event: z.enum(['open', 'close', 'resize']),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const DockToHostSchema = z.discriminatedUnion('type', [
  DockToHostQuerySchema,
  DockToHostMutateSchema,
  DockToHostSubscribeSchema,
  DockToHostUnsubscribeSchema,
  DockToHostOpenPopupSchema,
  DockToHostUiEventSchema,
]);
export type DockToHost = z.infer<typeof DockToHostSchema>;

// ---------- Host → dock ----------

/**
 * RPC response — `ok: true` carries the data, `ok: false` carries a
 * code + human-readable message so the dock can route into its
 * ErrorState components without re-deriving from string contents.
 */
export const HostToDockResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      type: z.literal('response'),
      id: z.string().min(1),
      ok: z.literal(true),
      data: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal('response'),
      id: z.string().min(1),
      ok: z.literal(false),
      error: z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
        })
        .strict(),
    })
    .strict(),
]);

export const HostToDockEventSchema = z
  .object({
    type: z.literal('event'),
    subscriptionId: z.string().min(1),
    payload: z.unknown(),
  })
  .strict();

export const HostToDockPopupClosedSchema = z
  .object({
    type: z.literal('popup-closed'),
    subscriptionId: z.string().min(1),
    result: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Once at iframe load (and on any host-side change worth re-broadcasting),
 * the host pushes its environment: which URL it's on, current viewport
 * dimensions, current theme. Lets the dock skip its own re-render
 * dance for context the host already knows.
 */
export const HostToDockContextSchema = z
  .object({
    type: z.literal('host-context'),
    payload: z
      .object({
        url: z.string(),
        viewport: z
          .object({
            w: z.number().int().nonnegative(),
            h: z.number().int().nonnegative(),
          })
          .strict(),
        theme: z.enum(['light', 'dark']),
      })
      .strict(),
  })
  .strict();

// Plain `z.union` (not discriminatedUnion) — the response variants
// already share the same `type: 'response'` discriminator and zod's
// discriminatedUnion requires unique values for the chosen key. The
// inner HostToDockResponseSchema does its own discrimination on `ok`.
export const HostToDockSchema = z.union([
  HostToDockResponseSchema,
  HostToDockEventSchema,
  HostToDockPopupClosedSchema,
  HostToDockContextSchema,
]);
export type HostToDock = z.infer<typeof HostToDockSchema>;
