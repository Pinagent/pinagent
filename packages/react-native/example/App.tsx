// SPDX-License-Identifier: Apache-2.0
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text, View } from 'react-native';
// In a real app outside this monorepo:
//   import { Pinagent } from '@pinagent/react-native';
// Here we import from source so the example works in-tree without a publish.
import { Pinagent } from '../src/native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pinagent × Expo</Text>
      <Text style={styles.body}>
        Tap the 💬 button, then tap any component below to leave a comment. It POSTs to the Metro
        middleware (see metro.config.js) and lands in .pinagent/db.sqlite.
      </Text>
      <Pressable style={styles.button}>
        <Text style={styles.buttonText}>Primary action</Text>
      </Pressable>
      <Pressable style={styles.buttonGhost}>
        <Text style={styles.buttonGhostText}>Secondary action</Text>
      </Pressable>

      {/* Mount once at the app root. Renders null in release builds. */}
      <Pinagent screenName="Home" />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  body: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
  button: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  buttonGhost: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonGhostText: { color: '#374151', fontWeight: '600' },
});
