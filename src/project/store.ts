import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultTint, type Glyph, type Tint } from './appearance';

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // Home-screen tile look. Optional: older projects fall back to
  // appearanceOf() defaults.
  tint?: Tint;
  glyph?: Glyph;
};

export type ProjectAppearance = { tint?: Tint; glyph?: Glyph };

const PROJECTS_INDEX_KEY = 'projects:index';
const CURRENT_PROJECT_KEY = 'projects:current';
const LEGACY_V2_VFS_INDEX = 'vfs:index';
const LEGACY_V2_VFS_FILE_PREFIX = 'vfs:file:';
const LEGACY_V1_HISTORY_KEY = 'blank-slate.source-history.v1';

export const STARTER_APP = `import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function App() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Blank Slate</Text>
      <Text style={styles.body}>
        Tap the badge in the top-left to chat with the agent about what this app
        should become.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fafafa',
    padding: 24,
  },
  title: { fontSize: 28, fontWeight: '700', color: '#111', marginBottom: 10 },
  body: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 20 },
});
`;

let currentProjectId: string | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {}
  }
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function indexKeyFor(id: string): string {
  return `project:${id}:vfs:index`;
}

export function fileKeyFor(id: string, path: string): string {
  return `project:${id}:vfs:file:${path}`;
}

export function chatHistoryKeyFor(id: string): string {
  return `project:${id}:chat:history`;
}

export function chatEntriesKeyFor(id: string): string {
  return `project:${id}:chat:entries`;
}

async function loadProjects(): Promise<Project[]> {
  const raw = await AsyncStorage.getItem(PROJECTS_INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: unknown): p is Project =>
        !!p &&
        typeof (p as Project).id === 'string' &&
        typeof (p as Project).name === 'string',
    );
  } catch {
    return [];
  }
}

async function saveProjects(projects: Project[]): Promise<void> {
  await AsyncStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(projects));
}

async function writeProjectFile(id: string, path: string, content: string): Promise<void> {
  const idxKey = indexKeyFor(id);
  const raw = await AsyncStorage.getItem(idxKey);
  let idx: string[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) idx = parsed.filter((x): x is string => typeof x === 'string');
    } catch {}
  }
  if (!idx.includes(path)) {
    idx.push(path);
    await AsyncStorage.setItem(idxKey, JSON.stringify(idx));
  }
  await AsyncStorage.setItem(fileKeyFor(id, path), content);
}

async function migrateLegacyV2(intoId: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(LEGACY_V2_VFS_INDEX);
  if (!raw) return false;
  try {
    const paths = JSON.parse(raw);
    if (!Array.isArray(paths)) return false;
    let migrated = false;
    for (const path of paths) {
      if (typeof path !== 'string') continue;
      const content = await AsyncStorage.getItem(LEGACY_V2_VFS_FILE_PREFIX + path);
      if (content !== null) {
        await writeProjectFile(intoId, path, content);
        migrated = true;
      }
    }
    return migrated;
  } catch {
    return false;
  }
}

async function migrateLegacyV1(intoId: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(LEGACY_V1_HISTORY_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    const last = parsed[parsed.length - 1];
    if (!last || typeof last.code !== 'string') return false;
    await writeProjectFile(intoId, 'App.tsx', last.code);
    return true;
  } catch {
    return false;
  }
}

export function init(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const existing = await loadProjects();
    const storedCurrent = await AsyncStorage.getItem(CURRENT_PROJECT_KEY);

    if (existing.length > 0) {
      const valid = existing.find((p) => p.id === storedCurrent) ?? existing[0];
      currentProjectId = valid.id;
      if (storedCurrent !== valid.id) {
        await AsyncStorage.setItem(CURRENT_PROJECT_KEY, valid.id);
      }
      initialized = true;
      return;
    }

    const id = newId();
    const now = Date.now();
    const migrated = (await migrateLegacyV2(id)) || (await migrateLegacyV1(id));
    if (!migrated) {
      await writeProjectFile(id, 'App.tsx', STARTER_APP);
    }

    const project: Project = { id, name: 'First app', createdAt: now, updatedAt: now };
    await saveProjects([project]);
    await AsyncStorage.setItem(CURRENT_PROJECT_KEY, id);
    currentProjectId = id;
    initialized = true;
  })();
  return initPromise;
}

export function getCurrentProjectIdSync(): string {
  if (!initialized || !currentProjectId) {
    throw new Error('project store not initialized — call init() first');
  }
  return currentProjectId;
}

export async function list(): Promise<Project[]> {
  return loadProjects();
}

export async function create(
  rawName: string,
  appearance: ProjectAppearance = {},
): Promise<Project> {
  const projects = await loadProjects();
  const id = newId();
  const now = Date.now();
  const name = rawName.trim() || `Untitled ${projects.length + 1}`;
  await writeProjectFile(id, 'App.tsx', STARTER_APP);
  const project: Project = {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    tint: appearance.tint ?? defaultTint(id),
    ...(appearance.glyph ? { glyph: appearance.glyph } : {}),
  };
  await saveProjects([...projects, project]);
  emit();
  return project;
}

export async function switchTo(id: string): Promise<void> {
  const projects = await loadProjects();
  if (!projects.some((p) => p.id === id)) throw new Error(`project ${id} not found`);
  await AsyncStorage.setItem(CURRENT_PROJECT_KEY, id);
  currentProjectId = id;
  emit();
}

export async function rename(id: string, rawName: string): Promise<void> {
  const name = rawName.trim();
  if (!name) return;
  const projects = await loadProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error(`project ${id} not found`);
  const next = projects.slice();
  next[idx] = { ...next[idx], name, updatedAt: Date.now() };
  await saveProjects(next);
  emit();
}

export async function remove(id: string): Promise<void> {
  const projects = await loadProjects();
  if (projects.length <= 1) throw new Error('cannot delete the last project');
  const remaining = projects.filter((p) => p.id !== id);
  if (remaining.length === projects.length) return;

  const idxKey = indexKeyFor(id);
  const rawIdx = await AsyncStorage.getItem(idxKey);
  const toRemove: string[] = [idxKey, chatHistoryKeyFor(id), chatEntriesKeyFor(id)];
  if (rawIdx) {
    try {
      const paths = JSON.parse(rawIdx);
      if (Array.isArray(paths)) {
        for (const p of paths) {
          if (typeof p === 'string') toRemove.push(fileKeyFor(id, p));
        }
      }
    } catch {}
  }
  await AsyncStorage.multiRemove(toRemove);
  await saveProjects(remaining);

  if (currentProjectId === id) {
    currentProjectId = remaining[0].id;
    await AsyncStorage.setItem(CURRENT_PROJECT_KEY, currentProjectId);
  }
  emit();
}

export async function setAppearance(id: string, appearance: ProjectAppearance): Promise<void> {
  const projects = await loadProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx < 0) throw new Error(`project ${id} not found`);
  const next = projects.slice();
  next[idx] = { ...next[idx], ...appearance };
  await saveProjects(next);
  emit();
}

// Bumps updatedAt so "Your apps" can show when a project was last worked on.
export async function touch(id: string): Promise<void> {
  const projects = await loadProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx < 0) return;
  const next = projects.slice();
  next[idx] = { ...next[idx], updatedAt: Date.now() };
  await saveProjects(next);
  emit();
}
