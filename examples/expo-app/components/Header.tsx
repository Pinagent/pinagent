// SPDX-License-Identifier: Apache-2.0
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

type HeaderProps = {
  title: string;
  subtitle?: string;
};

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 4, paddingBottom: 8 },
  title: { fontSize: 26, fontWeight: '700', color: theme.text },
  subtitle: { fontSize: 14, color: theme.textMuted },
});
