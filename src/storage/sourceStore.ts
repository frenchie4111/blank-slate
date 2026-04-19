import AsyncStorage from '@react-native-async-storage/async-storage';

const HISTORY_KEY = 'blank-slate.source-history.v1';
const MAX_HISTORY = 10;

export type SourceVersion = {
  code: string;
  savedAt: number;
};

export async function loadHistory(): Promise<SourceVersion[]> {
  const raw = await AsyncStorage.getItem(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SourceVersion[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveVersion(code: string): Promise<SourceVersion[]> {
  const existing = await loadHistory();
  const last = existing[existing.length - 1];
  if (last && last.code === code) return existing;
  const next = [...existing, { code, savedAt: Date.now() }].slice(-MAX_HISTORY);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export async function popVersion(): Promise<SourceVersion[]> {
  const existing = await loadHistory();
  if (existing.length <= 1) return existing;
  const next = existing.slice(0, -1);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function latest(history: SourceVersion[]): string | null {
  return history.length ? history[history.length - 1].code : null;
}
