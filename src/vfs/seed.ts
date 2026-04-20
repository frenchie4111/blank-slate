import AsyncStorage from '@react-native-async-storage/async-storage';
import { indexExists, writeFile } from './vfs';

const LEGACY_HISTORY_KEY = 'blank-slate.source-history.v1';

const STARTER_APP = `import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Blank Slate</Text>
      <Text style={styles.body}>
        Tap the badge in the top-left to chat with Claude about what this app
        should become.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fafafa',
    padding: 24,
  },
  title: { fontSize: 28, fontWeight: '700', color: '#111', marginBottom: 10 },
  body: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 20 },
});
`;

export async function seedIfEmpty(): Promise<void> {
  if (await indexExists()) return;

  const migrated = await tryMigrateFromV1();
  if (migrated) return;

  await writeFile('App.tsx', STARTER_APP);
}

async function tryMigrateFromV1(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(LEGACY_HISTORY_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    const last = parsed[parsed.length - 1];
    if (!last || typeof last.code !== 'string') return false;
    await writeFile('App.tsx', last.code);
    return true;
  } catch {
    return false;
  }
}
