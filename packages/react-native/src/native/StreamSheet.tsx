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
 */
import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { type AgentEvent, pendingAsk, renderTranscript } from './transcript';
import { StreamClient } from './ws-client';

export interface StreamSheetProps {
  feedbackId: string;
  /** Source label shown in the header (e.g. `file:line` or component name). */
  target: string;
  onClose: () => void;
}

export function StreamSheet({ feedbackId, target, onClose }: StreamSheetProps): ReactElement {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [askDraft, setAskDraft] = useState('');

  const clientRef = useRef<StreamClient | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const client = new StreamClient(feedbackId, {
      onReset: () => setEvents([]),
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
  const askOpen = ask && !answered[ask.askId];
  const running = !done && !transportError;

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
    setDone(false); // a follow-up resumes the run
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {running ? 'Agent working' : 'Agent finished'} · {target}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.log}
            contentContainerStyle={styles.logContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
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
              return (
                <Text key={row.id} style={styles.textRow}>
                  {row.text}
                </Text>
              );
            })}

            {followUps.map((m, i) => (
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
                onPress={() => (running ? clientRef.current?.interrupt() : onClose())}
                style={styles.bottomBtn}
              >
                <Text style={styles.bottomBtnText}>{running ? 'Stop' : 'Dismiss'}</Text>
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
  close: { fontSize: 16, color: '#6b7280', paddingLeft: 12 },
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
