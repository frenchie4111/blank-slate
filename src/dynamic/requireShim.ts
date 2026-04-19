import * as React from 'react';
import * as ReactNative from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MODULES: Record<string, unknown> = {
  react: React,
  'react-native': ReactNative,
  '@react-native-async-storage/async-storage': AsyncStorage,
};

export const ALLOWLIST = Object.keys(MODULES);

export function requireShim(name: string): unknown {
  if (name in MODULES) return MODULES[name];
  throw new Error(
    `Module "${name}" is not available in Blank Slate. Allowed modules: ${ALLOWLIST.join(', ')}.`,
  );
}
