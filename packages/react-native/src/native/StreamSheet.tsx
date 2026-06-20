// SPDX-License-Identifier: Apache-2.0
/**
 * Live agent transcript sheet for React Native.
 *
 * After a comment is submitted and an agent is spawned, the widget opens this
 * bottom sheet and streams the run over WebSocket (see `ws-client.ts`). It's
 * the RN analog of the web widget's agent tray: a scrolling transcript, an
 * answer form when the agent calls `ask_user`, a follow-up box, and Stop /
 * Dismiss controls.
 *
 * State is intentionally simple and reducer-driven: agent events accumulate in
 * one array folded by `renderTranscript`; user follow-ups are tracked locally
 * (the bus only streams agent events, not the developer's messages). A
 * reconnect replays the agent transcript, so we clear `events` on `onReset`
 * but keep local follow-ups.
 *
 * The sheet can be **minimized**: the run drops into the compact bottom-left
 * `AgentDock` (a chip / count bar) so the developer can keep interacting with
 * the app — e.g. to pick another element and spawn a second agent. Minimizing
 * doesn't tear the run down: this component stays mounted and simply renders
 * `null` (the dock draws the compact UI), so the WebSocket keeps streaming in
 * the background and the live transcript is intact the moment it's re-expanded.
 * `<Pinagent/>` mounts one of these per concurrent run and reads each run's
 * derived {@link RunState} (reported via `onState`) to drive the dock.
 */
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { isDismissKey } from './keyboard';
import { MarkdownView } from './MarkdownView';
import { deriveRunState, interruptOverlayActive, type RunState } from './run-state';
import { isNearBottom } from './scroll-follow';
import { type AgentEvent, pendingAsk, renderTranscript } from './transcript';
import { StreamClient } from './ws-client';

/** Expanded-sheet header text per run state. */
const HEADER_LABEL: Record<RunState, string> = {
  connecting: 'Connecting',
  working: 'Agent working',
  awaiting: 'Agent needs input',
  done: 'Agent finished',
  failed: 'Agent failed',
};

export interface StreamSheetProps {
  feedbackId: string;
  /** Source label shown in the header (e.g. `file:line` or component name). */
  target: string;
  /** Minimized → render nothing (the dock shows the compact chip); WS stays live. */
  minimized: boolean;
  /** Collapse the full sheet back into the dock. */
  onMinimize: () => void;
  /** Dismiss for good — tears down the WS and removes this run's view. */
  onClose: () => void;
  /**
   * Report the run's derived state up so the dock can render it. `interrupting`
   * is the Stop overlay (ticket 015) — the developer tapped Stop and we're
   * awaiting teardown; the dock relabels the chip to "Stopping…" while active.
   */
  onState: (state: RunState, interrupting: boolean) => void;
}

