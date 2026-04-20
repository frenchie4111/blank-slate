import * as React from 'react';
import * as ReactNative from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BUILTIN_MODULES: Record<string, unknown> = {
  react: React,
  'react-native': ReactNative,
  '@react-native-async-storage/async-storage': AsyncStorage,
};

export const ALLOWLIST = Object.keys(BUILTIN_MODULES);

export function isBuiltin(spec: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_MODULES, spec);
}
