import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_KEY = 'blank-slate.anthropic-key';

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
    return;
  }
  await AsyncStorage.removeItem(API_KEY);
}
