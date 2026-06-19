// SPDX-License-Identifier: Apache-2.0
/**
 * <Pinagent/> — the React Native widget. Mount it once at your app root:
 *
 *   export default function App() {
 *     return (
 *       <>
 *         <YourApp />
 *         <Pinagent />
 *       </>
 *     );
 *   }
 *
 * Modeled on pinagent's Next.js `<Pinagent/>` (a single root-mounted
 * component) rather than the Vite `<script>` injection, which has no RN
 * analog. Renders `null` in production so it has zero cost in release
 * builds.
 *
 * Flow: tap the pin FAB to arm picking → tap a view → we resolve its source
 * via the RN Inspector, hide our own overlay, and capture a screenshot →
 * type a comment → submit POSTs to the Metro middleware, which stores it
 * and (optionally) spawns an agent. When an agent is spawned, a live
 * transcript sheet streams the run back over WebSocket (see StreamSheet /
 * ws-client); otherwise a toast confirms the comment was filed for pull-mode
 * (MCP) pickup. "+ Add element" multi-picks several targets into one comment
 * (sent as `additionalAnchors`); a single pick leaves them null.
 *
 * The transcript sheet can be minimized to a pill, freeing the screen to pick
 * another element and spawn a second agent. Each run keeps its own live sheet,
 * so multiple agents can stream concurrently — the expanded one shows its full
 * sheet; the rest sit as pills that keep streaming until tapped open.
 */
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { BRAND_CREAM, BRAND_GOLD, BRAND_INK } from './brand';
import { resolvePick } from './inspector';
import { buildAdditionalAnchors, type ChipPick, removeChip } from './multi-pick';
import { PinIcon } from './pin-icon';
import { restorePills } from './restore';
import { StreamSheet } from './StreamSheet';
import { captureScreenshot } from './screenshot';
import { submitOutcome } from './submit-outcome';
import { fetchFeedbackList, openInEditor, platformTag, submitFeedback } from './transport';
import type { PickResult } from './types';

export interface PinagentProps {
  /**
   * Absolute project root, used to make `_debugSource` file paths
   * project-relative (matching the web babel plugin's output). Defaults
   * to the value Metro injects, falling back to '' (paths stay absolute,
   * still usable).
   */
  projectRoot?: string;
  /** Route/screen name to record with the comment. Defaults to OS name. */
  screenName?: string;
}

type Phase = 'idle' | 'picking' | 'capturing' | 'composing' | 'sending';

/**
 * Resolve after the next painted frame. We flip to the `capturing` phase to
 * tear down our own overlay (picking tint, hint, FAB), then wait for that
 * render to reach the screen before `react-native-view-shot` snaps it —
 * otherwise pinagent's UI lands in the screenshot. Double-rAF is RN's
 * idiom for "after the next paint".
 */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Track the soft keyboard's height so the composer can sit directly above it.
 * `KeyboardAvoidingView` is unreliable inside a `Modal` — the modal presents
 * in its own window, so the view's measured origin is wrong and the computed
 * inset never lifts the sheet. Driving the inset off the keyboard frame is the
 * robust cross-platform path. iOS fires the `*Will*` events (in sync with the
 * slide animation); Android only fires `*Did*`.
 */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

const FAB_SIZE = 52;
// Resting insets matching the old fixed layout (right/bottom), plus a uniform
// edge margin used to keep the button on-screen once it's free to roam.
const FAB_MARGIN = 20;
const FAB_BOTTOM = 40;
// Movement (px) under which a press counts as a tap, not a drag.
const FAB_TAP_SLOP = 6;

interface DraggableFab {
  panHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  transform: ReturnType<Animated.ValueXY['getTranslateTransform']>;
}

/**
 * Make the FAB draggable anywhere on screen.
 *
 * The button defaults to the bottom-right (matching the old fixed `right: 20,
 * bottom: 40` layout) but can be dragged to any edge — handy when it sits over
 * the very control the developer wants to comment on. A single PanResponder
 * owns BOTH gestures: a stationary press (total movement under `FAB_TAP_SLOP`)
 * fires `onTap` to arm picking, while any real movement relocates the button.
 * Position lives in an `Animated.ValueXY` of the button's top-left in window
 * coords; we keep a plain-object mirror (`committed`) because PanResponder
 * callbacks can't read an Animated.Value synchronously.
 *
 * Position is session-local: RN keeps no device store (the dev-server DB is the
 * source of truth and holds no ephemeral UI state), so it resets to the default
 * corner on reload — same as the rest of the widget's transient UI.
 */
