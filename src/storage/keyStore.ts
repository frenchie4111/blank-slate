import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_MODEL } from '../agent/models';

const API_KEY = 'blank-slate.openrouter-key';
// Left behind by builds that talked to Anthropic directly. Deleted on reset.
const LEGACY_ANTHROPIC_KEY = 'blank-slate.anthropic-key';
const MODEL_KEY = 'blank-slate.model';

const useSecure = Platform.OS === 'ios' || Platform.OS === 'android';

export async function getApiKey(): Promise<string | null> {
  if (useSecure) {
    return (await SecureStore.getItemAsync(API_KEY)) ?? null;
  }
  return AsyncStorage.getItem(API_KEY);
}

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (useSecure) {
    await SecureStore.setItemAsync(API_KEY, trimmed);
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
  await AsyncStorage.multiRemove([API_KEY, LEGACY_ANTHROPIC_KEY]);
}

// The model ID isn't secret, so it lives in AsyncStorage on every platform.
export async function getModel(): Promise<string> {
  return (await AsyncStorage.getItem(MODEL_KEY)) || DEFAULT_MODEL;
}

export async function setModel(model: string): Promise<void> {
  await AsyncStorage.setItem(MODEL_KEY, model.trim());
}
