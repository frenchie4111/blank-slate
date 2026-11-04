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
import { Platform } from 'react-native';
import * as AppKit from '../appkit';
import {
  instrumentedGestureHandler,
  instrumentedNavigation,
  instrumentedReactNative,
  instrumentedSensors,
  instrumentedSvg,
  instrumentedVectorIcons,
} from '../debug/instrument';
import { hasExpoModule, hasTurboModule, lazyNative } from './lazyNative';

// Native navigation, SF Symbols and gesture handler came with a later binary
// than some that run this JS; see lazyNative.
const hasScreens = () => hasTurboModule('RNSModule');
const loadSymbols = lazyNative('expo-symbols', {
  // Off iOS, SymbolView just renders its fallback.
  available: () => Platform.OS !== 'ios' || hasExpoModule('SymbolModule'),
  // `import SymbolView from 'expo-symbols'` is a common guess; make it work.
  load: () => {
    const mod = require('expo-symbols');
    return { ...mod, __esModule: true, default: mod.SymbolView };
  },
});
const loadNavigation = lazyNative('@react-navigation/native', {
  available: hasScreens,
  load: () => instrumentedNavigation(require('@react-navigation/native')),
});
const loadNativeStack = lazyNative('@react-navigation/native-stack', {
  available: hasScreens,
  load: () => require('@react-navigation/native-stack'),
});
const loadBottomTabs = lazyNative('@react-navigation/bottom-tabs', {
  available: hasScreens,
  load: () => require('@react-navigation/bottom-tabs'),
});
const loadGestureHandler = lazyNative('react-native-gesture-handler', {
  available: () => hasTurboModule('RNGestureHandlerModule'),
  load: () => instrumentedGestureHandler(require('react-native-gesture-handler')),
});

// expo-sensors is newer than some binaries this JS reaches over the air, and
// it touches its native modules as soon as it's evaluated. Loaded on first
// import, so a missing module is a compile error in the app that wanted it
// rather than a crash at startup.
let sensors: Record<string, unknown> | null | undefined;
function loadSensors(): Record<string, unknown> {
  if (sensors === undefined) {
    try {
      sensors = instrumentedSensors(require('expo-sensors'));
    } catch {
      sensors = null;
    }
  }
  if (!sensors) throw new Error('expo-sensors needs a newer build of Blank Slate. Update the app to use it.');
  return sensors;
}

export const BUILTIN_MODULES: Record<string, unknown> = {
  react: React,
  // Same API, but touchables, inputs and Text report to the debug history.
  get 'react-native'() {
    return instrumentedReactNative();
  },
  '@react-native-async-storage/async-storage': AsyncStorage,
  '@react-native-community/datetimepicker': DateTimePicker,
  get '@expo/vector-icons'() {
    return instrumentedVectorIcons(VectorIcons as unknown as Record<string, any>);
  },
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
  get 'react-native-svg'() {
    return instrumentedSvg(ReactNativeSvg as unknown as Record<string, any>);
  },
  get 'expo-sensors'() {
    return loadSensors();
  },
  'blank-slate/app': AppKit,
  get 'expo-symbols'() {
    return loadSymbols();
  },
  get '@react-navigation/native'() {
    return loadNavigation();
  },
  get '@react-navigation/native-stack'() {
    return loadNativeStack();
  },
  get '@react-navigation/bottom-tabs'() {
    return loadBottomTabs();
  },
  get 'react-native-gesture-handler'() {
    return loadGestureHandler();
  },
  // The documented deep import for the Animated-based Swipeable.
  get 'react-native-gesture-handler/Swipeable'() {
    const Swipeable = loadGestureHandler().Swipeable;
    return { __esModule: true, default: Swipeable, Swipeable };
  },
};

/** GestureHandlerRootView when the binary has gesture handler, else null. */
export function gestureRoot(): React.ComponentType<{ style?: object; children?: React.ReactNode }> | null {
  try {
    return loadGestureHandler().GestureHandlerRootView as React.ComponentType<{ style?: object; children?: React.ReactNode }>;
  } catch {
    return null;
  }
}

export const ALLOWLIST = Object.keys(BUILTIN_MODULES);

export function isBuiltin(spec: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_MODULES, spec);
}
