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
 * via the RN Inspector and capture a screenshot → type a comment → submit
 * POSTs to the Metro middleware, which stores it and (optionally) spawns
 * an agent. This is a proof-of-concept: single-pick only, no live agent
 * streaming back into the widget (pull mode via MCP works on day one).
 */
import type { ReactElement } from 'react';
import { useCallback, useRef, useState } from 'react';
import {
  findNodeHandle,
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
import { captureScreenshot } from './screenshot';
import { platformTag, submitFeedback } from './transport';
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

type Phase = 'idle' | 'picking' | 'composing' | 'sending' | 'sent';

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
  const rootRef = useRef<View>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [pick, setPick] = useState<PickResult | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const onPickTap = useCallback(
    async (x: number, y: number) => {
      // Capture the screen first (before the composer covers it), then
      // resolve which component was under the tap.
      const [screenshot, picked] = await Promise.all([
        captureScreenshot(),
        resolvePick(findNodeHandle(rootRef.current), x, y, projectRoot),
      ]);
      setShot(screenshot);
      setPick(picked);
      setPhase('composing');
    },
    [projectRoot],
  );

  const onSubmit = useCallback(async () => {
    if (!comment.trim()) return;
    setPhase('sending');
    const result = await submitFeedback({
      comment: comment.trim(),
      loc: pick?.loc ?? null,
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
    setPhase('sent');
    setToast(
      result.ok
        ? result.agentSpawned
          ? 'Sent — agent working on it'
          : 'Sent'
        : `Failed: ${result.error ?? 'unknown'}`,
    );
    setTimeout(() => {
      setToast(null);
      setPhase('idle');
    }, 2500);
  }, [comment, pick, shot, screenName, width, height]);

  return (
    // collapsable={false} keeps this View in the native tree so
    // findNodeHandle resolves a real tag for the Inspector call.
    <View
      ref={rootRef}
      collapsable={false}
      style={StyleSheet.absoluteFill}
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
        <View style={styles.composerBackdrop}>
          <View style={styles.composer}>
            <Text style={styles.composerTitle}>
              {pick?.loc
                ? `${pick.loc.file}:${pick.loc.line}`
                : (pick?.nameChain.at(-1) ?? 'Unknown component')}
            </Text>
            {pick?.nameChain.length ? (
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
          sending. */}
      <Pressable
        onPress={() => setPhase((p) => (p === 'picking' ? 'idle' : 'picking'))}
        style={[styles.fab, phase === 'picking' && styles.fabActive]}
      >
        <Text style={styles.fabText}>{phase === 'sending' ? '…' : '💬'}</Text>
      </Pressable>

      {toast && (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  breadcrumb: { fontSize: 12, color: '#6b7280' },
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
