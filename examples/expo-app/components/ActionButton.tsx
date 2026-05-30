// SPDX-License-Identifier: Apache-2.0
import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../theme';

type ActionButtonProps = {
  label: string;
  variant?: 'primary' | 'ghost';
  onPress?: () => void;
};

export function ActionButton({ label, variant = 'primary', onPress }: ActionButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable onPress={onPress} style={[styles.base, isPrimary ? styles.primary : styles.ghost]}>
      <Text style={isPrimary ? styles.primaryText : styles.ghostText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primary: { backgroundColor: theme.primary },
  ghost: { borderWidth: 1, borderColor: theme.border },
  primaryText: { color: theme.primaryText, fontWeight: '600' },
  ghostText: { color: theme.text, fontWeight: '600' },
});
