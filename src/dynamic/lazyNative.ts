import { Platform, TurboModuleRegistry } from 'react-native';

// Modules whose native half arrived with a newer Blank Slate binary. JS ships
// over the air, so an older binary can run this code without them: each is
// loaded on first import, after checking its native side is really there, so
// a missing one is a compile error in the app that wanted it rather than a
// crash at startup or a native exception mid-render.

type Loader = {
  // Is the native half present? Web never needs one.
  available: () => boolean;
  load: () => Record<string, unknown>;
};

// A module, or why it can't load: missing native half or an exception.
const cache = new Map<string, { mod: Record<string, unknown> } | { missing: true } | { error: unknown }>();

export function lazyNative(spec: string, loader: Loader): () => Record<string, unknown> {
  return () => {
    let entry = cache.get(spec);
    if (entry === undefined) {
      if (Platform.OS !== 'web' && !loader.available()) {
        entry = { missing: true };
      } else {
        try {
          entry = { mod: loader.load() };
        } catch (error) {
          entry = { error };
        }
      }
      cache.set(spec, entry);
    }
    if ('missing' in entry) throw new Error(`${spec} needs a newer build of Blank Slate. Update the app to use it.`);
    if ('error' in entry) {
      const e = entry.error;
      throw new Error(`${spec} failed to load: ${e instanceof Error ? e.message : String(e)}`);
    }
    return entry.mod;
  };
}

export function hasTurboModule(name: string): boolean {
  try {
    return TurboModuleRegistry.get(name) != null;
  } catch {
    return false;
  }
}

export function hasExpoModule(name: string): boolean {
  const modules = (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules;
  return !!modules && modules[name] != null;
}
