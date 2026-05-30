// SPDX-License-Identifier: Apache-2.0
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

type ListRowProps = {
  label: string;
  value: string;
};

export function ListRow({ label, value }: ListRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  label: { fontSize: 15, color: theme.text },
  value: { fontSize: 15, color: theme.textMuted },
});
