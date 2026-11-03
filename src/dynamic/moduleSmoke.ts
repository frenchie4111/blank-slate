import { writeFile, deleteFile } from '../vfs/vfs';
import { compileEntry, invalidate, type CompileResult } from './resolver';

export const SMOKE_PATH = '__moduleSmoke__.tsx';

export const SMOKE_TSX = `import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as SQLite from 'expo-sqlite';
import * as ImagePicker from 'expo-image-picker';
import { useAudioPlayer } from 'expo-audio';
import { VideoView } from 'expo-video';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { BlurView } from 'expo-blur';
import { Accelerometer, Pedometer } from 'expo-sensors';

// Reference every imported symbol so no optimizer can drop it.
const refs: Array<unknown> = [
  React,
  View, Text, StyleSheet,
  AsyncStorage,
  DateTimePicker,
  Ionicons, MaterialIcons,
  Haptics,
  LinearGradient,
  SafeAreaProvider, useSafeAreaInsets,
  Clipboard,
  SQLite,
  ImagePicker,
  useAudioPlayer,
  VideoView,
  Notifications,
  Location,
  BlurView,
  Accelerometer, Pedometer,
];

function assertDefined(label: string, v: unknown): void {
  if (v === undefined || v === null) {
    throw new Error('module-smoke: ' + label + ' resolved to ' + String(v));
  }
}

assertDefined('AsyncStorage', AsyncStorage);
assertDefined('DateTimePicker', DateTimePicker);
assertDefined('Ionicons', Ionicons);
assertDefined('MaterialIcons', MaterialIcons);
assertDefined('Haptics', Haptics);
assertDefined('Haptics.selectionAsync', Haptics.selectionAsync);
assertDefined('LinearGradient', LinearGradient);
assertDefined('SafeAreaProvider', SafeAreaProvider);
assertDefined('useSafeAreaInsets', useSafeAreaInsets);
assertDefined('Clipboard', Clipboard);
assertDefined('Clipboard.setStringAsync', Clipboard.setStringAsync);
assertDefined('SQLite', SQLite);
assertDefined('SQLite.openDatabaseAsync', SQLite.openDatabaseAsync);
assertDefined('ImagePicker', ImagePicker);
assertDefined('ImagePicker.launchImageLibraryAsync', ImagePicker.launchImageLibraryAsync);
assertDefined('useAudioPlayer', useAudioPlayer);
assertDefined('VideoView', VideoView);
assertDefined('Notifications', Notifications);
assertDefined('Notifications.scheduleNotificationAsync', Notifications.scheduleNotificationAsync);
assertDefined('Location', Location);
assertDefined('Location.getCurrentPositionAsync', Location.getCurrentPositionAsync);
assertDefined('BlurView', BlurView);
assertDefined('Accelerometer.isAvailableAsync', Accelerometer.isAvailableAsync);
assertDefined('Accelerometer.addListener', Accelerometer.addListener);
assertDefined('Pedometer.watchStepCount', Pedometer.watchStepCount);

export default function Smoke() {
  void refs;
  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <LinearGradient colors={['#f0f', '#0ff']} style={styles.grad} />
        <BlurView intensity={30} style={styles.blur}>
          <Ionicons name="heart" size={24} color="#f33" />
          <Text>smoke</Text>
        </BlurView>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grad: { height: 20 },
  blur: { padding: 10 },
});
`;

export async function runSmokeTest(): Promise<CompileResult> {
  await writeFile(SMOKE_PATH, SMOKE_TSX);
  invalidate(SMOKE_PATH);
  try {
    return await compileEntry(SMOKE_PATH);
  } finally {
    await deleteFile(SMOKE_PATH);
    invalidate(SMOKE_PATH);
  }
}