export function StreamSheet({
  feedbackId,
  target,
  minimized,
  onMinimize,
  onClose,
  onState,
}: StreamSheetProps): ReactElement | null {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [askDraft, setAskDraft] = useState('');
  // The developer tapped Stop and we sent the interrupt frame; we keep showing
  // "Interrupting…" (button disabled) until a terminal event lands (ticket 015).
  // Purely a client-side affordance over the fire-and-forget `interrupt` frame.
  const [interrupting, setInterrupting] = useState(false);

  const clientRef = useRef<StreamClient | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Whether the developer is pinned at (or near) the bottom of the transcript.
  // Starts true so a freshly expanded sheet auto-follows the latest output;
  // flips off the moment they scroll up to re-read, and back on when they
  // return to the bottom. A ref (not state) so updating it on every scroll
  // frame doesn't re-render the sheet.
  const atBottomRef = useRef(true);
  // True until the first auto-scroll on a non-empty transcript lands, so the
  // initial scroll-to-end always fires regardless of measured position.
  const didInitialScrollRef = useRef(false);

  useEffect(() => {
    const client = new StreamClient(feedbackId, {
      // A reconnect replays the transcript from scratch, so clear the events —
      // and the prior transport error, so a recovered run leaves the `failed`
      // state instead of staying stuck red after a successful reconnect.
      onReset: () => {
        setEvents([]);
        setTransportError(null);
        // A reconnect replays a still-live run; drop any stale interrupting
        // affordance so a recovered run reads as working, not stuck "Stopping…".
        setInterrupting(false);
      },
      onEvent: (event) => {
        setEvents((prev) => [...prev, event]);
        if (event.type === 'result') setDone(true);
      },
      onDone: () => setDone(true),
      onError: (message) => setTransportError(message),
    });
    clientRef.current = client;
    client.start();
    return () => client.stop();
  }, [feedbackId]);

  const rows = useMemo(() => renderTranscript(events), [events]);
  const ask = useMemo(() => pendingAsk(events), [events]);
  const state = deriveRunState({ events, done, transportError, answered });
  const askOpen = state === 'awaiting' && !!ask;
  const running = state === 'connecting' || state === 'working' || state === 'awaiting';
  // The interrupt only shows while the run is still active; once a terminal
  // event lands the run is done/failed and the overlay no longer applies.
  const showInterrupting = interruptOverlayActive(state, interrupting);

  // A terminal event cleared the run — drop the local interrupting flag so a
  // subsequent follow-up (which resumes the run) starts fresh, not "Stopping…".
  useEffect(() => {
    if (interrupting && !interruptOverlayActive(state, true)) setInterrupting(false);
  }, [state, interrupting]);

  // Report the derived state up to <Pinagent/> so the dock reflects it. The
  // callback is held in a ref so the effect fires only on a real state change
  // (not whenever the parent passes a fresh inline `onState`). Runs while
  // minimized too — this component stays mounted and only renders null.
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  useEffect(() => {
    onStateRef.current(state, showInterrupting);
  }, [state, showInterrupting]);

  // Track whether the developer is parked at the bottom so a content change
  // only re-pins when they haven't scrolled up to re-read (chat-log behavior).
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    atBottomRef.current = isNearBottom({
      offsetY: contentOffset.y,
      viewportH: layoutMeasurement.height,
      contentH: contentSize.height,
    });
  }, []);

  // On a content change, auto-follow only when pinned at the bottom — except the
  // very first non-empty layout, which always lands at the latest so a freshly
  // expanded sheet opens scrolled to the end.
  const onContentSizeChange = useCallback(() => {
    if (didInitialScrollRef.current && !atBottomRef.current) return;
    didInitialScrollRef.current = true;
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Minimized: render nothing. The WS hooks above keep running because the
  // component stays mounted; the compact chip is drawn by the dock from the
  // state we report. Re-expanding shows the full sheet with live state intact.
  if (minimized) return null;

  function submitAnswer(answer: string): void {
    if (!ask || !answer.trim()) return;
    clientRef.current?.sendAskResponse(ask.askId, answer.trim());
    setAnswered((prev) => ({ ...prev, [ask.askId]: answer.trim() }));
    setAskDraft('');
  }

  function sendFollowUp(): void {
    const text = draft.trim();
    if (!text) return;
    clientRef.current?.sendUserMessage(text);
    setFollowUps((prev) => [...prev, text]);
    setDraft('');
    // A follow-up resumes the run: clear the terminal/error flags so it leaves
    // the done/failed state and reads as working again — and drop any pending
    // interrupt (the developer is continuing, not stopping).
    setDone(false);
    setTransportError(null);
    setInterrupting(false);
  }

  // Stop: send the interrupt frame and immediately show "Interrupting…" until a
  // terminal event lands. `interrupt()` reports whether the frame actually went
  // out — if the socket is mid-reconnect it can't, so surface that instead of a
  // silent no-op (ticket 015). Guarded against repeat taps by the disabled state.
  function handleStop(): void {
    if (interrupting) return;
    const sent = clientRef.current?.interrupt() ?? false;
    if (sent) {
      setInterrupting(true);
    } else {
      setTransportError("Couldn't stop — connection lost. Reconnecting…");
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {showInterrupting ? 'Stopping' : HEADER_LABEL[state]} · {target}
            </Text>
            <View style={styles.headerBtns}>
              {/* Minimize: collapse into the dock so the app is interactive
                  again (e.g. to pick another element and spawn a second agent).
                  The run keeps streaming in the background. */}
              <Pressable onPress={onMinimize} hitSlop={8} accessibilityRole="button">
                <Text style={styles.headerBtn}>—</Text>
              </Pressable>
              <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
                <Text style={styles.headerBtn}>✕</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.log}
            contentContainerStyle={styles.logContent}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onContentSizeChange={onContentSizeChange}
          >
            {rows.length === 0 && !transportError ? (
              <Text style={styles.muted}>Connecting…</Text>
            ) : null}

            {rows.map((row) => {
              if (row.kind === 'tool') {
                const mark = row.ok === undefined ? '…' : row.ok ? '✓' : '✗';
                return (
                  <View key={row.id} style={styles.toolRow}>
                    <Text style={styles.toolName}>
                      {mark} {row.text}
                    </Text>
                    {row.detail ? (
                      <Text style={styles.toolDetail} numberOfLines={1}>
                        {row.detail}
                      </Text>
                    ) : null}
                  </View>
                );
              }
              if (row.kind === 'error') {
                return (
                  <Text key={row.id} style={styles.errorRow}>
                    {row.text}
                  </Text>
                );
              }
              if (row.kind === 'result' || row.kind === 'status') {
                return (
                  <Text key={row.id} style={styles.resultRow}>
                    {row.text}
                  </Text>
                );
              }
              if (row.kind === 'ask') {
                return (
                  <Text key={row.id} style={styles.askRow}>
                    {row.text}
                  </Text>
                );
              }
              // Agent prose arrives as Markdown — render it as such rather than
              // dumping the raw `**`/`` ` ``/`#` markers into a plain <Text>.
              return <MarkdownView key={row.id} text={row.text} baseStyle={styles.textRow} />;
            })}

            {followUps.map((m, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only message log — entries are only pushed, never reordered or removed
              <Text key={`you-${i}-${m}`} style={styles.youRow}>
                You: {m}
              </Text>
            ))}

            {transportError ? <Text style={styles.errorRow}>{transportError}</Text> : null}
          </ScrollView>

          {/* Answer form takes over the input area while the agent is blocked. */}
          {askOpen ? (
            <View style={styles.inputBar}>
              {ask.options.length > 0 ? (
                <View style={styles.options}>
                  {ask.options.map((opt) => (
                    <Pressable key={opt} onPress={() => submitAnswer(opt)} style={styles.optionBtn}>
                      <Text style={styles.optionText}>{opt}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <View style={styles.row}>
                <TextInput
                  value={askDraft}
                  onChangeText={setAskDraft}
                  // Enter sends the answer; Escape minimizes the sheet
                  // (web-widget parity). Single-line, so onSubmitEditing fires
                  // reliably on Return; submitBehavior keeps focus. keyboard.ts.
                  returnKeyType="send"
                  submitBehavior="submit"
                  onSubmitEditing={() => submitAnswer(askDraft)}
                  onKeyPress={(e) => {
                    if (isDismissKey(e.nativeEvent.key)) onMinimize();
                  }}
                  placeholder="Answer the agent…"
                  placeholderTextColor="#9aa0a6"
                  style={styles.input}
                />
                <Pressable
                  onPress={() => submitAnswer(askDraft)}
                  disabled={!askDraft.trim()}
                  style={[styles.sendBtn, !askDraft.trim() && styles.disabled]}
                >
                  <Text style={styles.sendText}>Send</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.inputBar}>
              <View style={styles.row}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  // Enter sends the follow-up; Escape minimizes the sheet
                  // (web-widget parity). submitBehavior keeps the keyboard up so
                  // several can be queued in a row. keyboard.ts.
                  returnKeyType="send"
                  submitBehavior="submit"
                  onSubmitEditing={sendFollowUp}
                  onKeyPress={(e) => {
                    if (isDismissKey(e.nativeEvent.key)) onMinimize();
                  }}
                  placeholder={running ? 'Queue a follow-up…' : 'Send a follow-up…'}
                  placeholderTextColor="#9aa0a6"
                  style={styles.input}
                />
                <Pressable
                  onPress={sendFollowUp}
                  disabled={!draft.trim()}
                  style={[styles.sendBtn, !draft.trim() && styles.disabled]}
                >
                  <Text style={styles.sendText}>Send</Text>
                </Pressable>
              </View>
              <Pressable
                onPress={() => (running ? handleStop() : onClose())}
                // Disable repeat taps while the interrupt is in flight; the
                // affordance clears itself on the run's terminal event.
                disabled={running && showInterrupting}
                accessibilityRole="button"
                accessibilityState={{ disabled: running && showInterrupting }}
                style={[styles.bottomBtn, showInterrupting && styles.disabled]}
              >
                <Text style={styles.bottomBtnText}>
                  {running ? (showInterrupting ? 'Interrupting…' : 'Stop') : 'Dismiss'}
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    paddingBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: '#111827' },
  headerBtns: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerBtn: { fontSize: 16, color: '#6b7280', paddingLeft: 4 },
  log: { paddingHorizontal: 16 },
  logContent: { paddingVertical: 12, gap: 8 },
  muted: { color: '#9aa0a6', fontSize: 13 },
  textRow: { fontSize: 14, color: '#111827', lineHeight: 20 },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toolName: { fontSize: 13, fontWeight: '600', color: '#374151' },
  toolDetail: { flex: 1, fontSize: 12, color: '#6b7280' },
  errorRow: { fontSize: 13, color: '#b91c1c' },
  resultRow: { fontSize: 13, fontWeight: '600', color: '#047857' },
  askRow: { fontSize: 14, color: '#7c3aed', fontWeight: '600' },
  youRow: { fontSize: 14, color: '#2563eb', alignSelf: 'flex-end' },
  inputBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: {
    borderWidth: 1,
    borderColor: '#c4b5fd',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  optionText: { color: '#6d28d9', fontSize: 13, fontWeight: '600' },
  input: {
    flex: 1,
    minHeight: 40,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: '#111827',
  },
  sendBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sendText: { color: '#fff', fontWeight: '600' },
  disabled: { opacity: 0.4 },
  bottomBtn: { alignSelf: 'center', paddingVertical: 8 },
  bottomBtnText: { color: '#6b7280', fontWeight: '600' },
});
