// SPDX-License-Identifier: Apache-2.0
import type { RegionRect } from './crop';
import type { Composer } from './types';
import type { WidgetWsClient } from './ws-client';

export interface State {
  mode: 'idle' | 'picking';
}

export type Click = { x: number; y: number };

/** A single Cmd/Ctrl-click pick: its element plus where the cursor hit. */
export type PickExtra = { target: Element; click: Click };

export type { RegionRect } from './crop';

/**
 * Shared state + cross-controller actions for one mounted widget.
 *
 * `mount()` builds the DOM and a single `WidgetContext`, then hands it to
 * the three controllers (`composer`, `picker`, `fab-tray`). Each controller
 * reads the DOM/state fields directly and calls the *other* controllers
 * through the late-bound action methods below. Those methods are assigned
 * by `mount()` right after each controller is constructed — controllers
 * only invoke them at event time, never during construction, so the
 * cyclic wiring resolves cleanly.
 */
export interface WidgetContext {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly fab: HTMLElement;
  readonly outline: HTMLDivElement;
  readonly state: State;
  readonly wsClient: WidgetWsClient;
  readonly hotkeyChar: string | null;
  readonly dockEnabled: boolean;
  readonly isMac: boolean;
  /** Every live composer (expanded or minimized), in insertion order. */
  readonly composers: Set<Composer>;
  /** The one expanded composer, or null. Owned by the composer controller. */
  expandedComposer: Composer | null;
  /**
   * When set, the next plain pick routes its element into this running
   * conversation (as a queued follow-up) instead of opening a fresh
   * composer. Set by a composer's "add element" action right before
   * `enterPicking`; cleared by the picker on commit or by `exitPicking`.
   */
  pickRouteComposer: Composer | null;

  // ---- late-bound cross-controller actions (assigned in mount) ----
  /** Picker: enter element-picking mode. */
  enterPicking(): void;
  /** Picker: leave element-picking mode. */
  exitPicking(): void;
  /** FAB/tray: re-render the FAB as pin or running-agents tray. */
  applyFabPresentation(): void;
  /** Composer: expand `c`, minimizing whatever was expanded before. */
  swapTo(c: Composer): void;
  /** Composer: cycle the expanded composer to the next in-flight agent. */
  hopToNextActive(): void;
  /** Composer: minimize every spawned agent to its bubble (smallest) state. */
  minimizeAll(): void;
  /**
   * Composer: open a fresh composer for a freshly-picked element.
   * `regions` are user-drawn snippet rects (document coords) that narrow
   * the submitted screenshot; empty in the common element-pick case.
   */
  openComposer(target: Element, click: Click, extras?: PickExtra[], regions?: RegionRect[]): void;
  /**
   * Composer: add a freshly-picked element to an already-running
   * conversation as a queued follow-up (text location only). Used when the
   * pick was routed via `pickRouteComposer`.
   */
  addNodeToComposer(composer: Composer, target: Element, click: Click, extras?: PickExtra[]): void;
  /** Composer: find the composer a bubble element belongs to, if any. */
  bubbleOwner(el: HTMLElement): Composer | null;
  /**
   * Composer: open a conversation as a free-floating chat that isn't pinned
   * to any page element. Used by the running-agents tray when there's no
   * dock to route into. Surfaces the conversation if it's already on-screen.
   */
  openUnanchored(feedbackId: string): void;
  /** Transient corner toast. */
  toast(text: string, kind: 'success' | 'error'): void;
  /**
   * Reveal the dock surface, if one is mounted. Optional because most
   * mounts run without the dock; callers use `ctx.openDock?.()`.
   */
  openDock?(): void;
}
