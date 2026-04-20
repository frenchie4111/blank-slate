import * as React from 'react';
import * as ReactNative from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ReactNativeSvg from 'react-native-svg';
import * as ExpoImagePicker from 'expo-image-picker';

export const BUILTIN_MODULES: Record<string, unknown> = {
  react: React,
  'react-native': ReactNative,
  '@react-native-async-storage/async-storage': AsyncStorage,
  'react-native-svg': ReactNativeSvg,
  'expo-image-picker': ExpoImagePicker,
};

export const ALLOWLIST = Object.keys(BUILTIN_MODULES);

export function isBuiltin(spec: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_MODULES, spec);
}
