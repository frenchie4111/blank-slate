import { Platform } from 'react-native';
import { appKeyPrefix } from '../storage/namespaces';

// Module-scope bindings that shadow ambient globals for generated code, so
// `localStorage`, `window.localStorage`, `document.cookie`, `indexedDB` etc.
// either stay inside the app's namespace or aren't there at all.
//
// This is hygiene, not a security boundary: generated code shares Blank
// Slate's JS realm, so `Function('return this')()`, `(0, eval)('this')`, a
// same-origin iframe or `window.open` still reach the real globals. It stops
// accidental collisions and casual snooping, nothing more.

const isWeb = Platform.OS === 'web';

// Native modules that hold storage. Hidden from `NativeModules`, the `expo`
// global and the TurboModule proxies, which otherwise bypass every shim.
export const STORAGE_NATIVE_MODULE = /AsyncStorage|AsyncLocalStorage|AsyncSQLite|SecureStore|FileSystem|SQLite/i;

type AnyObj = Record<PropertyKey, any>;

const boundCache = new WeakMap<object, WeakMap<Function, Function>>();

// Host methods (addEventListener, matchMedia…) throw "Illegal invocation"
// unless `this` is the real object; constructors (with a prototype) are
// passed through untouched so statics and `instanceof` keep working.
function bindHost(target: object, v: unknown): unknown {
  if (typeof v !== 'function' || 'prototype' in v) return v;
  const fn = v as (...a: unknown[]) => unknown;
  let cache = boundCache.get(target);
  if (!cache) boundCache.set(target, (cache = new WeakMap()));
  let b = cache.get(fn);
  if (!b) cache.set(fn, (b = fn.bind(target)));
  return b;
}

type Lookup = (prop: PropertyKey) => { value: unknown } | null;

