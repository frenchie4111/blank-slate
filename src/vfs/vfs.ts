import AsyncStorage from '@react-native-async-storage/async-storage';

const INDEX_KEY = 'vfs:index';
const FILE_PREFIX = 'vfs:file:';

type Listener = (change: { type: 'write' | 'delete'; path: string }) => void;

const listeners = new Set<Listener>();

function normalizePath(raw: string): string {
  let p = raw.trim();
  while (p.startsWith('./')) p = p.slice(2);
  while (p.startsWith('/')) p = p.slice(1);
  if (!p) throw new Error('Empty path');
  if (p.includes('\\')) throw new Error('Use POSIX-style paths (forward slashes)');
  return p;
}

async function loadIndex(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

async function saveIndex(paths: string[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(paths));
}

export async function listFiles(): Promise<string[]> {
  const idx = await loadIndex();
  return [...idx].sort();
}

export async function readFile(path: string): Promise<string | null> {
  const p = normalizePath(path);
  return AsyncStorage.getItem(FILE_PREFIX + p);
}

export async function writeFile(path: string, content: string): Promise<void> {
  const p = normalizePath(path);
  const idx = await loadIndex();
  if (!idx.includes(p)) {
    idx.push(p);
    await saveIndex(idx);
  }
  await AsyncStorage.setItem(FILE_PREFIX + p, content);
  emit({ type: 'write', path: p });
}

export async function deleteFile(path: string): Promise<void> {
  const p = normalizePath(path);
  const idx = await loadIndex();
  const next = idx.filter((x) => x !== p);
  if (next.length !== idx.length) await saveIndex(next);
  await AsyncStorage.removeItem(FILE_PREFIX + p);
  emit({ type: 'delete', path: p });
}

export async function indexExists(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  return raw !== null;
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(change: { type: 'write' | 'delete'; path: string }): void {
  for (const l of listeners) {
    try {
      l(change);
    } catch {}
  }
}
