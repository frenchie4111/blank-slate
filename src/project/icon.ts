import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { isImagePath, subscribe as subscribeVfs } from '../vfs/vfs';
import * as projectStore from './store';
import { fileKeyFor } from './store';

// Icons are data URLs living in each project's VFS, often 1-2 MB of base64.
// They're never copied into the projects index; we read them on demand and keep
// the last few in memory so lists of projects don't hit AsyncStorage per render.

type Entry = { path: string; uri: string | null };

const MAX_CACHED = 24;
const cache = new Map<string, Entry>();
// Bumped on every invalidation so a read that started before a write or delete
// doesn't put the stale image back into the cache.
const versions = new Map<string, number>();

type Listener = (projectId: string | null) => void;
const listeners = new Set<Listener>();

function notify(projectId: string | null): void {
  for (const l of listeners) {
    try {
      l(projectId);
    } catch {}
  }
}

function invalidate(projectId: string): void {
  cache.delete(projectId);
  versions.set(projectId, (versions.get(projectId) ?? 0) + 1);
}

function remember(projectId: string, entry: Entry): void {
  cache.delete(projectId);
  cache.set(projectId, entry);
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// An overwrite (generate_image to the same path) or delete of the icon file.
subscribeVfs((change) => {
  if (!isImagePath(change.path)) return;
  const entry = cache.get(change.projectId);
  if (entry && entry.path !== change.path) return;
  invalidate(change.projectId);
  notify(change.projectId);
});

// set_app_icon, project deletion, renames, switches. Drop entries whose
// project is gone or whose iconPath changed, then let hooks re-check.
projectStore.subscribe(() => {
  projectStore
    .list()
    .then((projects) => {
      const byId = new Map(projects.map((p) => [p.id, p]));
      for (const [id, entry] of [...cache]) {
        if (byId.get(id)?.iconPath !== entry.path) invalidate(id);
      }
    })
    .catch(() => {})
    .finally(() => notify(null));
});

/** Data URL of the project's icon, or null if none is set or the file is gone. */
export async function getProjectIconUri(projectId: string): Promise<string | null> {
  const version = versions.get(projectId) ?? 0;
  const project = await projectStore.get(projectId);
  const path = project?.iconPath;
  if (!path) return null;
  const cached = cache.get(projectId);
  if (cached && cached.path === path) return cached.uri;
  const content = await AsyncStorage.getItem(fileKeyFor(projectId, path));
  const uri = content?.startsWith('data:image/') ? content : null;
  if ((versions.get(projectId) ?? 0) === version) remember(projectId, { path, uri });
  return uri;
}

/** Called with the project id that changed, or null when any might have. */
export function subscribeProjectIcons(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The project's icon as a data URL for `<Image source={{ uri }} />`, or null
 * (no icon, file deleted, or still loading). Updates live when the agent sets,
 * regenerates or deletes the icon.
 */
export function useProjectIcon(projectId: string | null | undefined): string | null {
  const [uri, setUri] = React.useState<string | null>(() =>
    projectId ? (cache.get(projectId)?.uri ?? null) : null,
  );

  React.useEffect(() => {
    if (!projectId) {
      setUri(null);
      return;
    }
    let alive = true;
    let request = 0;
    const load = () => {
      const mine = ++request;
      getProjectIconUri(projectId)
        .catch(() => null)
        .then((next) => {
          if (alive && mine === request) setUri(next);
        });
    };
    load();
    const unsub = subscribeProjectIcons((changed) => {
      if (changed === null || changed === projectId) load();
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [projectId]);

  return uri;
}
