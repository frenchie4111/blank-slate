import * as React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as VectorIcons from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as LinearGradient from 'expo-linear-gradient';
import * as SafeAreaContext from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as SQLite from 'expo-sqlite';
import * as ImagePicker from 'expo-image-picker';
import * as Audio from 'expo-audio';
import * as Video from 'expo-video';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as Blur from 'expo-blur';
import * as ReactNativeSvg from 'react-native-svg';
import { instrumentedReactNative } from '../debug/instrument';

export const BUILTIN_MODULES: Record<string, unknown> = {
  react: React,
  // Same API, but touchables, inputs and Text report to the debug history.
  get 'react-native'() {
    return instrumentedReactNative();
  },
  '@react-native-async-storage/async-storage': AsyncStorage,
  '@react-native-community/datetimepicker': DateTimePicker,
  '@expo/vector-icons': VectorIcons,
  'expo-haptics': Haptics,
  'expo-linear-gradient': LinearGradient,
  'react-native-safe-area-context': SafeAreaContext,
  'expo-clipboard': Clipboard,
  'expo-sqlite': SQLite,
  'expo-image-picker': ImagePicker,
  'expo-audio': Audio,
  'expo-video': Video,
  'expo-notifications': Notifications,
  'expo-location': Location,
  'expo-blur': Blur,
  'react-native-svg': ReactNativeSvg,
};

export const ALLOWLIST = Object.keys(BUILTIN_MODULES);

export function isBuiltin(spec: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_MODULES, spec);
}
