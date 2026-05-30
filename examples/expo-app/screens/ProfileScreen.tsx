// SPDX-License-Identifier: Apache-2.0
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActionButton } from '../components/ActionButton';
import { Header } from '../components/Header';
import { ListRow } from '../components/ListRow';
import { theme } from '../theme';

export function ProfileScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header title="Profile" subtitle="A second screen so the screenName changes." />

      <View style={styles.list}>
        <ListRow label="Name" value="Ada Lovelace" />
        <ListRow label="Plan" value="Pro" />
        <ListRow label="Comments filed" value="12" />
        <ListRow label="Open" value="3" />
      </View>

      <View style={styles.actions}>
        <ActionButton label="Edit profile" variant="primary" />
        <ActionButton label="Sign out" variant="ghost" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 20 },
  list: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.bg,
    overflow: 'hidden',
  },
  actions: { gap: 12 },
});