// A stand-in for `real` where `lookup` can replace or hide properties. The
// proxy target is a blank object, not `real`: a Proxy may not misreport a
// non-configurable property of its target, and Electron's contextBridge
// defines `window.blankSlateDesktop` as exactly that. Everything else is
// forwarded to `real`.
function facade<T extends object>(real: T, lookup: Lookup): T {
  const blank = Object.create(null) as T;
  return new Proxy(blank, {
    get(_t, prop) {
      const hit = lookup(prop);
      return hit ? hit.value : bindHost(real, Reflect.get(real, prop));
    },
    set(_t, prop, value) {
      return lookup(prop) ? true : Reflect.set(real, prop, value);
    },
    has(_t, prop) {
      const hit = lookup(prop);
      return hit ? hit.value !== undefined : Reflect.has(real, prop);
    },
    deleteProperty(_t, prop) {
      return lookup(prop) ? true : Reflect.deleteProperty(real, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(real).filter((k) => {
        const hit = lookup(k);
        return !hit || hit.value !== undefined;
      });
    },
    getOwnPropertyDescriptor(_t, prop) {
      const hit = lookup(prop);
      if (hit) {
        return hit.value === undefined
          ? undefined
          : { value: hit.value, writable: false, enumerable: true, configurable: true };
      }
      const d = Reflect.getOwnPropertyDescriptor(real, prop);
      // Reported as configurable: the blank target doesn't have it.
      return d && { ...d, configurable: true };
    },
    defineProperty(_t, prop, desc) {
      return lookup(prop) ? true : Reflect.defineProperty(real, prop, desc);
    },
    getPrototypeOf: () => Reflect.getPrototypeOf(real),
  });
}

function shadow<T extends object>(real: T, overrides: () => AnyObj): T {
  return facade(real, (prop) => {
    const o = overrides();
    return Object.prototype.hasOwnProperty.call(o, prop) ? { value: o[prop as string] } : null;
  });
}

export function hideMatching<T extends object>(real: T | undefined, re: RegExp): T | undefined {
  if (!real) return real;
  return facade(real, (prop) => (typeof prop === 'string' && re.test(prop) ? { value: undefined } : null));
}

/** A Storage (localStorage/sessionStorage) confined to `prefix`. */
export function scopedWebStorage(real: Storage, prefix: string): Storage {
  const own = () => {
    const out: string[] = [];
    for (let i = 0; i < real.length; i++) {
      const k = real.key(i);
      if (k !== null && k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out;
  };
  const api: AnyObj = Object.freeze({
    getItem: (k: unknown) => real.getItem(prefix + String(k)),
    setItem: (k: unknown, v: unknown) => real.setItem(prefix + String(k), String(v)),
    removeItem: (k: unknown) => real.removeItem(prefix + String(k)),
    clear: () => own().forEach((k) => real.removeItem(prefix + k)),
    key: (i: number) => own()[i] ?? null,
  });
  // Property-style access (`localStorage.foo = 'x'`) works too.
  return new Proxy({} as Storage, {
    get(_t, prop) {
      if (prop === 'length') return own().length;
      if (typeof prop === 'symbol') return undefined;
      if (prop in api) return api[prop];
      return real.getItem(prefix + prop) ?? undefined;
    },
    set(_t, prop, value) {
      if (typeof prop === 'symbol') return false;
      real.setItem(prefix + prop, String(value));
      return true;
    },
    deleteProperty(_t, prop) {
      if (typeof prop === 'string') real.removeItem(prefix + prop);
      return true;
    },
    has: (_t, prop) => typeof prop === 'string' && (prop in api || real.getItem(prefix + prop) !== null),
    ownKeys: () => own(),
    getOwnPropertyDescriptor(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      const value = real.getItem(prefix + prop);
      return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
  });
}

export type Scope = { names: string[]; values: unknown[] };

export function sandboxScope(projectId: string): Scope {
  const g = globalThis as AnyObj;
  const prefix = appKeyPrefix(projectId);
  const webStorage = (name: 'localStorage' | 'sessionStorage') => {
    try {
      return isWeb && g[name] ? scopedWebStorage(g[name], prefix) : undefined;
    } catch {
      return undefined; // e.g. storage disabled in the browser
    }
  };

  const localStorage = webStorage('localStorage');
  const sessionStorage = webStorage('sessionStorage');
  const nativeModules = hideMatching(g.nativeModuleProxy, STORAGE_NATIVE_MODULE);
  const turboModules = g.__turboModuleProxy
    ? (name: string) => (STORAGE_NATIVE_MODULE.test(name) ? null : g.__turboModuleProxy(name))
    : undefined;
  const expo = g.expo
    ? shadow(g.expo as object, () => ({ modules: hideMatching(g.expo.modules, STORAGE_NATIVE_MODULE) }))
    : undefined;
  const navigator =
    isWeb && g.navigator
      ? // navigator.storage is the origin-private file system (where expo-sqlite
        // keeps web databases); service workers and Cache API are origin-wide.
        shadow(g.navigator as object, () => ({ storage: undefined, serviceWorker: undefined }))
      : g.navigator;
  const document =
    isWeb && g.document
      ? shadow(g.document as object, () => ({ cookie: '', defaultView: win }))
      : g.document;

  // Everything generated code could name to get at globals, plus Metro's
  // module system (`__r(id)` loads any Blank Slate module, keyStore included)
  // and the Electron preload bridge, which holds the API key.
  const hidden: AnyObj = {
    localStorage,
    sessionStorage,
    indexedDB: undefined,
    caches: undefined,
    cookieStore: undefined,
    navigator,
    document,
    expo,
    nativeModuleProxy: nativeModules,
    __turboModuleProxy: turboModules,
    blankSlateDesktop: undefined,
    __r: undefined,
    __d: undefined,
    __c: undefined,
    __registerSegment: undefined,
    __accept: undefined,
    __METRO_GLOBAL_PREFIX__: undefined,
  };
  const win: AnyObj = shadow(g, () => overrides);
  const overrides: AnyObj = {
    ...hidden,
    window: win,
    self: win,
    globalThis: win,
    global: win,
    top: win,
    parent: win,
    frames: win,
  };
  Object.freeze(overrides);

  return {
    names: Object.keys(overrides),
    values: Object.values(overrides),
  };
}

// For the self-test.
export const __test = { shadow, hideMatching };
