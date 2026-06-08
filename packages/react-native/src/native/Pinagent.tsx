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
 * Flow: tap the 💬 FAB to arm picking → tap a view → we resolve its source
 * via the RN Inspector, hide our own overlay, and capture a screenshot →
 * type a comment → submit POSTs to the Metro middleware, which stores it
 * and (optionally) spawns an agent. When an agent is spawned, a live
 * transcript sheet streams the run back over WebSocket (see StreamSheet /
 * ws-client); otherwise a toast confirms the comment was filed for pull-mode
 * (MCP) pickup. Single-pick only.
 */
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { resolvePick } from './inspector';
import { StreamSheet } from './StreamSheet';
import { captureScreenshot } from './screenshot';
import { openInEditor, platformTag, submitFeedback } from './transport';
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
  const [comment, setComment] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  // Transient note under the file:line link (e.g. "No editor found").
  const [openNote, setOpenNote] = useState<string | null>(null);
  // When set, an agent run is streaming live in the transcript sheet.
  const [stream, setStream] = useState<{ id: string; target: string } | null>(null);

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
      setShot(await captureScreenshot());
      setPick(picked);
      // Anchor to the innermost (tapped) component by default.
      setSelectedIndex(Math.max(0, picked.chain.length - 1));
      setOpenNote(null);
      setPhase('composing');
    },
    [projectRoot],
  );

  // The source location the comment is currently anchored to: the precise
  // tapped element while the innermost crumb is selected, otherwise the
  // chosen ancestor component's own location.
  const activeLoc = useMemo(() => {
    if (!pick) return null;
    const last = pick.chain.length - 1;
    if (selectedIndex >= 0 && selectedIndex < pick.chain.length) {
      if (selectedIndex === last) return pick.loc ?? pick.chain[last]?.loc ?? null;
      return pick.chain[selectedIndex]?.loc ?? null;
    }
    return pick.loc ?? null;
  }, [pick, selectedIndex]);

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
    setPhase('sending');
    const result = await submitFeedback({
      comment: comment.trim(),
      // The breadcrumb-selected anchor (defaults to the tapped element).
      loc: activeLoc,
      // v1 "selector" = the component name breadcrumb (RN has no CSS
      // selectors). Gives the agent a readable hint and satisfies the
      // schema's required `selector` field.
      selector: pick?.nameChain.join(' > ') ?? '',
      url: screenName ?? Platform.OS,
      viewport: { w: Math.round(width), h: Math.round(height) },
      userAgent: platformTag(),
      screenshot: shot ?? '',
      createdAt: new Date().toISOString(),
    });
    setComment('');
    setPick(null);
    setShot(null);
    setPhase('idle');

    // Agent spawned → stream the run live. Otherwise (spawn off, or POST
    // failed) fall back to a transient toast; pull mode (MCP) picks it up.
    if (result.ok && result.agentSpawned && result.id) {
      setStream({ id: result.id, target });
      return;
    }
    setToast(result.ok ? 'Sent' : `Failed: ${result.error ?? 'unknown'}`);
    setTimeout(() => setToast(null), 2500);
  }, [comment, pick, selectedIndex, activeLoc, shot, screenName, width, height]);

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

      {/* Highlight rect for the last pick, drawn while composing. The RN
          analog of the web widget's outline; coords come from the
          Inspector frame (measured in window space). */}
      {phase === 'composing' && pick?.frame && (
        <View
          pointerEvents="none"
          style={[
            styles.highlight,
            {
              left: pick.frame.x,
              top: pick.frame.y,
              width: pick.frame.width,
              height: pick.frame.height,
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
        onRequestClose={() => setPhase('idle')}
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
            <TextInput
              autoFocus
              multiline
              value={comment}
              onChangeText={setComment}
              placeholder="What should change here?"
              placeholderTextColor="#9aa0a6"
              style={styles.input}
            />
            <View style={styles.composerActions}>
              <Pressable onPress={() => setPhase('idle')} style={styles.btnGhost}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={onSubmit}
                disabled={!comment.trim()}
                style={[styles.btnPrimary, !comment.trim() && styles.btnDisabled]}
              >
                <Text style={styles.btnPrimaryText}>Send</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Floating action button. Toggles picking; shows status while
          sending. Hidden during `capturing` so it stays out of the
          screenshot. */}
      {phase !== 'capturing' && (
        <Pressable
          onPress={() => setPhase((p) => (p === 'picking' ? 'idle' : 'picking'))}
          style={[styles.fab, phase === 'picking' && styles.fabActive]}
        >
          <Text style={styles.fabText}>{phase === 'sending' ? '…' : '💬'}</Text>
        </Pressable>
      )}

      {toast && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Live agent transcript, shown once a run is spawned. */}
      {stream && (
        <StreamSheet
          feedbackId={stream.id}
          target={stream.target}
          onClose={() => setStream(null)}
        />
      )}
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
  breadcrumbRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 2 },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center' },
  breadcrumbSep: { fontSize: 12, color: '#c4c7cc', paddingHorizontal: 4 },
  breadcrumb: { fontSize: 12, color: '#6b7280' },
  breadcrumbSelected: { color: '#2563eb', fontWeight: '600' },
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
    position: 'absolute',
    right: 20,
    bottom: 40,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  fabActive: { backgroundColor: '#3b82f6' },
  fabText: { fontSize: 22 },
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
