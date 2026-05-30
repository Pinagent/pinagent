// SPDX-License-Identifier: Apache-2.0
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

type FeatureCardProps = {
  emoji: string;
  title: string;
  body: string;
};

export function FeatureCard({ emoji, title, body }: FeatureCardProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.emoji}>{emoji}</Text>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  emoji: { fontSize: 28 },
  text: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '600', color: theme.text },
  body: { fontSize: 13, color: theme.textMuted, lineHeight: 18 },
});
