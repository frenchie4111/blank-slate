import AsyncStorage from '@react-native-async-storage/async-storage';
import { appKeyPrefix } from '../storage/namespaces';

// The slice of AsyncStorage the sandbox builds on. Injectable so the
// self-test can run against an in-memory store.
export type KVBackend = Pick<
  typeof AsyncStorage,
  | 'getItem'
  | 'setItem'
  | 'removeItem'
  | 'mergeItem'
  | 'multiGet'
  | 'multiSet'
  | 'multiRemove'
  | 'multiMerge'
  | 'getAllKeys'
>;

type Cb = ((error?: Error | null, result?: any) => void) | undefined;
type MultiCb = ((errors?: readonly Error[] | null, result?: any) => void) | undefined;

function withCb<T>(p: Promise<T>, cb: Cb): Promise<T> {
  if (typeof cb !== 'function') return p;
  return p.then(
    (r) => {
      cb(null, r);
      return r;
    },
    (e) => {
      cb(e);
      throw e;
    },
  );
}

function withMultiCb<T>(p: Promise<T>, cb: MultiCb): Promise<T> {
  if (typeof cb !== 'function') return p;
  return p.then(
    (r) => {
      cb(null, r);
      return r;
    },
    (e) => {
      cb([e]);
      throw e;
    },
  );
}

/** All of an app's real (prefixed) keys. */
export async function appKeys(projectId: string, base: KVBackend = AsyncStorage): Promise<string[]> {
  const prefix = appKeyPrefix(projectId);
  return (await base.getAllKeys()).filter((k) => k.startsWith(prefix));
}

export async function removeAppKeys(projectId: string, base: KVBackend = AsyncStorage): Promise<void> {
  const keys = await appKeys(projectId, base);
  if (keys.length) await base.multiRemove(keys);
}

/**
 * The `@react-native-async-storage/async-storage` module as one generated app
 * sees it: the full API, with every key silently confined to
 * `app:<projectId>:`. Bound to the project it was built for, so a write that
 * lands after the user switched apps still goes to the right place.
 */
export function createScopedAsyncStorage(projectId: string, base: KVBackend = AsyncStorage) {
  const prefix = appKeyPrefix(projectId);
  const k = (key: unknown): string => {
    if (typeof key !== 'string') throw new TypeError(`AsyncStorage keys must be strings, got ${typeof key}`);
    return prefix + key;
  };
  const strip = (key: string) => key.slice(prefix.length);

  const storage = Object.freeze({
    getItem: (key: string, cb?: Cb) => withCb(Promise.resolve().then(() => base.getItem(k(key))), cb),
    setItem: (key: string, value: string, cb?: Cb) =>
      withCb(Promise.resolve().then(() => base.setItem(k(key), value)), cb),
    removeItem: (key: string, cb?: Cb) => withCb(Promise.resolve().then(() => base.removeItem(k(key))), cb),
    mergeItem: (key: string, value: string, cb?: Cb) =>
      withCb(Promise.resolve().then(() => base.mergeItem(k(key), value)), cb),
    clear: (cb?: Cb) => withCb(removeAppKeys(projectId, base), cb),
    getAllKeys: (cb?: Cb) => withCb(appKeys(projectId, base).then((ks) => ks.map(strip)), cb),
    flushGetRequests: () => {},
    multiGet: (keys: readonly string[], cb?: MultiCb) =>
      withMultiCb(
        Promise.resolve()
          .then(() => base.multiGet(keys.map(k)))
          .then((pairs) => pairs.map(([key, v]) => [strip(key), v] as [string, string | null])),
        cb,
      ),
    multiSet: (pairs: ReadonlyArray<readonly [string, string]>, cb?: MultiCb) =>
      withMultiCb(
        Promise.resolve().then(() => base.multiSet(pairs.map(([key, v]) => [k(key), v] as [string, string]))),
        cb,
      ),
    multiRemove: (keys: readonly string[], cb?: MultiCb) =>
      withMultiCb(Promise.resolve().then(() => base.multiRemove(keys.map(k))), cb),
    multiMerge: (pairs: [string, string][], cb?: MultiCb) =>
      withMultiCb(
        Promise.resolve().then(() => base.multiMerge(pairs.map(([key, v]) => [k(key), v] as [string, string]))),
        cb,
      ),
  });

  // Like the real one: not actually a hook, just key-bound helpers.
  const useAsyncStorage = (key: string) =>
    Object.freeze({
      getItem: (cb?: Cb) => storage.getItem(key, cb),
      setItem: (value: string, cb?: Cb) => storage.setItem(key, value, cb),
      mergeItem: (value: string, cb?: Cb) => storage.mergeItem(key, value, cb),
      removeItem: (cb?: Cb) => storage.removeItem(key, cb),
    });

  // `import AsyncStorage from`, `import { useAsyncStorage } from` and
  // `import * as AS from` all work.
  return Object.freeze({ __esModule: true, default: storage, ...storage, useAsyncStorage });
}
