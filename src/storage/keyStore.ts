import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_MODEL } from '../agent/models';
import { desktopSecureStore } from '../platform/desktop';

const API_KEY = 'blank-slate.openrouter-key';
// Left behind by builds that talked to Anthropic directly. Deleted on reset.
const LEGACY_ANTHROPIC_KEY = 'blank-slate.anthropic-key';
const MODEL_KEY = 'blank-slate.model';
const AUTO_ICONS_KEY = 'blank-slate.auto-app-icons';

const useSecure = Platform.OS === 'ios' || Platform.OS === 'android';

// In the Electron shell the key goes to the main process, which encrypts it
// with safeStorage (Keychain on mac). A plain browser falls back to
// AsyncStorage, which on web is localStorage.
export async function getApiKey(): Promise<string | null> {
  if (useSecure) {
    return (await SecureStore.getItemAsync(API_KEY)) ?? null;
  }
  const desktop = desktopSecureStore();
  if (desktop) {
    const stored = await desktop.get(API_KEY);
    if (stored) return stored;
    // A key saved by the web build before the shell had a secure store.
    const legacy = await AsyncStorage.getItem(API_KEY);
    if (!legacy) return null;
    await desktop.set(API_KEY, legacy);
    await AsyncStorage.removeItem(API_KEY);
    return legacy;
  }
  return AsyncStorage.getItem(API_KEY);
}

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (useSecure) {
    await SecureStore.setItemAsync(API_KEY, trimmed);
    return;
  }
  const desktop = desktopSecureStore();
  if (desktop) {
    await desktop.set(API_KEY, trimmed);
    await AsyncStorage.removeItem(API_KEY);
    return;
  }
  await AsyncStorage.setItem(API_KEY, trimmed);
}

export async function clearApiKey(): Promise<void> {
  if (useSecure) {
    await SecureStore.deleteItemAsync(API_KEY);
    await SecureStore.deleteItemAsync(LEGACY_ANTHROPIC_KEY);
    return;
  }
  const desktop = desktopSecureStore();
  if (desktop) await desktop.delete(API_KEY);
  await AsyncStorage.multiRemove([API_KEY, LEGACY_ANTHROPIC_KEY]);
}

// The model ID isn't secret, so it lives in AsyncStorage on every platform.
export async function getModel(): Promise<string> {
  return (await AsyncStorage.getItem(MODEL_KEY)) || DEFAULT_MODEL;
}

export async function setModel(model: string): Promise<void> {
  await AsyncStorage.setItem(MODEL_KEY, model.trim());
}

// On by default: the agent makes an icon (~$0.035) for each new app it builds.
export async function getAutoAppIcons(): Promise<boolean> {
  return (await AsyncStorage.getItem(AUTO_ICONS_KEY)) !== 'off';
}

export async function setAutoAppIcons(on: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTO_ICONS_KEY, on ? 'on' : 'off');
}
