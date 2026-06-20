// SPDX-License-Identifier: Apache-2.0
/**
 * Compact dock for minimized agent runs (bottom-left).
 *
 * Replaces the old one-fat-pill-per-run stack. It renders the pure
 * {@link dockModel} aggregation:
 *
 * - **Active runs** (connecting/working/awaiting) follow a hybrid rule — a
 *   single slim chip when one runs, and a collapsed `◐ N agents · M needs you`
 *   count bar (tap to expand the chip list) once two or more do.
 * - **Finished runs** (done/failed) always roll into a `▸ N finished` summary
 *   you tap to review and clear.
 *
 * Each `StreamSheet` stays mounted (it renders `null` while minimized) so its
 * WebSocket keeps streaming; this dock is fed each run's derived `state` from
 * the parent and is purely presentational. Tapping a chip expands that run's
 * full sheet; ✕ tears it down.
 *
 * All decision logic (partitioning, ordering, headline text) lives in the pure
 * `run-state` module — this file is intentionally just layout + animation, the
 * un-testable RN-runtime layer.
 */
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { type DockRun, dockModel, type RunTone, runPresentation } from './run-state';

export interface AgentDockProps {
  /** Minimized runs with their derived state (the expanded one is excluded). */
  runs: DockRun[];
  /** Expand a run to its full sheet. */
  onExpand: (id: string) => void;
  /** Tear a run down (stops its WS, removes it). */
  onClose: (id: string) => void;
}

/** Concrete colors per semantic tone (kept out of the pure layer). */
const TONE: Record<RunTone, string> = {
  neutral: '#9aa0a6',
  active: '#60a5fa',
  attention: '#c4b5fd',
  success: '#34d399',
  danger: '#f87171',
};

export function AgentDock({ runs, onExpand, onClose }: AgentDockProps): ReactElement | null {
  const model = dockModel(runs);
  // Inline-expand the collapsed active bar / the finished summary into lists.
  const [activeOpen, setActiveOpen] = useState(false);
  const [finishedOpen, setFinishedOpen] = useState(false);

  if (model.active.length === 0 && model.finished.length === 0) return null;

  const showActiveList = !model.collapseActive || activeOpen;

  return (
    <View style={styles.dock} pointerEvents="box-none">
      {/* Active runs: chips when ≤1 (or expanded), else a count bar. */}
      {showActiveList
        ? model.active.map((run) => (
            <AgentChip key={run.id} run={run} onExpand={onExpand} onClose={onClose} />
          ))
        : null}
      {model.collapseActive ? (
        <SummaryBar
          glyph={runPresentation(model.summaryState).glyph}
          tone={runPresentation(model.summaryState).tone}
          pulse={model.awaitingCount > 0}
          label={model.activeHeadline}
          open={activeOpen}
          onPress={() => setActiveOpen((v) => !v)}
        />
      ) : null}

      {/* Finished runs: a roll-up summary, expandable to review/clear. */}
      {model.finished.length > 0 ? (
        <>
          {finishedOpen
            ? model.finished.map((run) => (
                <AgentChip key={run.id} run={run} onExpand={onExpand} onClose={onClose} />
              ))
            : null}
          <SummaryBar
            glyph="▸"
            tone={model.finishedHasFailure ? 'danger' : 'neutral'}
            pulse={false}
            label={`${model.finished.length} finished`}
            open={finishedOpen}
            onPress={() => setFinishedOpen((v) => !v)}
            muted
          />
        </>
      ) : null}
    </View>
  );
}

/** One run as a slim chip: glyph (tone-colored, pulses when blocked) + label. */
function AgentChip({
  run,
  onExpand,
  onClose,
}: {
  run: DockRun;
  onExpand: (id: string) => void;
  onClose: (id: string) => void;
}): ReactElement {
  const p = runPresentation(run.state);
  const pulse = usePulse(p.pulse);
  return (
    <Pressable
      onPress={() => onExpand(run.id)}
      accessibilityRole="button"
      accessibilityLabel={`${p.label}: ${run.target}`}
      style={[styles.chip, p.tone === 'attention' && styles.chipAttention]}
    >
      <Animated.Text style={[styles.chipGlyph, { color: TONE[p.tone], opacity: pulse }]}>
        {p.glyph}
      </Animated.Text>
      <Text style={styles.chipText} numberOfLines={1}>
        {run.target}
      </Text>
      <Pressable
        onPress={() => onClose(run.id)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${run.target}`}
      >
        <Text style={styles.chipClose}>✕</Text>
      </Pressable>
    </Pressable>
  );
}

/** The collapsed count bar for active runs / the finished roll-up. */
function SummaryBar({
  glyph,
  tone,
  pulse,
  label,
  open,
  onPress,
  muted,
}: {
  glyph: string;
  tone: RunTone;
  pulse: boolean;
  label: string;
  open: boolean;
  onPress: () => void;
  muted?: boolean;
}): ReactElement {
  const pulseVal = usePulse(pulse);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}, tap to ${open ? 'collapse' : 'expand'}`}
      style={[styles.chip, muted && styles.barMuted]}
    >
      <Animated.Text style={[styles.chipGlyph, { color: TONE[tone], opacity: pulseVal }]}>
        {glyph}
      </Animated.Text>
      <Text style={[styles.chipText, muted && styles.barMutedText]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.barCaret}>{open ? '▾' : '▴'}</Text>
    </Pressable>
  );
}

/**
 * Drive a looping opacity pulse while `on`, resetting to fully opaque otherwise.
 * Returns the animated value to bind to a glyph's `opacity`.
 */
function usePulse(on: boolean): Animated.Value {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, pulse]);
  return pulse;
}

const CHIP_HEIGHT = 30;

const styles = StyleSheet.create({
  // Bottom-left cluster: chips stack upward, finished summary sits at the
  // bottom. maxWidth keeps it clear of the bottom-right FAB.
  dock: {
    position: 'absolute',
    left: 16,
    bottom: 32,
    maxWidth: '72%',
    gap: 6,
    alignItems: 'flex-start',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: CHIP_HEIGHT,
    paddingHorizontal: 11,
    borderRadius: CHIP_HEIGHT / 2,
    backgroundColor: 'rgba(17,24,39,0.95)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  // A blocked run tints purple so it reads as attention-needed even past color.
  chipAttention: { backgroundColor: 'rgba(76,29,149,0.97)' },
  chipGlyph: { fontSize: 13, fontWeight: '700', width: 14, textAlign: 'center' },
  chipText: { flexShrink: 1, color: '#f3f4f6', fontSize: 12.5, fontWeight: '600' },
  chipClose: { color: '#9aa0a6', fontSize: 12, paddingLeft: 2 },
  barMuted: { backgroundColor: 'rgba(17,24,39,0.82)' },
  barMutedText: { color: '#c7cad1', fontWeight: '500' },
  barCaret: { color: '#9aa0a6', fontSize: 11, paddingLeft: 2 },
});
