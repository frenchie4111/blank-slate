import AsyncStorage from '@react-native-async-storage/async-storage';
import { fileKeyFor, getCurrentProjectIdSync, indexKeyFor } from '../project/store';

export type VfsChange = { type: 'write' | 'delete'; path: string; projectId: string };

type Listener = (change: VfsChange) => void;

const listeners = new Set<Listener>();

// Image assets (from generate_image) are stored as data URLs under these
// extensions. Code imports them like `import logo from './assets/logo.png'`.
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

export function isImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return IMAGE_EXTS.some((e) => lower.endsWith(e));
}

export function normalizePath(raw: string): string {
  let p = raw.trim();
  while (p.startsWith('./')) p = p.slice(2);
  while (p.startsWith('/')) p = p.slice(1);
  if (!p) throw new Error('Empty path');
  if (p.includes('\\')) throw new Error('Use POSIX-style paths (forward slashes)');
  return p;
}

async function loadIndex(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(indexKeyFor(getCurrentProjectIdSync()));
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
  await AsyncStorage.setItem(indexKeyFor(getCurrentProjectIdSync()), JSON.stringify(paths));
}

export async function listFiles(): Promise<string[]> {
  const idx = await loadIndex();
  return [...idx].sort();
}

export async function readFile(path: string): Promise<string | null> {
  const p = normalizePath(path);
  return AsyncStorage.getItem(fileKeyFor(getCurrentProjectIdSync(), p));
}

export async function writeFile(path: string, content: string): Promise<void> {
  const p = normalizePath(path);
  const idx = await loadIndex();
  if (!idx.includes(p)) {
    idx.push(p);
    await saveIndex(idx);
  }
  const projectId = getCurrentProjectIdSync();
  await AsyncStorage.setItem(fileKeyFor(projectId, p), content);
  emit({ type: 'write', path: p, projectId });
}

export async function deleteFile(path: string): Promise<void> {
  const p = normalizePath(path);
  const idx = await loadIndex();
  const next = idx.filter((x) => x !== p);
  if (next.length !== idx.length) await saveIndex(next);
  const projectId = getCurrentProjectIdSync();
  await AsyncStorage.removeItem(fileKeyFor(projectId, p));
  emit({ type: 'delete', path: p, projectId });
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(change: VfsChange): void {
  for (const l of listeners) {
    try {
      l(change);
    } catch {}
  }
}