function useDraggableFab(width: number, height: number, onTap: () => void): DraggableFab {
  // Clamp a top-left position so the whole button stays on-screen.
  const clamp = useCallback(
    (x: number, y: number) => {
      const maxX = Math.max(FAB_MARGIN, width - FAB_SIZE - FAB_MARGIN);
      const maxY = Math.max(FAB_MARGIN, height - FAB_SIZE - FAB_MARGIN);
      return {
        x: Math.min(Math.max(FAB_MARGIN, x), maxX),
        y: Math.min(Math.max(FAB_MARGIN, y), maxY),
      };
    },
    [width, height],
  );

  // Default resting spot: bottom-right corner.
  const home = useMemo(
    () => clamp(width - FAB_SIZE - FAB_MARGIN, height - FAB_SIZE - FAB_BOTTOM),
    [clamp, width, height],
  );

  const pos = useRef(new Animated.ValueXY(home)).current;
  const committed = useRef(home);

  // Keep the button on-screen across rotations / window-size changes.
  useEffect(() => {
    const next = clamp(committed.current.x, committed.current.y);
    if (next.x !== committed.current.x || next.y !== committed.current.y) {
      committed.current = next;
      pos.setValue(next);
    }
  }, [clamp, pos]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim the touch up front so a plain tap still reaches `onTap`; we
        // discriminate tap vs drag by distance on release.
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          // Drag relative to where the button currently rests.
          pos.setOffset(committed.current);
          pos.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event([null, { dx: pos.x, dy: pos.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: (_e, g) => {
          pos.flattenOffset();
          if (Math.abs(g.dx) <= FAB_TAP_SLOP && Math.abs(g.dy) <= FAB_TAP_SLOP) {
            // No real movement → it was a tap; undo any sub-pixel drift.
            pos.setValue(committed.current);
            onTap();
            return;
          }
          // Commit the dragged spot, clamped on-screen, with a small settle.
          const next = clamp(committed.current.x + g.dx, committed.current.y + g.dy);
          committed.current = next;
          Animated.spring(pos, { toValue: next, useNativeDriver: false, bounciness: 0 }).start();
        },
        onPanResponderTerminate: (_e, g) => {
          // Lost the responder mid-gesture (e.g. to a parent scroll view):
          // keep wherever the drag had reached rather than snapping away.
          pos.flattenOffset();
          const next = clamp(committed.current.x + g.dx, committed.current.y + g.dy);
          committed.current = next;
          pos.setValue(next);
        },
      }),
    [pos, clamp, onTap],
  );

  return { panHandlers: responder.panHandlers, transform: pos.getTranslateTransform() };
}

/**
 * Hard dev-only gate. `__DEV__` is `false` in release bundles, so the
 * whole widget — and its require()s into RN internals — drops out. Kept
 * as a thin wrapper so the hooks live in `PinagentDev`, called
 * unconditionally (rules-of-hooks).
 */
export function Pinagent(props: PinagentProps): ReactElement | null {
  if (!__DEV__) return null;
  return <PinagentDev {...props} />;
}

function PinagentDev({ projectRoot = '', screenName }: PinagentProps): ReactElement {
  const { width, height } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const rootRef = useRef<View>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pick, setPick] = useState<PickResult | null>(null);
  // Which breadcrumb segment the comment is anchored to (index into
  // `pick.chain`). Defaults to the innermost — the tapped component — and
  // moves outward when the user presses an ancestor crumb to re-focus.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [shot, setShot] = useState<string | null>(null);
  // Extra elements multi-picked into the SAME comment via "+ Add element"
  // (ticket 008). The primary stays in `pick`; these are the 2nd…Nth taps,
  // rendered as removable chips and sent as `additionalAnchors`. The screenshot
  // (`shot`) is captured once at the first pick — extras don't re-capture.
  const [extraPicks, setExtraPicks] = useState<ChipPick[]>([]);
  // Counter for stable chip keys (pick order is preserved on the wire).
  const pickSeq = useRef(0);
  // True while picking was entered from the composer's "+ Add element" (so the
  // next tap APPENDS an extra instead of starting a fresh primary pick).
  const addingExtra = useRef(false);
  const [comment, setComment] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  // Transient note under the file:line link (e.g. "No editor found").
  const [openNote, setOpenNote] = useState<string | null>(null);
  // Inline submit error, shown in the composer when a POST fails. The draft
  // (comment/pick/shot) is retained so the user can fix the cause and Retry,
  // instead of losing everything to a vanishing toast (ticket 002).
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Live agent runs. Each spawned agent gets a StreamSheet; one can be expanded
  // (full sheet) while the rest sit as minimized pills that keep streaming in
  // the background — so you can minimize a run, interact with the app, and
  // spawn another. `expandedId` is the one showing its full sheet (null = all
  // minimized).
  const [streams, setStreams] = useState<{ id: string; target: string }[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The surface this widget is mounted on — the same value we record as the
  // comment `url` (web sends the page URL). Used to scope restored pills to
  // this screen, mirroring the web widget's per-page restore.
  const surfaceUrl = screenName ?? Platform.OS;

  const closeStream = useCallback((id: string) => {
    setStreams((prev) => prev.filter((s) => s.id !== id));
    setExpandedId((cur) => (cur === id ? null : cur));
  }, []);

  // Tapping the FAB toggles picking; cancelling a pick also drops a pending
  // "+ Add element" intent. Extracted so the draggable-FAB gesture can fire it
  // on a stationary press (a drag relocates the button instead — see below).
  const toggleFab = useCallback(() => {
    setPhase((p) => {
      if (p === 'picking') addingExtra.current = false;
      return p === 'picking' ? 'idle' : 'picking';
    });
  }, []);

  const fab = useDraggableFab(width, height, toggleFab);

  // Restore minimized pills after an app reload (Fast Refresh, shake-reload,
  // restart). The dev server (.pinagent/db.sqlite) is the source of truth — RN
  // keeps no device-local store — so on mount we fetch the conversation list,
  // filter it to this surface's still-pending runs (newest 5), and seed
  // `streams` as MINIMIZED pills. Each restored StreamSheet then subscribes
  // over WS, which replays the transcript (and fires `done` for finished runs,
  // landing the sheet in its normal done state). Skips silently when the dev
  // server is unreachable (fetchFeedbackList returns []). Runs once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const items = await fetchFeedbackList();
      if (cancelled) return;
      const pills = restorePills(items, surfaceUrl);
      if (pills.length === 0) return;
      // Don't clobber any pill spawned between mount and this async resolve;
      // de-dupe by id and keep everything minimized (expandedId stays null).
      setStreams((prev) => {
        const have = new Set(prev.map((s) => s.id));
        const added = pills.filter((p) => !have.has(p.id));
        return added.length ? [...prev, ...added] : prev;
      });
    })();
    return () => {
      cancelled = true;
    };
    // Restore once per surface; we deliberately don't re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceUrl]);

  const onPickTap = useCallback(
    async (x: number, y: number) => {
      // Tear our own overlay down BEFORE hit-testing. The inspector's
      // `findNodeAtPoint` is geometric and paint-order based (it ignores
      // `pointerEvents`), so a full-screen picking layer painted on top is
      // the view "under" the tap — every pick would resolve to wherever
      // pinagent is mounted (the app root) instead of the real component.
      // Dropping to `capturing` unmounts the Pressable AND collapses our
      // root to zero size (see the root View's style), so a frame later the
      // tap resolves to the component beneath us — and, as a bonus, the
      // screenshot already excludes pinagent's UI (the web widget excludes
      // its host node from the html-to-image render for the same reason).
      setPhase('capturing');
      await nextPaint();
      // Pass our overlay's host instance (not a findNodeHandle tag): the
      // inspector climbs from it to the app root to hit-test there.
      const picked = await resolvePick(rootRef.current, x, y, projectRoot);

      // "+ Add element" re-pick: APPEND an extra target to the same comment —
      // no re-capture (one screenshot per feedback, web parity), no touching
      // the primary pick or its breadcrumb. The extra keeps the loc it was
      // tapped with; only the primary re-anchors via the breadcrumb.
      if (addingExtra.current) {
        addingExtra.current = false;
        const label = picked.chain.at(-1)?.name ?? picked.nameChain.at(-1) ?? 'component';
        const chip: ChipPick = {
          key: `x${pickSeq.current++}`,
          loc: picked.loc,
          selector: picked.nameChain.join(' > '),
          clickX: x,
          clickY: y,
          label,
        };
        setExtraPicks((prev) => [...prev, chip]);
        setPhase('composing');
        return;
      }

      // Fresh primary pick → fresh comment: capture the screenshot, reset the
      // extras and any stale submit error.
      setShot(await captureScreenshot());
      setPick(picked);
      // Anchor to the innermost (tapped) component by default.
      setSelectedIndex(Math.max(0, picked.chain.length - 1));
      setExtraPicks([]);
      setOpenNote(null);
      setSubmitError(null);
      setPhase('composing');
    },
    [projectRoot],
  );

  // "+ Add element": re-enter picking from the composer, keeping the current
  // comment + primary pick. The composer Modal hides while picking (phase !==
  // 'composing'), so the user can tap another element; `addingExtra` routes the
  // resulting tap to append a chip rather than start over.
  const onAddElement = useCallback(() => {
    addingExtra.current = true;
    setOpenNote(null);
    setPhase('picking');
  }, []);

  const onRemoveExtra = useCallback((key: string) => {
    setExtraPicks((prev) => removeChip(prev, key));
  }, []);

  // Dismiss the composer and drop the whole draft (comment + extras + error).
  // Used by Cancel and the modal's hardware-back close.
  const onDismissComposer = useCallback(() => {
    setExtraPicks([]);
    setSubmitError(null);
    setPhase('idle');
  }, []);

  // The source location the comment is currently anchored to: the precise
  // tapped element while the innermost crumb is selected, otherwise the
  // chosen ancestor component's own (nearest-source-resolved) location. Each
  // ancestor falls back to the precise tapped loc so an untaggable crumb still
  // shows a real path rather than degrading to a bare component name.
  const activeLoc = useMemo(() => {
    if (!pick) return null;
    const last = pick.chain.length - 1;
    if (selectedIndex >= 0 && selectedIndex < pick.chain.length) {
      if (selectedIndex === last) return pick.loc ?? pick.chain[last]?.loc ?? null;
      return pick.chain[selectedIndex]?.loc ?? pick.loc ?? null;
    }
    return pick.loc ?? null;
  }, [pick, selectedIndex]);

  // The highlight outline tracks the selected crumb: the precise tapped frame
  // while the innermost crumb is selected, otherwise the chosen ancestor's
  // measured frame. So pressing a breadcrumb visibly moves the selection box.
  const activeFrame = useMemo(() => {
    if (!pick) return null;
    const last = pick.chain.length - 1;
    if (selectedIndex >= 0 && selectedIndex < pick.chain.length) {
      if (selectedIndex === last) return pick.frame ?? pick.chain[last]?.frame ?? null;
      return pick.chain[selectedIndex]?.frame ?? pick.frame ?? null;
    }
    return pick.frame ?? null;
  }, [pick, selectedIndex]);

  // Label for the primary target chip: the anchored file:line if resolved, else
  // the selected component name (mirrors the composer title).
  const primaryChipLabel = useMemo(() => {
    if (activeLoc) return `${activeLoc.file}:${activeLoc.line}`;
    return pick?.chain[selectedIndex]?.name ?? pick?.nameChain.at(-1) ?? 'component';
  }, [activeLoc, pick, selectedIndex]);

  const crumbs = pick?.chain ?? [];

  const onCrumbPress = useCallback((index: number) => {
    setSelectedIndex(index);
    setOpenNote(null);
  }, []);

  const onOpenInEditor = useCallback(async () => {
    if (!activeLoc) return;
    setOpenNote('Opening…');
    const ok = await openInEditor(activeLoc);
    setOpenNote(ok ? null : 'No editor found (set PINAGENT_EDITOR)');
  }, [activeLoc]);

  const onSubmit = useCallback(async () => {
    if (!comment.trim()) return;
    // Human-readable target for the stream header, captured before we clear
    // the pick: the anchored file:line if resolved, else the component name.
    const target = activeLoc
      ? `${activeLoc.file}:${activeLoc.line}`
      : (pick?.chain[selectedIndex]?.name ?? pick?.nameChain.at(-1) ?? 'component');
    setSubmitError(null);
    setPhase('sending');
    const result = await submitFeedback({
      comment: comment.trim(),
      // The breadcrumb-selected anchor (defaults to the tapped element).
      loc: activeLoc,
      // v1 "selector" = the component name breadcrumb (RN has no CSS
      // selectors). Gives the agent a readable hint and satisfies the
      // schema's required `selector` field.
      selector: pick?.nameChain.join(' > ') ?? '',
      url: surfaceUrl,
      viewport: { w: Math.round(width), h: Math.round(height) },
      userAgent: platformTag(),
      screenshot: shot ?? '',
      createdAt: new Date().toISOString(),
      // Multi-picked extras (ticket 008). Omitted entirely for a single pick,
      // so the server keeps `additional_anchors` null — web parity.
      additionalAnchors: buildAdditionalAnchors(extraPicks),
    });

    const outcome = submitOutcome(result);

    // Failed POST (Metro restart, network blip, release build): KEEP the draft
    // — comment, picked anchor, and screenshot — reopen the composer, and show
    // the reason inline with a Retry. We never destroy composer state on a
    // failed submit (ticket 002).
    if (outcome.composer === 'keep') {
      setSubmitError(outcome.error);
      setPhase('composing');
      return;
    }

    // Success: clear the composer (including any multi-picked extras).
    setComment('');
    setPick(null);
    setShot(null);
    setExtraPicks([]);
    setPhase('idle');

    // Agent spawned → stream the run live and expand its sheet (any previously
    // expanded run drops to a minimized pill). Otherwise (spawn off) fall back
    // to a transient toast; pull mode (MCP) picks it up.
    if (outcome.streamId) {
      const id = outcome.streamId;
      setStreams((prev) => (prev.some((s) => s.id === id) ? prev : [...prev, { id, target }]));
      setExpandedId(id);
      return;
    }
    if (outcome.toast) {
      setToast(outcome.toast);
      setTimeout(() => setToast(null), 2500);
    }
  }, [comment, pick, selectedIndex, activeLoc, shot, extraPicks, surfaceUrl, width, height]);

  return (
    // collapsable={false} keeps this View in the native tree so its ref
    // resolves to a real host instance for the Inspector call. During
    // `capturing` we shrink it to zero size so it's not the topmost view at
    // the tap point while the inspector hit-tests the app beneath us (see
    // onPickTap); it has no visible children in that phase anyway.
    <View
      ref={rootRef}
      collapsable={false}
      style={phase === 'capturing' ? styles.collapsed : StyleSheet.absoluteFill}
      pointerEvents="box-none"
    >
      {/* Picking overlay: a transparent full-screen catcher. onPress gives
          us the tap coords; we forward them to the Inspector. */}
      {phase === 'picking' && (
        <Pressable
          style={[StyleSheet.absoluteFill, styles.pickLayer]}
          onPress={(e) => {
            const { pageX, pageY } = e.nativeEvent;
            void onPickTap(pageX, pageY);
          }}
        >
          <View style={styles.pickHint} pointerEvents="none">
            <Text style={styles.pickHintText}>Tap a component to comment on it</Text>
          </View>
        </Pressable>
      )}

      {/* Highlight rect for the current selection, drawn while composing. The
          RN analog of the web widget's outline; coords come from the Inspector
          frame (window space). Follows the selected breadcrumb via
          `activeFrame`. */}
      {phase === 'composing' && activeFrame && (
        <View
          pointerEvents="none"
          style={[
            styles.highlight,
            {
              left: activeFrame.x,
              top: activeFrame.y,
              width: activeFrame.width,
              height: activeFrame.height,
            },
          ]}
        />
      )}

      {/* Composer. A Modal (not an iframe — RN has no host focus-trap to
          escape, so a plain modal is enough). */}
      <Modal
        visible={phase === 'composing'}
        transparent
        animationType="slide"
        onRequestClose={onDismissComposer}
      >
        {/* Pad the docked composer up by the live keyboard height so the
            input and actions clear the soft keyboard (see useKeyboardHeight
            for why KeyboardAvoidingView can't do this inside a Modal). */}
        <View style={[styles.composerBackdrop, { paddingBottom: keyboardHeight }]}>
          <View style={styles.composer}>
            {/* Title: the anchored file:line if resolved (pressable → opens
                in the editor on the Metro host, the RN analog of web's
                "navigate to file"), else the selected component name. */}
            {activeLoc ? (
              <Pressable onPress={onOpenInEditor}>
                <Text style={[styles.composerTitle, styles.composerTitleLink]}>
                  {`${activeLoc.file}:${activeLoc.line}`}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.composerTitle}>
                {pick?.chain[selectedIndex]?.name ?? pick?.nameChain.at(-1) ?? 'Unknown component'}
              </Text>
            )}
            {openNote ? <Text style={styles.openNote}>{openNote}</Text> : null}
            {/* Breadcrumb: each component is pressable and re-anchors the
                comment onto that ancestor (the selected one is highlighted).
                Mirrors the web composer's ancestor-select. */}
            {crumbs.length ? (
              <View style={styles.breadcrumbRow}>
                {crumbs.map((crumb, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional ancestry path, rebuilt wholesale per pick — never reordered
                  <View key={`${crumb.name}-${i}`} style={styles.breadcrumbItem}>
                    {i > 0 ? <Text style={styles.breadcrumbSep}>›</Text> : null}
                    <Pressable
                      onPress={() => onCrumbPress(i)}
                      hitSlop={6}
                      accessibilityRole="button"
                    >
                      <Text
                        style={[
                          styles.breadcrumb,
                          i === selectedIndex && styles.breadcrumbSelected,
                        ]}
                      >
                        {crumb.name}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : pick?.nameChain.length ? (
              <Text style={styles.breadcrumb} numberOfLines={1}>
                {pick.nameChain.join(' › ')}
              </Text>
            ) : null}
            {/* Target chips + "+ Add element" (ticket 008). The primary chip
                (non-removable) reflects the breadcrumb-selected anchor; each
                extra is a removable chip. Tapping "+ Add element" hides the
                composer, re-enters picking, and appends the next tap as an
                extra carried in `additionalAnchors`. */}
            <View style={styles.chipRow}>
              <View style={[styles.chip, styles.chipPrimary]}>
                <Text style={styles.chipPrimaryText} numberOfLines={1}>
                  {primaryChipLabel}
                </Text>
              </View>
              {extraPicks.map((ex) => (
                <View key={ex.key} style={styles.chip}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    {ex.label}
                  </Text>
                  <Pressable
                    onPress={() => onRemoveExtra(ex.key)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${ex.label}`}
                  >
                    <Text style={styles.chipRemove}>×</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={onAddElement} style={styles.addChip} accessibilityRole="button">
                <Text style={styles.addChipText}>+ Add element</Text>
              </Pressable>
            </View>
            <TextInput
              autoFocus
              multiline
              value={comment}
              onChangeText={setComment}
              placeholder="What should change here?"
              placeholderTextColor="#9aa0a6"
              style={styles.input}
            />
            {/* Inline submit error. The draft (comment/pick/shot) is retained
                under it, so the primary button becomes Retry — no re-pick, no
                re-capture, no lost typing (ticket 002). */}
            {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}
            <View style={styles.composerActions}>
              <Pressable onPress={onDismissComposer} style={styles.btnGhost}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onSubmit}
                disabled={!comment.trim()}
                style={[styles.btnPrimary, !comment.trim() && styles.btnDisabled]}
              >
                <Text style={styles.btnPrimaryText}>{submitError ? 'Retry' : 'Send'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Floating action button. Drag it anywhere; tap to toggle picking.
          Shows status while sending. Hidden during `capturing` so it stays
          out of the screenshot. Positioned via an animated translate so the
          PanResponder can move it (see useDraggableFab). */}
      {phase !== 'capturing' && (
        <Animated.View
          {...fab.panHandlers}
          accessibilityRole="button"
          accessibilityLabel="Pinagent — tap to comment, drag to move"
          style={[
            styles.fab,
            phase === 'picking' && styles.fabActive,
            { transform: fab.transform },
          ]}
        >
          {phase === 'sending' ? (
            <Text style={styles.fabText}>…</Text>
          ) : (
            <PinIcon size={26} color={BRAND_CREAM} />
          )}
        </Animated.View>
      )}

      {toast && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Live agent transcripts — one per spawned run. The expanded one shows
          its full sheet; the rest render as minimized pills (stacked bottom-
          left) that keep streaming. Each stays mounted across minimize/expand
          so its WebSocket — and live transcript — survive. */}
      {streams.map((s, i) => {
        const minimized = s.id !== expandedId;
        // Stack index among the minimized pills only, so they don't overlap.
        const stackIndex = streams
          .filter((o) => o.id !== expandedId)
          .findIndex((o) => o.id === s.id);
        return (
          <StreamSheet
            key={s.id}
            feedbackId={s.id}
            target={s.target}
            minimized={minimized}
            stackIndex={stackIndex < 0 ? i : stackIndex}
            onMinimize={() => setExpandedId(null)}
            onExpand={() => setExpandedId(s.id)}
            onClose={() => closeStream(s.id)}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Zero-footprint root for the `capturing` phase — keeps the View (and its
  // ref) mounted while removing it as a hit-test target over the app.
  collapsed: { position: 'absolute', width: 0, height: 0 },
  pickLayer: { backgroundColor: 'rgba(59,130,246,0.08)' },
  pickHint: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(17,24,39,0.9)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  pickHintText: { color: '#fff', fontSize: 13 },
  highlight: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderRadius: 4,
  },
  composerBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  composer: {
    backgroundColor: '#fff',
    padding: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 8,
  },
  composerTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  composerTitleLink: { color: '#2563eb', textDecorationLine: 'underline' },
  openNote: { fontSize: 11, color: '#9aa0a6', marginTop: 2 },
  submitError: { fontSize: 12, color: '#dc2626', marginTop: 2 },
  breadcrumbRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 2 },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center' },
  breadcrumbSep: { fontSize: 12, color: '#c4c7cc', paddingHorizontal: 4 },
  breadcrumb: { fontSize: 12, color: '#6b7280' },
  breadcrumbSelected: { color: '#2563eb', fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  chipPrimary: { backgroundColor: '#dbeafe' },
  chipText: { fontSize: 12, color: '#374151', flexShrink: 1 },
  chipPrimaryText: { fontSize: 12, color: '#1d4ed8', fontWeight: '600', flexShrink: 1 },
  chipRemove: { fontSize: 15, color: '#6b7280', lineHeight: 15 },
  addChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    borderStyle: 'dashed',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  addChipText: { fontSize: 12, color: '#2563eb', fontWeight: '600' },
  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    color: '#111827',
    textAlignVertical: 'top',
  },
  composerActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btnGhost: { paddingHorizontal: 16, paddingVertical: 10 },
  btnGhostText: { color: '#6b7280', fontWeight: '600' },
  btnPrimary: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnDisabled: { opacity: 0.4 },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
  fab: {
    // Anchored top-left; the live position is applied via an animated
    // translate so the FAB can be dragged (see useDraggableFab). FAB_SIZE
    // must stay in sync with width/height below.
    position: 'absolute',
    left: 0,
    top: 0,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: BRAND_INK,
    // Constant-width rim so toggling the active gold ring never shifts layout;
    // cream @ 14% is the same subtle idle rim the web widget FAB uses.
    borderWidth: 2,
    borderColor: 'rgba(252, 249, 232, 0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  // Gold ring while picking (web widget parity) — replaces the old blue fill.
  fabActive: { borderColor: BRAND_GOLD },
  fabText: { fontSize: 22, color: BRAND_CREAM },
  toast: {
    position: 'absolute',
    bottom: 110,
    alignSelf: 'center',
    backgroundColor: 'rgba(17,24,39,0.95)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  toastText: { color: '#fff', fontSize: 13 },
});
