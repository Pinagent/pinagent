// SPDX-License-Identifier: Apache-2.0
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ActionButton } from '../components/ActionButton';
import { FeatureCard } from '../components/FeatureCard';
import { Header } from '../components/Header';
import { theme } from '../theme';

export function HomeScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header title="Pinagent × Expo" subtitle="Tap 💬, then tap any component below." />

      <View style={styles.callout}>
        <Text style={styles.calloutText}>
          Every component here lives in its own file. Tap one and the composer shows its file:line —
          the same anchor an agent uses to make the fix.
        </Text>
      </View>

      <FeatureCard
        emoji="👆"
        title="Tap to comment"
        body="The RN inspector resolves your tap to the JSX source location."
      />
      <FeatureCard
        emoji="📸"
        title="Screenshot attached"
        body="react-native-view-shot captures what you selected."
      />
      <FeatureCard
        emoji="🤖"
        title="Agent picks it up"
        body="Feedback lands in .pinagent/db.sqlite for an inline or MCP-driven agent."
      />

      <View style={styles.actions}>
        <ActionButton label="Primary action" variant="primary" />
        <ActionButton label="Secondary action" variant="ghost" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 16 },
  callout: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  calloutText: { fontSize: 13, color: theme.textMuted, lineHeight: 19 },
  actions: { gap: 12, paddingTop: 4 },
});
