// SPDX-License-Identifier: Apache-2.0
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';
// In a real app outside this monorepo this is just:
//   import { Pinagent } from '@pinagent/react-native';
// Here we import the in-tree source directly so the demo needs no publish.
// (Metro watches that folder — see metro.config.js's watchFolders.)
import { Pinagent } from '../../packages/react-native/src/native';
import { TabBar, type TabKey } from './components/TabBar';
import { HomeScreen } from './screens/HomeScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { theme } from './theme';

export default function App() {
  const [tab, setTab] = useState<TabKey>('home');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.screen}>{tab === 'home' ? <HomeScreen /> : <ProfileScreen />}</View>
      <TabBar active={tab} onChange={setTab} />

      {/* Mount once at the app root. screenName is recorded with each comment.
          Renders null in release builds (__DEV__ === false). */}
      <Pinagent screenName={tab} />
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  screen: { flex: 1 },
});
